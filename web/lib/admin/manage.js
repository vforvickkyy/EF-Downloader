import { db } from '../db.js';
import { HttpError, json, text, readJson, str, int, bool, EMAIL_RE } from '../http.js';
import { requireAdmin } from '../auth.js';
import { hashPassword, randomToken } from '../crypto.js';
import { VERSION_RE } from '../semver.js';

const N = (v) => Number(v || 0);

// ---------------------------------------------------------------- users

function userRow(r) {
  return {
    install: r.id, name: r.name, email: r.email, firstSeen: r.first_seen, lastSeen: r.last_seen,
    installedAt: r.installed_at, version: r.app_version, os: r.os, source: r.source, stats: r.stats_enabled,
    state: r.last_state, sessions: N(r.sessions), seconds: N(r.active_seconds), links: N(r.links_scanned),
    jobs: N(r.jobs), files: N(r.files_downloaded), bytes: N(r.bytes_downloaded), registeredAt: r.registered_at,
  };
}

async function queryUsers(url, { limit, offset }) {
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const filter = url.searchParams.get('filter') || 'all';
  const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
  const sql = db();
  const where = sql`
    where (${q} = '' or u.name ilike ${like} or u.email ilike ${like} or i.id ilike ${like})
      and (${filter} <> 'registered' or u.id is not null)
      and (${filter} <> 'unregistered' or u.id is null)
      and (${filter} <> 'active' or i.last_seen > now() - interval '7 days')`;
  const rows = await sql`
    select i.*, u.name, u.email, u.created_at as registered_at
    from installs i left join users u on u.id = i.user_id
    ${where}
    order by i.last_seen desc
    limit ${limit} offset ${offset}`;
  const [{ n }] = await sql`select count(*) as n from installs i left join users u on u.id = i.user_id ${where}`;
  return { rows: rows.map(userRow), total: N(n) };
}

/** GET /api/admin/users?q=&filter=&page= */
export async function listUsers(request) {
  await requireAdmin(request);
  const url = new URL(request.url);
  const page = int(url.searchParams.get('page'), { min: 1, max: 100000, fallback: 1 });
  const { rows, total } = await queryUsers(url, { limit: 50, offset: (page - 1) * 50 });
  return json({ ok: true, rows, total, page, pageSize: 50 });
}

/** GET /api/admin/users.csv */
export async function exportUsers(request) {
  await requireAdmin(request);
  const { rows } = await queryUsers(new URL(request.url), { limit: 100000, offset: 0 });
  const cols = ['name', 'email', 'install', 'version', 'os', 'source', 'installedAt', 'firstSeen', 'lastSeen', 'sessions', 'seconds', 'links', 'jobs', 'files', 'bytes', 'stats'];
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
