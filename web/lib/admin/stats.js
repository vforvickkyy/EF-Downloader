import { db } from '../db.js';
import { json, int } from '../http.js';
import { requireAdmin } from '../auth.js';

const N = (v) => Number(v || 0);

function timezone(url) {
  const tz = url.searchParams.get('tz') || 'UTC';
  return /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(tz) ? tz : 'UTC';
}

async function liveNumbers(sql, tz) {
  const [r] = await sql`
    select
      (select count(*) from installs where last_seen > now() - interval '15 minutes') as active_now,
      (select count(*) from installs where last_seen > now() - interval '15 minutes' and last_state = 'downloading') as downloading_now,
      (select coalesce(sum(last_bps), 0) from installs where last_seen > now() - interval '15 minutes' and last_state = 'downloading') as speed_now,
      (select coalesce(sum((props->>'bytes')::numeric), 0) from events
         where type = 'job' and ts >= (date_trunc('day', now() at time zone ${tz}) at time zone ${tz})) as bytes_today,
      (select count(*) from installs where first_seen >= (date_trunc('day', now() at time zone ${tz}) at time zone ${tz})) as installs_today,
      (select count(*) from support_tickets where status = 'open') as open_tickets`;
  return {
    activeNow: N(r.active_now),
    downloadingNow: N(r.downloading_now),
    speedNow: N(r.speed_now),
    bytesToday: N(r.bytes_today),
    installsToday: N(r.installs_today),
    openTickets: N(r.open_tickets),
  };
}

async function recentActivity(sql, limit) {
  const rows = await sql`
    select e.type, e.ts, e.props, e.install_id, e.app_version, u.name
    from events e
    left join installs i on i.id = e.install_id
    left join users u on u.id = i.user_id
    where e.type <> 'heartbeat'
    order by e.ts desc
    limit ${limit}`;
  return rows.map((r) => ({ type: r.type, ts: r.ts, props: r.props, install: r.install_id.slice(0, 8), version: r.app_version, name: r.name || null }));
}

/** GET /api/admin/live — the numbers that refresh every few seconds. */
export async function live(request) {
  await requireAdmin(request);
  const url = new URL(request.url);
  const sql = db();
  const tz = await safeTz(sql, timezone(url));
  const [numbers, activity] = await Promise.all([liveNumbers(sql, tz), recentActivity(sql, 25)]);
  return json({ ok: true, live: numbers, activity, serverTime: new Date().toISOString() });
}

async function safeTz(sql, tz) {
  try {
    await sql`select now() at time zone ${tz}`;
    return tz;
  } catch {
    return 'UTC';
  }
}

/** GET /api/admin/overview?days=30&tz=Asia/Kolkata */
export async function overview(request) {
  await requireAdmin(request);
  const url = new URL(request.url);
  const days = int(url.searchParams.get('days'), { min: 7, max: 365, fallback: 30 });
  const sql = db();
  const tz = await safeTz(sql, timezone(url));
  const since = sql`(date_trunc('day', now() at time zone ${tz}) - ${`${days - 1} days`}::interval) at time zone ${tz}`;

  const [totals] = await sql`
    select
      (select count(*) from installs) as installs,
      (select count(*) from users) as users,
      (select count(*) from installs where last_seen > now() - interval '1 day') as active_1d,
      (select count(*) from installs where last_seen > now() - interval '7 days') as active_7d,
      (select count(*) from installs where last_seen > now() - interval '30 days') as active_30d,
      (select coalesce(sum(bytes_downloaded), 0) from installs) as bytes,
      (select coalesce(sum(files_downloaded), 0) from installs) as files,
      (select coalesce(sum(links_scanned), 0) from installs) as links,
      (select coalesce(sum(jobs), 0) from installs) as jobs,
      (select coalesce(sum(sessions), 0) from installs) as sessions,
      (select coalesce(sum(active_seconds), 0) from installs) as seconds,
      (select avg((props->>'durationSec')::numeric) from events where type = 'session_end' and ts > now() - interval '30 days') as avg_session,
      (select avg((props->>'avgBps')::numeric) from events where type = 'job' and ts > now() - interval '30 days' and (props->>'bytes')::numeric > 1048576) as avg_speed,
      (select count(*) filter (where (props->>'ok')::boolean) * 100.0 / nullif(count(*), 0) from events where type = 'scan' and ts > now() - interval '30 days') as scan_success`;

  const perDayEvents = await sql`
    select (ts at time zone ${tz})::date as day,
           count(distinct install_id) as active,
           count(*) filter (where type = 'scan') as scans,
           count(*) filter (where type = 'job') as jobs,
           coalesce(sum((props->>'bytes')::numeric) filter (where type = 'job'), 0) as bytes,
           coalesce(sum((props->>'filesDone')::numeric) filter (where type = 'job'), 0) as files,
           coalesce(sum((props->>'durationSec')::numeric) filter (where type = 'session_end'), 0) as seconds
    from events where ts >= ${since}
    group by 1`;
  const perDayInstalls = await sql`
    select (first_seen at time zone ${tz})::date as day, count(*) as n from installs where first_seen >= ${since} group by 1`;
  const perDayUsers = await sql`
    select (created_at at time zone ${tz})::date as day, count(*) as n from users where created_at >= ${since} group by 1`;

  const key = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
  const byDay = new Map();
  const start = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(start.getTime() - i * 86400000);
    const k = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    byDay.set(k, { day: k, active: 0, scans: 0, jobs: 0, bytes: 0, files: 0, seconds: 0, installs: 0, users: 0 });
  }
  for (const r of perDayEvents) {
    const row = byDay.get(key(r.day));
    if (row) Object.assign(row, { active: N(r.active), scans: N(r.scans), jobs: N(r.jobs), bytes: N(r.bytes), files: N(r.files), seconds: N(r.seconds) });
  }
  for (const r of perDayInstalls) { const row = byDay.get(key(r.day)); if (row) row.installs = N(r.n); }
  for (const r of perDayUsers) { const row = byDay.get(key(r.day)); if (row) row.users = N(r.n); }

  const versions = await sql`
    select coalesce(app_version, 'unknown') as name, count(*) as n from installs
    where last_seen > now() - interval '30 days' group by 1 order by 2 desc limit 8`;
  const systems = await sql`
    select coalesce(split_part(os, ' (', 1), 'unknown') as name, count(*) as n from installs
    where last_seen > now() - interval '30 days' group by 1 order by 2 desc limit 8`;
  const errors = await sql`
    select coalesce(props->>'kind', 'other') as name, sum(coalesce((props->>'count')::int, 1)) as n from events
    where type = 'error' and ts > now() - interval '30 days' group by 1 order by 2 desc limit 8`;
  const features = await sql`
    select props->>'name' as name, count(*) as n from events
    where type = 'feature' and ts > now() - interval '30 days' and props ? 'name' group by 1 order by 2 desc limit 12`;
  const linkKinds = await sql`
    select k as name, sum(v::numeric) as n from events, jsonb_each_text(coalesce(props->'kinds', '{}'::jsonb)) as t(k, v)
    where type = 'scan' and ts > now() - interval '30 days' group by 1 order by 2 desc`;
  const top = (rows) => rows.map((r) => ({ name: r.name, n: N(r.n) }));

  const [numbers, activity] = await Promise.all([liveNumbers(sql, tz), recentActivity(sql, 25)]);
  return json({
    ok: true,
    tz,
    days,
    live: numbers,
    totals: {
      installs: N(totals.installs), users: N(totals.users),
      active1d: N(totals.active_1d), active7d: N(totals.active_7d), active30d: N(totals.active_30d),
      bytes: N(totals.bytes), files: N(totals.files), links: N(totals.links), jobs: N(totals.jobs),
      sessions: N(totals.sessions), seconds: N(totals.seconds),
      avgSession: N(totals.avg_session), avgSpeed: N(totals.avg_speed), scanSuccess: totals.scan_success === null ? null : N(totals.scan_success),
    },
    series: [...byDay.values()],
    versions: top(versions), systems: top(systems), errors: top(errors), features: top(features), linkKinds: top(linkKinds),
    activity,
  });
}
