import crypto from 'node:crypto';
import { handleUpload } from '@vercel/blob/client';
import { del } from '@vercel/blob';
import { db } from '../db.js';
import { HttpError, json, readJson, str, int, bool } from '../http.js';
import { requireAdmin } from '../auth.js';
import { signUpdate, signingPublicKey } from '../crypto.js';
import { VERSION_RE } from '../semver.js';

const N = (v) => Number(v || 0);
const MAX_SIZE = 300 * 1024 * 1024;
const ALLOWED_HOSTS = [/\.public\.blob\.vercel-storage\.com$/, /^github\.com$/, /^objects\.githubusercontent\.com$/, /^release-assets\.githubusercontent\.com$/];

const out = (r, adoption) => ({
  id: N(r.id), version: r.version, channel: r.channel, url: r.file_url, fileName: r.file_name, size: N(r.size),
  sha256: r.sha256, notes: r.notes, mandatory: r.mandatory, minSupported: r.min_supported, rollout: r.rollout,
  status: r.status, createdAt: r.created_at, publishedAt: r.published_at, installs: adoption?.[r.version] || 0,
});

/** GET /api/admin/releases */
export async function listReleases(request) {
  await requireAdmin(request);
  const sql = db();
  const rows = await sql`select * from releases order by created_at desc limit 100`;
  const adoption = await sql`
    select app_version, count(*) as n from installs where last_seen > now() - interval '30 days' group by 1`;
  const byVersion = Object.fromEntries(adoption.map((a) => [a.app_version, N(a.n)]));
  return json({ ok: true, rows: rows.map((r) => out(r, byVersion)), publicKey: signingPublicKey(), blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN) });
}

/**
 * POST /api/admin/releases/upload — gives the dashboard a short-lived token
 * to upload an installer straight to Vercel Blob (installers are too big to
 * pass through a function).
 */
export async function uploadToken(request) {
  await requireAdmin(request, { write: true });
  const body = await readJson(request, 64 * 1024);
  const result = await handleUpload({
    body,
    request,
    onBeforeGenerateToken: async (pathname) => {
      if (!/^releases\/[\w.-]+\.exe$/.test(pathname)) throw new HttpError(400, 'Upload an .exe installer');
      return {
        allowedContentTypes: ['application/octet-stream', 'application/x-msdownload', 'application/vnd.microsoft.portable-executable', 'application/x-msdos-program'],
        maximumSizeInBytes: MAX_SIZE,
        addRandomSuffix: true,
      };
    },
  });
  return json(result);
}

/** Downloads the installer and returns its size and SHA-256. */
async function fingerprint(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new HttpError(400, `Couldn't download the installer (HTTP ${res.status}).`);
  const hash = crypto.createHash('sha256');
  let size = 0;
  let head = null;
  for await (const chunk of res.body) {
    const buf = Buffer.from(chunk);
    if (!head) head = buf.subarray(0, 2);
    size += buf.length;
    if (size > MAX_SIZE) throw new HttpError(400, 'The installer is too large.');
    hash.update(buf);
  }
  if (!head || head.toString('latin1') !== 'MZ') throw new HttpError(400, "That file isn't a Windows program (.exe).");
  return { size, sha256: hash.digest('hex') };
}

/** POST /api/admin/releases — register an uploaded installer as a draft update. */
export async function createRelease(request) {
  await requireAdmin(request, { write: true });
  const body = await readJson(request, 64 * 1024);
  const version = str(body.version, 20, { required: true, name: 'Version' });
  if (!VERSION_RE.test(version)) throw new HttpError(400, 'Version must look like 1.2.0');
  const url = str(body.url, 1000, { required: true, name: 'Installer' });
  let host;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') throw new Error();
    host = u.hostname;
  } catch {
    throw new HttpError(400, 'The installer link must be an https:// link.');
  }
  if (!ALLOWED_HOSTS.some((re) => re.test(host))) throw new HttpError(400, 'Upload the installer here, or use a GitHub release link.');
  const minSupported = str(body.minSupported, 20);
  if (minSupported && !VERSION_RE.test(minSupported)) throw new HttpError(400, 'Minimum version must look like 1.1.0');
  const channel = str(body.channel, 20) || 'stable';

  const sql = db();
  const [dup] = await sql`select id from releases where channel = ${channel} and version = ${version}`;
  if (dup) throw new HttpError(409, `Version ${version} already exists.`);

  const { size, sha256 } = await fingerprint(url);
  const signature = signUpdate({ version, sha256, size, url });
  const [row] = await sql`
    insert into releases (version, channel, file_url, file_name, size, sha256, signature, notes, mandatory, min_supported, rollout)
    values (${version}, ${channel}, ${url}, ${str(body.fileName, 200) || decodeURIComponent(url.split('/').pop())}, ${size}, ${sha256}, ${signature},
            ${str(body.notes, 5000) || ''}, ${bool(body.mandatory)}, ${minSupported}, ${int(body.rollout, { min: 0, max: 100, fallback: 100 })})
    returning *`;
  return json({ ok: true, row: out(row) });
}

/** PATCH /api/admin/releases/:id — publish, pause, change rollout or notes. */
export async function updateRelease(request, { id }) {
  await requireAdmin(request, { write: true });
  const body = await readJson(request, 64 * 1024);
  const status = body.status === undefined ? null : ['draft', 'published', 'paused'].includes(body.status) ? body.status : null;
  if (body.status !== undefined && !status) throw new HttpError(400, 'Unknown status');
  const minSupported = body.minSupported === undefined ? undefined : str(body.minSupported, 20);
  if (minSupported && !VERSION_RE.test(minSupported)) throw new HttpError(400, 'Minimum version must look like 1.1.0');
  const sql = db();
  const [row] = await sql`
    update releases set
      status = coalesce(${status}, status),
      published_at = case when ${status} = 'published' and published_at is null then now() else published_at end,
      rollout = coalesce(${body.rollout === undefined ? null : int(body.rollout, { min: 0, max: 100 })}, rollout),
      notes = coalesce(${body.notes === undefined ? null : str(body.notes, 5000) || ''}, notes),
      mandatory = coalesce(${body.mandatory === undefined ? null : bool(body.mandatory)}, mandatory),
      min_supported = case when ${minSupported !== undefined} then ${minSupported ?? null} else min_supported end
    where id = ${int(id, { min: 1 })} returning *`;
  if (!row) throw new HttpError(404, 'Not found');
  return json({ ok: true, row: out(row) });
}

/** DELETE /api/admin/releases/:id — only updates that were never published. */
export async function deleteRelease(request, { id }) {
  await requireAdmin(request, { write: true });
  const sql = db();
  const [row] = await sql`select * from releases where id = ${int(id, { min: 1 })}`;
  if (!row) throw new HttpError(404, 'Not found');
  if (row.published_at) throw new HttpError(400, 'This update was published. Pause it instead of deleting it.');
  await sql`delete from releases where id = ${row.id}`;
  if (/\.public\.blob\.vercel-storage\.com$/.test(new URL(row.file_url).hostname) && process.env.BLOB_READ_WRITE_TOKEN) {
    await del(row.file_url).catch(() => {});
  }
  return json({ ok: true });
}
