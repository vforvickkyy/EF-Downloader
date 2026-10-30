import { db } from '../db.js';
import { HttpError, json, text, readJson, str, int, bool, EMAIL_RE } from '../http.js';
import { requireAdmin } from '../auth.js';
import { hashPassword, randomToken } from '../crypto.js';
import { VERSION_RE } from '../semver.js';

const N = (v) => Number(v || 0);

// ---------------------------------------------------------------- users

function platformOf(os) {
  if (!os) return null;
  if (/^macOS/i.test(os)) return 'mac';
  if (/^Windows/i.test(os)) return 'windows';
  return 'other';
}

function userRow(r) {
  return {
    install: r.id, name: r.name, email: r.email, firstSeen: r.first_seen, lastSeen: r.last_seen,
    installedAt: r.installed_at, version: r.app_version, os: r.os, platform: platformOf(r.os), source: r.source, stats: r.stats_enabled,
    state: r.last_state, sessions: N(r.sessions), seconds: N(r.active_seconds), links: N(r.links_scanned),
    jobs: N(r.jobs), files: N(r.files_downloaded), bytes: N(r.bytes_downloaded), registeredAt: r.registered_at,
  };
}

// How the users list can be sorted (the install ID breaks ties so pages never overlap).
const USER_SORTS = {
  recent: (sql) => sql`i.last_seen desc, i.id`,
  newest: (sql) => sql`coalesce(i.installed_at, i.first_seen) desc, i.id`,
  oldest: (sql) => sql`coalesce(i.installed_at, i.first_seen) asc, i.id`,
  name: (sql) => sql`lower(u.name) asc nulls last, i.last_seen desc, i.id`,
  name_desc: (sql) => sql`lower(u.name) desc nulls last, i.last_seen desc, i.id`,
  data: (sql) => sql`i.bytes_downloaded desc, i.last_seen desc, i.id`,
  downloads: (sql) => sql`i.jobs desc, i.last_seen desc, i.id`,
  files: (sql) => sql`i.files_downloaded desc, i.last_seen desc, i.id`,
  time: (sql) => sql`i.active_seconds desc, i.last_seen desc, i.id`,
};
const USER_FILTERS = ['all', 'registered', 'unregistered', 'active', 'online', 'downloading'];

function userQuery(url) {
  const p = url.searchParams;
  const sort = USER_SORTS[p.get('sort')] ? p.get('sort') : 'recent';
  const filter = USER_FILTERS.includes(p.get('filter')) ? p.get('filter') : 'all';
  const platform = ['windows', 'mac'].includes(p.get('platform')) ? p.get('platform') : 'all';
  const version = p.get('version') && VERSION_RE.test(p.get('version')) ? p.get('version') : '';
  return { q: (p.get('q') || '').trim().slice(0, 100), sort, filter, platform, version };
}

async function queryUsers(url, { limit, offset }) {
  const { q, sort, filter, platform, version } = userQuery(url);
  const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
  const sql = db();
  const where = sql`
    where (${q} = '' or u.name ilike ${like} or u.email ilike ${like} or i.id ilike ${like})
      and (${filter} <> 'registered' or u.id is not null)
      and (${filter} <> 'unregistered' or u.id is null)
      and (${filter} <> 'active' or i.last_seen > now() - interval '7 days')
      and (${filter} not in ('online', 'downloading') or i.last_seen > now() - interval '15 minutes')
      and (${filter} <> 'downloading' or i.last_state = 'downloading')
      and (${platform} <> 'windows' or i.os ilike 'Windows%')
      and (${platform} <> 'mac' or i.os ilike 'macOS%')
      and (${version} = '' or i.app_version = ${version})`;
  const rows = await sql`
    select i.*, u.name, u.email, u.created_at as registered_at
    from installs i left join users u on u.id = i.user_id
    ${where}
    order by ${USER_SORTS[sort](sql)}
    limit ${limit} offset ${offset}`;
  const [{ n }] = await sql`select count(*) as n from installs i left join users u on u.id = i.user_id ${where}`;
  return { rows: rows.map(userRow), total: N(n), sort };
}

/** Counts for the filter controls, over everyone. */
async function userFacets(sql) {
  const [c] = await sql`
    select count(*) as all,
           count(user_id) as registered,
           count(*) filter (where last_seen > now() - interval '7 days') as active,
           count(*) filter (where last_seen > now() - interval '15 minutes') as online,
           count(*) filter (where last_seen > now() - interval '15 minutes' and last_state = 'downloading') as downloading,
           count(*) filter (where os ilike 'Windows%') as windows,
           count(*) filter (where os ilike 'macOS%') as mac
    from installs`;
  const versions = await sql`
    select app_version as name, count(*) as n from installs where app_version is not null
    group by 1
    order by case when app_version ~ '^[0-9]{1,6}(\\.[0-9]{1,6}){0,3}$' then string_to_array(app_version, '.')::int[] end desc nulls last, app_version desc
    limit 30`;
  return {
    all: N(c.all), registered: N(c.registered), unregistered: N(c.all) - N(c.registered), active: N(c.active),
    online: N(c.online), downloading: N(c.downloading), windows: N(c.windows), mac: N(c.mac),
    versions: versions.map((v) => ({ name: v.name, n: N(v.n) })),
  };
}

/** GET /api/admin/users?q=&filter=&platform=&version=&sort=&page=&size= */
export async function listUsers(request) {
  await requireAdmin(request);
  const url = new URL(request.url);
  const size = [25, 50, 100].includes(Number(url.searchParams.get('size'))) ? Number(url.searchParams.get('size')) : 50;
  const page = int(url.searchParams.get('page'), { min: 1, max: 100000, fallback: 1 });
  const [{ rows, total, sort }, facets] = await Promise.all([
    queryUsers(url, { limit: size, offset: (page - 1) * size }),
    userFacets(db()),
  ]);
  return json({ ok: true, rows, total, page, pageSize: size, sort, facets });
}

/** GET /api/admin/users/:id — one installation, with its support messages. */
export async function getUser(request, { id }) {
  await requireAdmin(request);
  if (!/^[0-9a-f]{32}$/i.test(id)) throw new HttpError(400, 'Invalid install ID');
  const sql = db();
  const [r] = await sql`
    select i.*, u.name, u.email, u.created_at as registered_at
    from installs i left join users u on u.id = i.user_id where i.id = ${id.toLowerCase()}`;
  if (!r) throw new HttpError(404, 'Not found');
  const tickets = await sql`
    select id, topic, status, created_at from support_tickets where install_id = ${r.id} order by created_at desc limit 20`;
  const [agg] = await sql`
    select count(*) filter (where type = 'error') as problems,
           max(ts) filter (where type = 'job') as last_download
    from events where install_id = ${r.id}`;
  return json({
    ok: true,
    user: userRow(r),
    problems: N(agg.problems),
    lastDownload: agg.last_download,
    tickets: tickets.map((t) => ({ id: N(t.id), topic: t.topic, status: t.status, createdAt: t.created_at })),
  });
}

/** GET /api/admin/users.csv */
export async function exportUsers(request) {
  await requireAdmin(request);
  const { rows } = await queryUsers(new URL(request.url), { limit: 100000, offset: 0 });
  const cols = ['name', 'email', 'install', 'version', 'os', 'platform', 'source', 'installedAt', 'registeredAt', 'firstSeen', 'lastSeen', 'sessions', 'seconds', 'links', 'jobs', 'files', 'bytes', 'stats'];
  const cell = (v) => {
    const s = v instanceof Date ? v.toISOString() : v === null || v === undefined ? '' : String(v);
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // no spreadsheet formulas
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const body = [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n');
  return text(body, 200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="eastape-users-${new Date().toISOString().slice(0, 10)}.csv"`,
  });
}

// ---------------------------------------------------------------- support

/** GET /api/admin/support?status=open */
export async function listSupport(request) {
  await requireAdmin(request);
  const url = new URL(request.url);
  const status = ['open', 'answered', 'closed'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : null;
  const sql = db();
  const rows = await sql`
    select * from support_tickets where (${status}::text is null or status = ${status})
    order by created_at desc limit 200`;
  const counts = await sql`select status, count(*) as n from support_tickets group by 1`;
  return json({
    ok: true,
    counts: Object.fromEntries(counts.map((c) => [c.status, N(c.n)])),
    rows: rows.map((r) => ({
      id: N(r.id), install: r.install_id, name: r.name, email: r.email, topic: r.topic, message: r.message,
      details: r.details, version: r.app_version, os: r.os, status: r.status, note: r.note, createdAt: r.created_at, updatedAt: r.updated_at,
    })),
  });
}

/** PATCH /api/admin/support/:id */
export async function updateSupport(request, { id }) {
  await requireAdmin(request, { write: true });
  const body = await readJson(request, 32 * 1024);
  const status = body.status === undefined ? null : ['open', 'answered', 'closed'].includes(body.status) ? body.status : null;
  if (body.status !== undefined && !status) throw new HttpError(400, 'Unknown status');
  const note = body.note === undefined ? undefined : str(body.note, 5000);
  const [row] = await db()`
    update support_tickets set
      status = coalesce(${status}, status),
      note = case when ${note !== undefined} then ${note ?? null} else note end,
      updated_at = now()
    where id = ${int(id, { min: 1 })} returning id`;
  if (!row) throw new HttpError(404, 'Not found');
  return json({ ok: true });
}

// ---------------------------------------------------------------- announcements

function announcementInput(body) {
  const level = ['info', 'success', 'warning', 'critical'].includes(body.level) ? body.level : 'info';
  const ctaUrl = str(body.ctaUrl, 500);
  if (ctaUrl && !/^https:\/\//i.test(ctaUrl)) throw new HttpError(400, 'Button link must start with https://');
  const minVersion = str(body.minVersion, 20);
  const maxVersion = str(body.maxVersion, 20);
  for (const v of [minVersion, maxVersion]) if (v && !VERSION_RE.test(v)) throw new HttpError(400, 'Versions look like 1.2.0');
  const date = (v) => {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) throw new HttpError(400, 'Invalid date');
    return d;
  };
  return {
    title: str(body.title, 120, { required: true, name: 'Title' }),
    body: str(body.body, 2000) || '',
    level,
    cta_label: str(body.ctaLabel, 40),
    cta_url: ctaUrl,
    min_version: minVersion,
    max_version: maxVersion,
    starts_at: date(body.startsAt) || new Date(),
    ends_at: date(body.endsAt),
    dismissible: bool(body.dismissible, true),
    active: bool(body.active, true),
  };
}

const announcementOut = (r) => ({
  id: N(r.id), title: r.title, body: r.body, level: r.level, ctaLabel: r.cta_label, ctaUrl: r.cta_url,
  minVersion: r.min_version, maxVersion: r.max_version, startsAt: r.starts_at, endsAt: r.ends_at,
  dismissible: r.dismissible, active: r.active, createdAt: r.created_at, seen: N(r.seen), clicked: N(r.clicked),
});

/** GET /api/admin/announcements */
export async function listAnnouncements(request) {
  await requireAdmin(request);
  const rows = await db()`
    select a.*,
      (select count(distinct install_id) from events where type = 'announcement_seen' and props->>'id' = a.id::text) as seen,
      (select count(distinct install_id) from events where type = 'announcement_clicked' and props->>'id' = a.id::text) as clicked
    from announcements a order by a.created_at desc limit 200`;
  return json({ ok: true, rows: rows.map(announcementOut) });
}

/** POST /api/admin/announcements */
export async function createAnnouncement(request) {
  await requireAdmin(request, { write: true });
  const a = announcementInput(await readJson(request, 32 * 1024));
  const [row] = await db()`insert into announcements ${db()(a)} returning *`;
  return json({ ok: true, row: announcementOut(row) });
}

/** PATCH /api/admin/announcements/:id */
export async function updateAnnouncement(request, { id }) {
  await requireAdmin(request, { write: true });
  const a = announcementInput(await readJson(request, 32 * 1024));
  const sql = db();
  const [row] = await sql`update announcements set ${sql(a)}, updated_at = now() where id = ${int(id, { min: 1 })} returning *`;
  if (!row) throw new HttpError(404, 'Not found');
  return json({ ok: true, row: announcementOut(row) });
}

/** DELETE /api/admin/announcements/:id */
export async function deleteAnnouncement(request, { id }) {
  await requireAdmin(request, { write: true });
  await db()`delete from announcements where id = ${int(id, { min: 1 })}`;
  return json({ ok: true });
}

// ---------------------------------------------------------------- team

/** GET /api/admin/team */
export async function listTeam(request) {
  await requireAdmin(request);
  const rows = await db()`select id, email, name, role, created_at, last_login from admin_users order by created_at`;
  return json({ ok: true, rows: rows.map((r) => ({ id: N(r.id), email: r.email, name: r.name, role: r.role, createdAt: r.created_at, lastLogin: r.last_login })) });
}

/** POST /api/admin/team — owners add people; returns a one-time password. */
export async function addTeamMember(request) {
  const me = await requireAdmin(request, { write: true });
  if (me.role !== 'owner') throw new HttpError(403, 'Only the owner can add people.');
  const body = await readJson(request, 8 * 1024);
  const email = (str(body.email, 200, { required: true, name: 'Email' }) || '').toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  const role = ['admin', 'viewer'].includes(body.role) ? body.role : 'viewer';
  const password = randomToken(12);
  const sql = db();
  const [exists] = await sql`select id from admin_users where lower(email) = ${email}`;
  if (exists) throw new HttpError(409, 'That person already has access.');
  await sql`insert into admin_users (email, name, role, password_hash) values (${email}, ${str(body.name, 100) || ''}, ${role}, ${hashPassword(password)})`;
  return json({ ok: true, password });
}

/** DELETE /api/admin/team/:id */
export async function removeTeamMember(request, { id }) {
  const me = await requireAdmin(request, { write: true });
  if (me.role !== 'owner') throw new HttpError(403, 'Only the owner can remove people.');
  if (int(id) === Number(me.id)) throw new HttpError(400, "You can't remove yourself.");
  await db()`delete from admin_users where id = ${int(id, { min: 1 })} and role <> 'owner'`;
  return json({ ok: true });
}
