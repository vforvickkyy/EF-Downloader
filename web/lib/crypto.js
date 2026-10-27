import crypto from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const got = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * The text an update signature covers. The app rebuilds it from the update
 * offer and checks it with the public key built into the app.
 */
export function updateSigningText({ version, sha256, size, url }) {
  return `eastape-update-v1\n${version}\n${sha256}\n${size}\n${url}`;
}

/** Signs with the Ed25519 private key in RELEASE_SIGNING_KEY (PKCS#8, base64). */
export function signUpdate(fields) {
  const keyB64 = process.env.RELEASE_SIGNING_KEY;
  if (!keyB64) throw new Error('RELEASE_SIGNING_KEY is not set');
  const key = crypto.createPrivateKey({ key: Buffer.from(keyB64, 'base64'), format: 'der', type: 'pkcs8' });
  return crypto.sign(null, Buffer.from(updateSigningText(fields)), key).toString('base64');
}

/** The raw 32-byte public key matching RELEASE_SIGNING_KEY, base64. */
export function signingPublicKey() {
  const keyB64 = process.env.RELEASE_SIGNING_KEY;
  if (!keyB64) return null;
  const key = crypto.createPublicKey(crypto.createPrivateKey({ key: Buffer.from(keyB64, 'base64'), format: 'der', type: 'pkcs8' }));
  const der = key.export({ format: 'der', type: 'spki' });
  return der.subarray(der.length - 32).toString('base64');
}
