import { HttpError, json } from './http.js';
import { ingest } from './ingest.js';
import { check } from './check.js';
import { login, logout, me, changePassword } from './auth.js';
import { overview, live } from './admin/stats.js';
import {
  listUsers, exportUsers, listSupport, updateSupport,
  listAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement,
  listTeam, addTeamMember, removeTeamMember,
} from './admin/manage.js';
import { listReleases, uploadToken, createRelease, updateRelease, deleteRelease } from './admin/releases.js';
import { daily } from './cron.js';
import { db } from './db.js';
import { signingPublicKey } from './signing.js';

const routes = [
  ['GET', '/api/v1/health', health],
  ['GET', '/api/v1/update-key', updateKey],
  ['POST', '/api/v1/ingest', ingest],
  ['GET', '/api/v1/check', check],

  ['POST', '/api/admin/login', login],
  ['POST', '/api/admin/logout', logout],
  ['GET', '/api/admin/me', me],
  ['POST', '/api/admin/password', changePassword],
  ['GET', '/api/admin/overview', overview],
  ['GET', '/api/admin/live', live],
  ['GET', '/api/admin/users', listUsers],
  ['GET', '/api/admin/users.csv', exportUsers],
  ['GET', '/api/admin/support', listSupport],
  ['PATCH', '/api/admin/support/:id', updateSupport],
  ['GET', '/api/admin/releases', listReleases],
  ['POST', '/api/admin/releases/upload', uploadToken],
  ['POST', '/api/admin/releases', createRelease],
  ['PATCH', '/api/admin/releases/:id', updateRelease],
  ['DELETE', '/api/admin/releases/:id', deleteRelease],
  ['GET', '/api/admin/announcements', listAnnouncements],
  ['POST', '/api/admin/announcements', createAnnouncement],
  ['PATCH', '/api/admin/announcements/:id', updateAnnouncement],
  ['DELETE', '/api/admin/announcements/:id', deleteAnnouncement],
  ['GET', '/api/admin/team', listTeam],
  ['POST', '/api/admin/team', addTeamMember],
  ['DELETE', '/api/admin/team/:id', removeTeamMember],

  ['GET', '/api/cron/daily', daily],
].map(([method, pattern, handler]) => {
  const names = [];
  const re = new RegExp(`^${pattern.replace(/\./g, '\\.').replace(/:(\w+)/g, (_, n) => (names.push(n), '([^/]+)'))}/?$`);
  return { method, re, names, handler };
});

async function health() {
  const [row] = await db()`select max(version) as v from schema_migrations`;
  return json({ ok: true, service: 'eastape-downloader', schema: Number(row.v || 0), time: new Date().toISOString() });
}

/** The public key the app checks update signatures with (not a secret). */
async function updateKey() {
  return json({ ok: true, publicKey: await signingPublicKey() });
}

/** Routes a request to its handler and turns errors into JSON. */
export async function handle(request) {
  const url = new URL(request.url);
  // Vercel normally keeps the original path; the rewrite also passes it along.
  const path = url.pathname === '/api/main' ? url.searchParams.get('__path') || url.pathname : url.pathname;
  try {
    let pathMatched = false;
    for (const r of routes) {
      const m = path.match(r.re);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== request.method) continue;
      const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      return await r.handler(request, params);
    }
    throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'Method not allowed' : 'Not found');
  } catch (err) {
    if (err instanceof HttpError) return json({ ok: false, error: err.message }, err.status);
    console.error(`${request.method} ${path} failed:`, err);
    return json({ ok: false, error: 'Something went wrong. Please try again.' }, 500);
  }
}
