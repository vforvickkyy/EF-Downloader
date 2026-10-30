import { db } from '../db.js';
import { HttpError, json, int, str } from '../http.js';
import { requireAdmin } from '../auth.js';

// Event types shown together under one filter in the dashboard.
export const ACTIVITY_GROUPS = {
  installs: ['install', 'reinstall', 'first_run'],
  registrations: ['register'],
  links: ['scan'],
  downloads: ['job'],
  problems: ['error', 'update_failed'],
  support: ['support'],
  updates: ['update', 'update_offered', 'update_started', 'update_installed', 'update_failed'],
  sessions: ['session_start', 'session_end'],
  announcements: ['announcement_seen', 'announcement_clicked', 'announcement_dismissed'],
  settings: ['feature', 'setting', 'stats_enabled', 'stats_disabled'],
};

// A page cursor is the event's time (to the microsecond, as stored) and ID. It
// goes to Postgres as text: as a date the driver would round it to milliseconds.
const CURSOR_RE = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z)_(\d{1,19})$/;

/** "2026-10-30T10:00:00.123456Z_123" → [time text, id], or null. */
function parseCursor(v) {
  if (!v) return null;
  const m = CURSOR_RE.exec(v);
  if (!m || Number.isNaN(Date.parse(m[1]))) throw new HttpError(400, 'Invalid cursor');
  return [m[1], m[2]];
}

const cursorOf = (r) => `${r.tkey}_${r.id}`;

function activityRow(r) {
  return {
    id: String(r.id), type: r.type, ts: r.ts, props: r.props,
    install: r.install_id.slice(0, 8), installId: r.install_id,
    version: r.app_version, name: r.name || null, email: r.email || null,
    os: r.os ? r.os.split(' (')[0] : null,
  };
}

/**
 * Events, newest first, without heartbeats.
 *   before / after: cursors from an earlier page (older / newer events)
 *   group: a key of ACTIVITY_GROUPS; install: one installation; q: name, email or install ID
 */
export async function queryActivity({ limit = 50, before = null, after = null, group = null, install = null, q = '' } = {}) {
  const sql = db();
  const types = group ? ACTIVITY_GROUPS[group] : null;
  const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
  const b = parseCursor(before);
  const a = parseCursor(after);
  const where = sql`
    where e.type <> 'heartbeat'
      ${types ? sql`and e.type = any(${types})` : sql``}
      ${install ? sql`and e.install_id = ${install}` : sql``}
      ${q ? sql`and e.install_id in (
        select i2.id from installs i2 left join users u2 on u2.id = i2.user_id
        where u2.name ilike ${like} or u2.email ilike ${like} or i2.id ilike ${like})` : sql``}
      ${b ? sql`and (e.ts, e.id) < (${b[0]}::text::timestamptz, ${b[1]}::text::bigint)` : sql``}
      ${a ? sql`and (e.ts, e.id) > (${a[0]}::text::timestamptz, ${a[1]}::text::bigint)` : sql``}`;
  // Newer events are read oldest-first so a long gap is filled from its start.
  const rows = await sql`
    select e.id, e.type, e.ts, e.props, e.install_id, e.app_version, u.name, u.email, i.os,
           to_char(e.ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as tkey
    from events e
    left join installs i on i.id = e.install_id
    left join users u on u.id = i.user_id
    ${where}
    order by ${a ? sql`e.ts asc, e.id asc` : sql`e.ts desc, e.id desc`}
    limit ${limit + 1}`;
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  if (a) page.reverse();
  return {
    items: page.map(activityRow),
    // Cursor for the next (older) page; null at the end.
    next: !a && more ? cursorOf(page[page.length - 1]) : null,
    // Newest event on this page, to ask for anything newer later.
    newest: page.length ? cursorOf(page[0]) : after || null,
    more,
  };
}

/** GET /api/admin/activity?limit=&before=&after=&group=&install=&q= */
export async function listActivity(request) {
  await requireAdmin(request);
  const url = new URL(request.url);
  const p = url.searchParams;
  const group = p.get('group') && p.get('group') !== 'all' ? p.get('group') : null;
  if (group && !ACTIVITY_GROUPS[group]) throw new HttpError(400, 'Unknown activity type');
  const install = str(p.get('install'), 64);
  if (install && !/^[0-9a-f]{32}$/i.test(install)) throw new HttpError(400, 'Invalid install ID');
  const result = await queryActivity({
    limit: int(p.get('limit'), { min: 1, max: 100, fallback: 50 }),
    before: p.get('before'),
    after: p.get('after'),
    group,
    install: install ? install.toLowerCase() : null,
    q: (p.get('q') || '').trim().slice(0, 100),
  });
  return json({ ok: true, ...result });
}
