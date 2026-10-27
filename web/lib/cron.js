import { db } from './db.js';
import { HttpError, json } from './http.js';
import { safeEqual } from './crypto.js';

const RAW_EVENT_DAYS = 180;

/**
 * GET /api/cron/daily — run by Vercel Cron once a day: saves yesterday's
 * totals (kept forever) and removes old raw events and expired sessions.
 * With CRON_SECRET set, only Vercel Cron can call it; without, anyone can,
 * but it runs at most once every 30 minutes (the work is safe to repeat).
 */
export async function daily(request) {
  const secret = process.env.CRON_SECRET;
  const sql = db();
  if (secret) {
    if (!safeEqual(request.headers.get('authorization'), `Bearer ${secret}`)) throw new HttpError(401, 'Unauthorized');
  } else {
    const [ran] = await sql`
      insert into server_keys (name, value) values ('cron_last_run', now()::text)
      on conflict (name) do update set value = excluded.value
        where server_keys.value::timestamptz < now() - interval '30 minutes'
      returning name`;
    if (!ran) throw new HttpError(429, 'Ran recently');
  }
  await sql`
    insert into daily_stats (day, metric, value)
    select d.day, m.metric, m.value
    from (select (now() at time zone 'UTC')::date - 1 as day) d,
    lateral (
      select 'active_installs' as metric, count(distinct install_id)::numeric as value from events
        where ts >= d.day and ts < d.day + 1
      union all select 'new_installs', count(*) from installs where first_seen >= d.day and first_seen < d.day + 1
      union all select 'new_users', count(*) from users where created_at >= d.day and created_at < d.day + 1
      union all select 'bytes', coalesce(sum((props->>'bytes')::numeric), 0) from events where type = 'job' and ts >= d.day and ts < d.day + 1
      union all select 'files', coalesce(sum((props->>'filesDone')::numeric), 0) from events where type = 'job' and ts >= d.day and ts < d.day + 1
      union all select 'scans', count(*) from events where type = 'scan' and ts >= d.day and ts < d.day + 1
      union all select 'session_seconds', coalesce(sum((props->>'durationSec')::numeric), 0) from events where type = 'session_end' and ts >= d.day and ts < d.day + 1
    ) m
    on conflict (day, metric) do update set value = excluded.value`;
  const removed = await sql`delete from events where ts < now() - ${`${RAW_EVENT_DAYS} days`}::interval`;
  await sql`delete from admin_sessions where expires_at < now()`;
  await sql`delete from login_attempts where window_start < now() - interval '1 day'`;
  return json({ ok: true, removedEvents: removed.count });
}
