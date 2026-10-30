import { db } from '../db.js';
import { json, int } from '../http.js';
import { requireAdmin } from '../auth.js';
import { queryActivity } from './activity.js';

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

async function recentActivity(limit) {
  const { items, newest } = await queryActivity({ limit });
  return { items, newest };
}

/** GET /api/admin/live — the numbers that refresh every few seconds. */
export async function live(request) {
  await requireAdmin(request);
  const url = new URL(request.url);
  const sql = db();
  const tz = await safeTz(sql, timezone(url));
  const [numbers, activity] = await Promise.all([liveNumbers(sql, tz), recentActivity(10)]);
  return json({ ok: true, live: numbers, activity: activity.items, serverTime: new Date().toISOString() });
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
  const platforms = await sql`
    select case when os ilike 'macOS%' then 'macOS' when os ilike 'Windows%' then 'Windows' else 'Other' end as name, count(*) as n
    from installs where last_seen > now() - interval '30 days' group by 1 order by 2 desc`;
  const top = (rows) => rows.map((r) => ({ name: r.name, n: N(r.n) }));

  // The same numbers for this period and the one before it, for the trend arrows.
  const prevSince = sql`(date_trunc('day', now() at time zone ${tz}) - ${`${2 * days - 1} days`}::interval) at time zone ${tz}`;
  const [ev] = await sql`
    select count(distinct install_id) filter (where ts >= ${since}) as active_cur,
           count(distinct install_id) filter (where ts < ${since}) as active_prev,
           coalesce(sum((props->>'bytes')::numeric) filter (where type = 'job' and ts >= ${since}), 0) as bytes_cur,
           coalesce(sum((props->>'bytes')::numeric) filter (where type = 'job' and ts < ${since}), 0) as bytes_prev,
           count(*) filter (where type = 'job' and ts >= ${since}) as jobs_cur,
           count(*) filter (where type = 'job' and ts < ${since}) as jobs_prev,
           coalesce(sum((props->>'filesDone')::numeric) filter (where type = 'job' and ts >= ${since}), 0) as files_cur,
           coalesce(sum((props->>'filesDone')::numeric) filter (where type = 'job' and ts < ${since}), 0) as files_prev,
           count(*) filter (where type = 'scan' and ts >= ${since}) as links_cur,
           count(*) filter (where type = 'scan' and ts < ${since}) as links_prev,
           coalesce(sum((props->>'durationSec')::numeric) filter (where type = 'session_end' and ts >= ${since}), 0) as seconds_cur,
           coalesce(sum((props->>'durationSec')::numeric) filter (where type = 'session_end' and ts < ${since}), 0) as seconds_prev
    from events where ts >= ${prevSince}`;
  const [ins] = await sql`
    select count(*) filter (where first_seen >= ${since}) as cur, count(*) filter (where first_seen < ${since}) as prev
    from installs where first_seen >= ${prevSince}`;
  const [reg] = await sql`
    select count(*) filter (where created_at >= ${since}) as cur, count(*) filter (where created_at < ${since}) as prev
    from users where created_at >= ${prevSince}`;
  const pair = (cur, prev) => ({ current: N(cur), previous: N(prev) });
  const compare = {
    activeUsers: pair(ev.active_cur, ev.active_prev),
    installs: pair(ins.cur, ins.prev),
    registrations: pair(reg.cur, reg.prev),
    bytes: pair(ev.bytes_cur, ev.bytes_prev),
    downloads: pair(ev.jobs_cur, ev.jobs_prev),
    files: pair(ev.files_cur, ev.files_prev),
    links: pair(ev.links_cur, ev.links_prev),
    seconds: pair(ev.seconds_cur, ev.seconds_prev),
  };

  const [numbers, activity] = await Promise.all([liveNumbers(sql, tz), recentActivity(10)]);
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
    compare,
    versions: top(versions), systems: top(systems), platforms: top(platforms), errors: top(errors), features: top(features), linkKinds: top(linkKinds),
    activity: activity.items,
    serverTime: new Date().toISOString(),
  });
}
