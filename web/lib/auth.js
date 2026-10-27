import { db } from './db.js';
import { HttpError, json, readJson, str, clientIp } from './http.js';
import { hashPassword, verifyPassword, randomToken, sha256Hex } from './crypto.js';

const COOKIE = 'et_session';
const SESSION_DAYS = 14;
const MAX_ATTEMPTS = 8; // per 15 minutes, per email and per IP

function cookies(request) {
  const out = {};
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(request, token, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

async function throttle(sql, key) {
  const [row] = await sql`
    insert into login_attempts (key, window_start, count) values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when login_attempts.window_start < now() - interval '15 minutes' then 1 else login_attempts.count + 1 end,
      window_start = case when login_attempts.window_start < now() - interval '15 minutes' then now() else login_attempts.window_start end
    returning count`;
  if (row.count > MAX_ATTEMPTS) throw new HttpError(429, 'Too many sign-in attempts. Try again in 15 minutes.');
}

/** POST /api/admin/login */
export async function login(request) {
  const body = await readJson(request, 8 * 1024);
  const email = (str(body.email, 200) || '').toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) throw new HttpError(400, 'Enter your email and password.');

  const sql = db();
  await throttle(sql, `email:${email}`);
  await throttle(sql, `ip:${clientIp(request)}`);

  const [user] = await sql`select id, email, name, role, password_hash from admin_users where lower(email) = ${email}`;
  // Hash even when the user doesn't exist, so timing doesn't reveal accounts.
  const ok = user ? verifyPassword(password, user.password_hash) : (verifyPassword(password, hashPassword('x')), false);
  if (!ok) throw new HttpError(401, 'Wrong email or password.');

  const token = randomToken();
  await sql`
    insert into admin_sessions (token_hash, user_id, expires_at)
    values (${sha256Hex(token)}, ${user.id}, now() + ${`${SESSION_DAYS} days`}::interval)`;
  await sql`update admin_users set last_login = now() where id = ${user.id}`;
  await sql`delete from login_attempts where key = ${`email:${email}`}`;
  return json({ ok: true, user: { email: user.email, name: user.name, role: user.role } }, 200, {
    'set-cookie': sessionCookie(request, token, SESSION_DAYS * 86400),
  });
}

/** POST /api/admin/logout */
export async function logout(request) {
  const token = cookies(request)[COOKIE];
  if (token) await db()`delete from admin_sessions where token_hash = ${sha256Hex(token)}`;
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(request, '', 0) });
}

/**
 * Returns the signed-in dashboard user or throws 401. Changes also need the
 * dashboard's own header, which other sites can't send (CSRF protection on
 * top of the SameSite cookie).
 */
export async function requireAdmin(request, { write = false, csrf = true } = {}) {
  const token = cookies(request)[COOKIE];
  if (!token) throw new HttpError(401, 'Please sign in.');
  const [user] = await db()`
    select u.id, u.email, u.name, u.role from admin_sessions s
    join admin_users u on u.id = s.user_id
    where s.token_hash = ${sha256Hex(token)} and s.expires_at > now()`;
  if (!user) throw new HttpError(401, 'Your session has expired. Please sign in again.');
  if (csrf && request.method !== 'GET' && request.headers.get('x-eastape-dashboard') !== '1') {
    throw new HttpError(403, 'Forbidden');
  }
  if (write && user.role === 'viewer') throw new HttpError(403, 'Your account can only view the dashboard.');
  return user;
}

/** GET /api/admin/me */
export async function me(request) {
  const user = await requireAdmin(request);
  return json({ ok: true, user: { email: user.email, name: user.name, role: user.role } });
}

/** POST /api/admin/password — change your own password. */
export async function changePassword(request) {
  const user = await requireAdmin(request);
  const body = await readJson(request, 8 * 1024);
  const current = String(body.current || '');
  const next = String(body.next || '');
  if (next.length < 10) throw new HttpError(400, 'Use at least 10 characters for the new password.');
  const sql = db();
  const [row] = await sql`select password_hash from admin_users where id = ${user.id}`;
  if (!verifyPassword(current, row.password_hash)) throw new HttpError(400, 'Your current password is wrong.');
  await sql`update admin_users set password_hash = ${hashPassword(next)} where id = ${user.id}`;
  // Sign out other devices.
  const token = cookies(request)[COOKIE];
  await sql`delete from admin_sessions where user_id = ${user.id} and token_hash <> ${sha256Hex(token)}`;
  return json({ ok: true });
}
