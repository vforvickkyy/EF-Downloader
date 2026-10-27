// API tests against a throwaway local Postgres database:
//   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5433/eastape_test npm test
// The database is wiped first, so never point this at a real one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.env.TEST_DATABASE_URL;
const skip = !url && 'TEST_DATABASE_URL is not set';
const here = path.dirname(fileURLToPath(import.meta.url));

const APP_KEY = 'test-app-key';
const { privateKey } = crypto.generateKeyPairSync('ed25519');
Object.assign(process.env, {
  DATABASE_URL: url || 'postgres://unused@127.0.0.1:1/none',
  APP_KEY,
  CRON_SECRET: 'cron-secret',
  RELEASE_SIGNING_KEY: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
});

const { handle } = await import('../lib/router.js');
const { db, closeDb } = await import('../lib/db.js');
const { hashPassword } = await import('../lib/crypto.js');
const { pickUpdate, rolloutBucket } = await import('../lib/check.js');
const { forgetSigningKey } = await import('../lib/signing.js');

const BASE = 'https://admin.test';
const ID = 'a'.repeat(32);
const ID2 = 'b'.repeat(32);

async function call(method, p, { body, headers = {}, cookie } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['content-type'] = 'application/json';
  if (cookie) h.cookie = cookie;
  const res = await handle(new Request(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

const app = (method, p, body) => call(method, p, { body, headers: { 'x-app-key': APP_KEY } });

async function login(email, password) {
  const r = await call('POST', '/api/admin/login', { body: { email, password }, headers: { 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}` } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.headers.get('set-cookie').split(';')[0];
}

const admin = (cookie) => ({
  get: (p) => call('GET', p, { cookie }),
  send: (method, p, body) => call(method, p, { body, cookie, headers: { 'x-eastape-dashboard': '1' } }),
});

let owner, viewer;

before(async () => {
  if (skip) return;
  const sql = db();
  await sql.unsafe('drop schema public cascade; create schema public;');
  const dir = path.join(here, '..', 'migrations');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    await sql.unsafe(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
  await sql`insert into admin_users (email, name, role, password_hash) values ('owner@example.com', 'Owner', 'owner', ${hashPassword('owner-password-1')})`;
  await sql`insert into admin_users (email, name, role, password_hash) values ('viewer@example.com', 'Viewer', 'viewer', ${hashPassword('viewer-password-1')})`;
  owner = admin(await login('owner@example.com', 'owner-password-1'));
  viewer = admin(await login('Viewer@Example.com', 'viewer-password-1'));
});

after(async () => { await closeDb(); });

test('health reports the schema version', { skip }, async () => {
  const r = await call('GET', '/api/v1/health');
  assert.equal(r.status, 200);
  assert.equal(r.data.schema, 2);
});

test('unknown routes and methods', { skip }, async () => {
  assert.equal((await call('GET', '/api/v1/nope')).status, 404);
  assert.equal((await call('GET', '/api/v1/ingest')).status, 405);
  // Vercel rewrite form
  assert.equal((await call('GET', '/api/main?__path=/api/v1/health')).status, 200);
});

test('ingest needs the app key and a valid install ID', { skip }, async () => {
  assert.equal((await call('POST', '/api/v1/ingest', { body: { installId: ID } })).status, 401);
  assert.equal((await app('POST', '/api/v1/ingest', { installId: 'nope' })).status, 400);
});

test('ingest records installs, users, support and usage', { skip }, async () => {
  const now = new Date().toISOString();
  const r = await app('POST', '/api/v1/ingest', {
    installId: ID,
    appVersion: '1.2.0',
    os: 'Windows 11 (build 22631)',
    source: 'installer',
    events: [
      { type: 'install', ts: now, props: { source: 'installer' } },
      { type: 'register', ts: now, props: { name: 'Asha', email: 'Asha@Example.com' } },
      { type: 'support', ts: now, props: { name: 'Asha', email: 'asha@example.com', topic: 'Bug', message: 'It froze', details: 'log…' } },
      { type: 'session_start', ts: now },
      { type: 'scan', ts: now, props: { ok: true, links: 2, files: 10, kinds: { folder: 1, file: 1 } } },
      { type: 'job', ts: now, props: { result: 'done', filesDone: 10, bytes: 5_000_000, avgBps: 2_000_000, durationSec: 3 } },
      { type: 'feature', ts: now, props: { name: 'speed_limit' } },
      { type: 'error', ts: now, props: { kind: 'network' } },
      { type: 'heartbeat', ts: now, props: { state: 'downloading', bps: 1234 } },
      { type: 'session_end', ts: now, props: { durationSec: 600 } },
      { type: 'hack_the_planet', ts: now },
      { type: 'register', ts: now, props: { name: 'x', email: 'not-an-email' } },
    ],
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.accepted, 10);

  const sql = db();
  const [inst] = await sql`select * from installs where id = ${ID}`;
  assert.equal(inst.sessions, 1);
  assert.equal(Number(inst.active_seconds), 600);
  assert.equal(inst.links_scanned, 2);
  assert.equal(inst.jobs, 1);
  assert.equal(Number(inst.files_downloaded), 10);
  assert.equal(Number(inst.bytes_downloaded), 5_000_000);
  assert.equal(inst.last_state, 'downloading');
  assert.equal(inst.source, 'installer');
  assert.ok(inst.user_id);
  const [ticket] = await sql`select * from support_tickets`;
  assert.equal(ticket.message, 'It froze');
  // Registering again with the same email (any case) reuses the user.
  await app('POST', '/api/v1/ingest', { installId: ID2, appVersion: '1.1.0', events: [{ type: 'register', props: { name: 'Asha K', email: 'asha@example.com' } }] });
  const users = await sql`select * from users`;
  assert.equal(users.length, 1);
  assert.equal(users[0].name, 'Asha K');
  // Email isn't copied into raw events.
  const [reg] = await sql`select props from events where type = 'register' limit 1`;
  assert.equal(JSON.stringify(reg.props).includes('@'), false);
});

test('only the first heartbeat after a quiet spell is stored', { skip }, async () => {
  const id = 'e'.repeat(32);
  const beat = (state) => app('POST', '/api/v1/ingest', { installId: id, events: [{ type: 'heartbeat', props: { state, bps: 10 } }] });
  await beat('idle');
  await beat('downloading');
  await beat('downloading');
  const sql = db();
  const rows = await sql`select * from events where install_id = ${id}`;
  assert.equal(rows.length, 1);
  const [inst] = await sql`select last_state from installs where id = ${id}`;
  assert.equal(inst.last_state, 'downloading');
  await sql`update installs set last_seen = now() - interval '2 hours' where id = ${id}`;
  await beat('idle');
  assert.equal((await sql`select count(*)::int as n from events where install_id = ${id}`)[0].n, 2);
  await sql`delete from events where install_id = ${id}`;
  await sql`delete from installs where id = ${id}`;
});

test('ingest rate limit', { skip }, async () => {
  const id = 'c'.repeat(32);
  const events = Array.from({ length: 200 }, () => ({ type: 'feature', props: { name: 'x' } }));
  let last;
  for (let i = 0; i < 16; i++) last = await app('POST', '/api/v1/ingest', { installId: id, events });
  assert.equal(last.status, 429);
});

test('rollout buckets are stable and pickUpdate respects rollout and minimums', () => {
  assert.equal(rolloutBucket(ID, '1.3.0'), rolloutBucket(ID, '1.3.0'));
  const rel = (version, extra = {}) => ({ version, rollout: 100, mandatory: false, min_supported: null, file_url: 'u', size: 1, sha256: 's', signature: 'g', ...extra });
  assert.equal(pickUpdate([rel('1.2.0')], ID, '1.2.0'), null);
  assert.equal(pickUpdate([rel('1.3.0')], ID, '1.2.0').version, '1.3.0');
  assert.equal(pickUpdate([rel('1.3.0', { rollout: 0 })], ID, '1.2.0'), null);
  assert.equal(pickUpdate([rel('1.3.0', { rollout: 0, min_supported: '1.2.5' })], ID, '1.2.0').mandatory, true);
  assert.equal(pickUpdate([rel('1.3.0', { rollout: 0 }), rel('1.2.5')], ID, '1.2.0').version, '1.2.5');
  assert.equal(pickUpdate([rel('1.10.0'), rel('1.9.0')], ID, '1.2.0').version, '1.10.0');
});

test('dashboard sign-in, CSRF header and roles', { skip }, async () => {
  assert.equal((await call('GET', '/api/admin/me')).status, 401);
  const bad = await call('POST', '/api/admin/login', { body: { email: 'owner@example.com', password: 'wrong' } });
  assert.equal(bad.status, 401);
  assert.equal((await owner.get('/api/admin/me')).data.user.role, 'owner');
  // Changes without the dashboard header are refused.
  const cookie = (await login('owner@example.com', 'owner-password-1'));
  const noHeader = await call('POST', '/api/admin/announcements', { body: { title: 'x' }, cookie });
  assert.equal(noHeader.status, 403);
  // Viewers can look but not change.
  assert.equal((await viewer.get('/api/admin/overview')).status, 200);
  assert.equal((await viewer.send('POST', '/api/admin/announcements', { title: 'x' })).status, 403);
  // Cookie flags
  const r = await call('POST', '/api/admin/login', { body: { email: 'owner@example.com', password: 'owner-password-1' } });
  assert.match(r.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Max-Age=\d+; Secure/);
});

test('sign-in is throttled', { skip }, async () => {
  let r;
  for (let i = 0; i < 9; i++) r = await call('POST', '/api/admin/login', { body: { email: 'nobody@example.com', password: 'x' }, headers: { 'x-forwarded-for': `10.1.0.${i}` } });
  assert.equal(r.status, 429);
});

test('overview, live and users', { skip }, async () => {
  const o = await owner.get('/api/admin/overview?days=7&tz=Asia/Kolkata');
  assert.equal(o.status, 200);
  assert.equal(o.data.series.length, 7);
  assert.equal(o.data.tz, 'Asia/Kolkata');
  assert.equal(o.data.totals.bytes, 5_000_000);
  assert.equal(o.data.series.at(-1).bytes, 5_000_000);
  assert.ok(o.data.features.some((f) => f.name === 'speed_limit'));
  assert.ok(o.data.linkKinds.some((f) => f.name === 'folder'));
  assert.ok(o.data.activity.length > 0);
  assert.equal((await owner.get('/api/admin/overview?tz=Not/A_Zone')).data.tz, 'UTC');

  const l = await owner.get('/api/admin/live');
  assert.equal(l.data.live.downloadingNow, 1);
  assert.equal(l.data.live.openTickets, 1);

  const u = await owner.get('/api/admin/users?q=asha');
  assert.equal(u.data.total, 2);
  const reg = await owner.get('/api/admin/users?filter=unregistered');
  assert.ok(reg.data.rows.every((r) => !r.email));
});

test('CSV export guards against spreadsheet formulas', { skip }, async () => {
  await app('POST', '/api/v1/ingest', { installId: 'd'.repeat(32), events: [{ type: 'register', props: { name: '=HYPERLINK("x")', email: 'evil@example.com' } }] });
  const r = await owner.get('/api/admin/users.csv');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.match(r.data, /"'=HYPERLINK\(""x""\)"/);
});

test('support tickets can be answered with a note', { skip }, async () => {
  const list = await owner.get('/api/admin/support?status=open');
  const id = list.data.rows[0].id;
  assert.equal((await owner.send('PATCH', `/api/admin/support/${id}`, { status: 'answered', note: 'Replied' })).status, 200);
  const after = await owner.get('/api/admin/support');
  assert.equal(after.data.rows[0].status, 'answered');
  assert.equal(after.data.rows[0].note, 'Replied');
  assert.equal(after.data.counts.answered, 1);
  assert.equal((await owner.send('PATCH', `/api/admin/support/${id}`, { status: 'weird' })).status, 400);
});

test('announcements reach the app by version', { skip }, async () => {
  const bad = await owner.send('POST', '/api/admin/announcements', { title: 'x', ctaUrl: 'javascript:alert(1)' });
  assert.equal(bad.status, 400);
  const a = await owner.send('POST', '/api/admin/announcements', { title: 'Hello', body: 'News', level: 'success', ctaLabel: 'Read', ctaUrl: 'https://example.com', minVersion: '1.2.0' });
  assert.equal(a.status, 200);
  const forNew = await app('GET', `/api/v1/check?installId=${ID}&version=1.2.0`);
  assert.equal(forNew.data.announcements.length, 1);
  assert.equal(forNew.data.announcements[0].title, 'Hello');
  const forOld = await app('GET', `/api/v1/check?installId=${ID2}&version=1.1.0`);
  assert.equal(forOld.data.announcements.length, 0);
  await owner.send('PATCH', `/api/admin/announcements/${a.data.row.id}`, { ...a.data.row, active: false });
  assert.equal((await app('GET', `/api/v1/check?installId=${ID}&version=1.2.0`)).data.announcements.length, 0);
  await app('POST', '/api/v1/ingest', { installId: ID, events: [{ type: 'announcement_seen', props: { id: a.data.row.id } }] });
  const list = await owner.get('/api/admin/announcements');
  assert.equal(list.data.rows[0].seen, 1);
  assert.equal((await owner.send('DELETE', `/api/admin/announcements/${a.data.row.id}`)).status, 200);
});

test('releases are fingerprinted, signed and offered after publishing', { skip }, async () => {
  const exe = Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(5000)]);
  const fileUrl = 'https://abc.public.blob.vercel-storage.com/releases/EastapeDownloader-Setup-1.3.0-x1.exe';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => (String(u) === fileUrl ? new Response(exe) : new Response('no', { status: 404 }));
  try {
    assert.equal((await owner.send('POST', '/api/admin/releases', { version: '1.3.0', url: 'https://evil.example.com/x.exe' })).status, 400);
    const r = await owner.send('POST', '/api/admin/releases', { version: '1.3.0', url: fileUrl, notes: 'Faster', rollout: 100 });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.row.size, exe.length);
    assert.equal(r.data.row.sha256, crypto.createHash('sha256').update(exe).digest('hex'));
    assert.equal(r.data.row.status, 'draft');
    assert.equal((await owner.send('POST', '/api/admin/releases', { version: '1.3.0', url: fileUrl })).status, 409);

    // Drafts aren't offered.
    assert.equal((await app('GET', `/api/v1/check?installId=${ID}&version=1.2.0`)).data.update, null);
    await owner.send('PATCH', `/api/admin/releases/${r.data.row.id}`, { status: 'published' });
    const offer = (await app('GET', `/api/v1/check?installId=${ID}&version=1.2.0`)).data.update;
    assert.equal(offer.version, '1.3.0');
    assert.equal(offer.notes, 'Faster');

    // The signature verifies with the public key the dashboard shows.
    const { publicKey } = (await owner.get('/api/admin/releases')).data;
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey, 'base64')]);
    const key = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
    const signed = `eastape-update-v1\n${offer.version}\n${offer.sha256}\n${offer.size}\n${offer.url}`;
    assert.ok(crypto.verify(null, Buffer.from(signed), key, Buffer.from(offer.signature, 'base64')));

    // Published updates can't be deleted, only paused.
    assert.equal((await owner.send('DELETE', `/api/admin/releases/${r.data.row.id}`)).status, 400);
    await owner.send('PATCH', `/api/admin/releases/${r.data.row.id}`, { status: 'paused' });
    assert.equal((await app('GET', `/api/v1/check?installId=${ID}&version=1.2.0`)).data.update, null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('without RELEASE_SIGNING_KEY the service makes and keeps its own key', { skip }, async () => {
  const saved = process.env.RELEASE_SIGNING_KEY;
  delete process.env.RELEASE_SIGNING_KEY;
  forgetSigningKey();
  try {
    const a = (await call('GET', '/api/v1/update-key')).data.publicKey;
    forgetSigningKey(); // as a fresh function instance would
    const b = (await call('GET', '/api/v1/update-key')).data.publicKey;
    assert.equal(Buffer.from(a, 'base64').length, 32);
    assert.equal(a, b);
    const rows = await db()`select name from server_keys`;
    assert.deepEqual(rows.map((r) => r.name), ['release_signing_key']);
    assert.equal((await owner.get('/api/admin/releases')).data.publicKey, a);
  } finally {
    process.env.RELEASE_SIGNING_KEY = saved;
    forgetSigningKey();
  }
});

test('team: owner adds and removes people; others cannot', { skip }, async () => {
  const r = await owner.send('POST', '/api/admin/team', { email: 'New@Example.com', name: 'New', role: 'admin' });
  assert.equal(r.status, 200);
  assert.ok(r.data.password.length >= 12);
  const newbie = admin(await login('new@example.com', r.data.password));
  assert.equal((await newbie.send('POST', '/api/admin/team', { email: 'x@example.com' })).status, 403);
  assert.equal((await owner.send('POST', '/api/admin/team', { email: 'new@example.com' })).status, 409);
  const team = await owner.get('/api/admin/team');
  const id = team.data.rows.find((m) => m.email === 'new@example.com').id;
  assert.equal((await owner.send('DELETE', `/api/admin/team/${id}`)).status, 200);
  assert.equal((await newbie.get('/api/admin/me')).status, 401);
});

test('changing your password signs out other sessions', { skip }, async () => {
  const other = admin(await login('viewer@example.com', 'viewer-password-1'));
  assert.equal((await viewer.send('POST', '/api/admin/password', { current: 'nope', next: 'viewer-password-2' })).status, 400);
  assert.equal((await viewer.send('POST', '/api/admin/password', { current: 'viewer-password-1', next: 'short' })).status, 400);
  assert.equal((await viewer.send('POST', '/api/admin/password', { current: 'viewer-password-1', next: 'viewer-password-2' })).status, 200);
  assert.equal((await other.get('/api/admin/me')).status, 401);
  assert.equal((await viewer.get('/api/admin/me')).status, 200);
});

test('daily cron needs its secret and saves totals', { skip }, async () => {
  assert.equal((await call('GET', '/api/cron/daily')).status, 401);
  const sql = db();
  await sql`update events set ts = now() - interval '1 day' where type = 'job'`;
  await sql`insert into events (install_id, type, ts) values (${ID}, 'feature', now() - interval '200 days')`;
  const r = await call('GET', '/api/cron/daily', { headers: { authorization: 'Bearer cron-secret' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.removedEvents, 1);
  const [bytes] = await sql`select value from daily_stats where metric = 'bytes'`;
  assert.equal(Number(bytes.value), 5_000_000);

  // Without CRON_SECRET it runs, but not twice in a row.
  const saved = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  try {
    assert.equal((await call('GET', '/api/cron/daily')).status, 200);
    assert.equal((await call('GET', '/api/cron/daily')).status, 429);
  } finally {
    process.env.CRON_SECRET = saved;
  }
});
