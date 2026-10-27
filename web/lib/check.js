import { db } from './db.js';
import { HttpError, json, str } from './http.js';
import { requireAppKey, INSTALL_ID_RE } from './appkey.js';
import { compareVersions, VERSION_RE } from './semver.js';
import { sha256Hex } from './crypto.js';

/** Which percentage bucket (0-99) an installation falls in for a release. */
export function rolloutBucket(installId, version) {
  return parseInt(sha256Hex(`${installId}:${version}`).slice(0, 8), 16) % 100;
}

/** Picks the update to offer, or null. */
export function pickUpdate(releases, installId, current) {
  const newer = releases
    .filter((r) => compareVersions(r.version, current) > 0)
    .sort((a, b) => compareVersions(b.version, a.version));
  for (const r of newer) {
    const tooOld = r.min_supported && compareVersions(current, r.min_supported) < 0;
    if (tooOld || rolloutBucket(installId, r.version) < r.rollout) {
      return {
        version: r.version,
        notes: r.notes,
        mandatory: r.mandatory || Boolean(tooOld),
        url: r.file_url,
        size: Number(r.size),
        sha256: r.sha256,
        signature: r.signature,
        publishedAt: r.published_at,
      };
    }
  }
  return null;
}

/** GET /api/v1/check — is there an update, and which messages to show. */
export async function check(request) {
  requireAppKey(request);
  const url = new URL(request.url);
  const installId = String(url.searchParams.get('installId') || '').toLowerCase();
  const version = url.searchParams.get('version') || '';
  const channel = str(url.searchParams.get('channel'), 20) || 'stable';
  if (!INSTALL_ID_RE.test(installId)) throw new HttpError(400, 'Invalid installId');
  if (!VERSION_RE.test(version)) throw new HttpError(400, 'Invalid version');

  const sql = db();
  await sql`
    insert into installs (id, app_version, source) values (${installId}, ${version}, 'app')
    on conflict (id) do update set last_seen = now(), app_version = excluded.app_version`;

  const releases = await sql`
    select version, notes, mandatory, min_supported, rollout, file_url, size, sha256, signature, published_at
    from releases where channel = ${channel} and status = 'published'`;
  const notices = await sql`
    select id, title, body, level, cta_label, cta_url, dismissible, starts_at, min_version, max_version
    from announcements
    where active and starts_at <= now() and (ends_at is null or ends_at > now())
    order by starts_at desc limit 20`;

  const announcements = notices
    .filter((a) => (!a.min_version || compareVersions(version, a.min_version) >= 0) && (!a.max_version || compareVersions(version, a.max_version) <= 0))
    .map((a) => ({
      id: Number(a.id),
      title: a.title,
      body: a.body,
      level: a.level,
      ctaLabel: a.cta_label || '',
      ctaUrl: a.cta_url || '',
      dismissible: a.dismissible,
      startsAt: a.starts_at,
    }));

  return json({ ok: true, serverTime: new Date().toISOString(), update: pickUpdate(releases, installId, version), announcements });
}
