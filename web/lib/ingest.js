import { db } from './db.js';
import { HttpError, json, readJson, str, EMAIL_RE } from './http.js';
import { requireAppKey, INSTALL_ID_RE } from './appkey.js';
import { VERSION_RE } from './semver.js';

// Every event type the app may send. Anything else is dropped.
const TYPES = new Set([
  'install', 'update', 'reinstall', 'first_run', // installation notices
  'register', 'support',
  'session_start', 'session_end', 'heartbeat',
  'scan', 'job', 'feature', 'setting', 'error',
  'update_offered', 'update_started', 'update_installed', 'update_failed',
  'announcement_seen', 'announcement_clicked', 'announcement_dismissed',
  'stats_enabled', 'stats_disabled',
]);
const INSTALL_TYPES = new Set(['install', 'update', 'reinstall', 'first_run']);

const MAX_EVENTS = 200;
const MAX_PER_HOUR = 3000;
const DAY = 86400 * 1000;

/** Keeps a small, flat-ish object of safe values. */
export function cleanProps(obj, depth = 0) {
  const out = {};
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (n >= 30) break;
    if (!/^[A-Za-z0-9_]{1,40}$/.test(k)) continue;
    let val;
    if (typeof v === 'string') val = v.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 200);
    else if (typeof v === 'number') val = Number.isFinite(v) ? v : undefined;
    else if (typeof v === 'boolean' || v === null) val = v;
    else if (Array.isArray(v)) val = v.filter((x) => ['string', 'number', 'boolean'].includes(typeof x)).slice(0, 20).map((x) => (typeof x === 'string' ? x.slice(0, 100) : x));
    else if (typeof v === 'object' && depth < 1) val = cleanProps(v, depth + 1);
    if (val === undefined) continue;
    out[k] = val;
    n++;
  }
  return out;
}

const num = (v, max = Number.MAX_SAFE_INTEGER) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
};

function eventTime(ts, now) {
  const t = Date.parse(ts);
  if (!Number.isFinite(t) || t > now + DAY || t < now - 60 * DAY) return new Date(now);
  return new Date(t);
}

/** POST /api/v1/ingest — a batch of events from one installation. */
export async function ingest(request) {
  requireAppKey(request);
  const body = await readJson(request, 512 * 1024);
  const installId = String(body.installId || '').toLowerCase();
  if (!INSTALL_ID_RE.test(installId)) throw new HttpError(400, 'Invalid installId');
  const appVersion = VERSION_RE.test(String(body.appVersion || '')) ? body.appVersion : null;
  const os = str(body.os, 80);
  const source = str(body.source, 40);
  const statsEnabled = body.stats !== false;
  const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];

  const sql = db();
  const n = Math.max(1, events.length);
  const [inst] = await sql`
    insert into installs (id, app_version, os, source, stats_enabled, rl_window, rl_count)
    values (${installId}, ${appVersion}, ${os}, ${source}, ${statsEnabled}, now(), ${n})
    on conflict (id) do update set
      last_seen = now(),
      app_version = coalesce(excluded.app_version, installs.app_version),
      os = coalesce(excluded.os, installs.os),
      stats_enabled = excluded.stats_enabled,
      rl_window = case when installs.rl_window is null or installs.rl_window < now() - interval '1 hour' then now() else installs.rl_window end,
      rl_count = case when installs.rl_window is null or installs.rl_window < now() - interval '1 hour' then ${n} else installs.rl_count + ${n} end
    returning rl_count`;
  if (inst.rl_count > MAX_PER_HOUR) throw new HttpError(429, 'Too many events');

  const now = Date.now();
  const rows = [];
  const delta = { sessions: 0, seconds: 0, links: 0, jobs: 0, files: 0, bytes: 0 };
  let lastState = null, lastBps = null, installedAt = null, installSource = null;

  await sql.begin(async (tx) => {
    for (const ev of events) {
      if (!ev || typeof ev !== 'object' || !TYPES.has(ev.type)) continue;
      const ts = eventTime(ev.ts, now);
      const p = ev.props && typeof ev.props === 'object' && !Array.isArray(ev.props) ? ev.props : {};
      let props = {};
      switch (ev.type) {
        case 'register': {
          const name = str(p.name, 100);
          const email = str(p.email, 200);
          if (!name || !email || !EMAIL_RE.test(email)) continue;
          const [u] = await tx`
            insert into users (name, email) values (${name}, ${email})
            on conflict ((lower(email))) do update set name = excluded.name, last_seen = now()
            returning id`;
          await tx`update installs set user_id = ${u.id} where id = ${installId}`;
          props = { updated: p.source === 'profile updated' };
          break;
        }
        case 'support': {
          const name = str(p.name, 100);
          const email = str(p.email, 200);
          const message = typeof p.message === 'string' ? p.message.trim().slice(0, 5000) : '';
          if (!name || !email || !EMAIL_RE.test(email) || message.length < 2) continue;
          await tx`
            insert into support_tickets (install_id, name, email, topic, message, details, app_version, os, created_at)
            values (${installId}, ${name}, ${email}, ${str(p.topic, 60)}, ${message},
                    ${typeof p.details === 'string' ? p.details.slice(0, 20000) : null}, ${appVersion}, ${os}, ${ts})`;
          props = { topic: str(p.topic, 60) };
          break;
        }
        default:
          props = cleanProps(p);
      }

      if (INSTALL_TYPES.has(ev.type)) {
        installedAt = installedAt || ts;
        installSource = str(p.source, 40) || installSource;
      } else if (ev.type === 'session_start') {
        delta.sessions++;
      } else if (ev.type === 'session_end') {
        delta.seconds += num(props.durationSec, 2 * 86400);
      } else if (ev.type === 'heartbeat') {
        lastState = typeof props.state === 'string' ? props.state.slice(0, 20) : null;
        lastBps = num(props.bps, 1e11);
      } else if (ev.type === 'scan') {
        if (props.ok) delta.links += Math.max(1, Math.min(50, num(props.links) || 1));
      } else if (ev.type === 'job') {
        delta.jobs++;
        delta.files += num(props.filesDone, 1e7);
        delta.bytes += num(props.bytes, 1e13);
      }
      rows.push({ install_id: installId, type: ev.type, ts, app_version: appVersion, props: tx.json(props) });
    }

    if (rows.length) {
      await tx`insert into events ${tx(rows, 'install_id', 'type', 'ts', 'app_version', 'props')}`;
    }
    await tx`
      update installs set
        sessions = sessions + ${delta.sessions},
        active_seconds = active_seconds + ${Math.round(delta.seconds)},
        links_scanned = links_scanned + ${delta.links},
        jobs = jobs + ${delta.jobs},
        files_downloaded = files_downloaded + ${Math.round(delta.files)},
        bytes_downloaded = bytes_downloaded + ${Math.round(delta.bytes)},
        last_state = coalesce(${lastState}, last_state),
        last_bps = coalesce(${lastBps}, last_bps),
        installed_at = coalesce(installed_at, ${installedAt}),
        source = coalesce(${installSource}, source)
      where id = ${installId}`;
  });

  return json({ ok: true, accepted: rows.length });
}
