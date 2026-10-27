import crypto from 'node:crypto';
import { db } from './db.js';
import { updateSigningText } from './crypto.js';

// The Ed25519 key that signs updates. RELEASE_SIGNING_KEY (PKCS#8, base64)
// wins when set; otherwise the service creates a key on first use and keeps
// it in the database, so the private key is never handled by a person.
let cached;

async function privateKey() {
  if (process.env.RELEASE_SIGNING_KEY) {
    return crypto.createPrivateKey({ key: Buffer.from(process.env.RELEASE_SIGNING_KEY, 'base64'), format: 'der', type: 'pkcs8' });
  }
  if (!cached) {
    const sql = db();
    const fresh = crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
    // Two first requests at once keep whichever key was stored first.
    await sql`insert into server_keys (name, value) values ('release_signing_key', ${fresh}) on conflict (name) do nothing`;
    const [row] = await sql`select value from server_keys where name = 'release_signing_key'`;
    cached = crypto.createPrivateKey({ key: Buffer.from(row.value, 'base64'), format: 'der', type: 'pkcs8' });
  }
  return cached;
}

/** Signs an update offer (see updateSigningText). */
export async function signUpdate(fields) {
  return crypto.sign(null, Buffer.from(updateSigningText(fields)), await privateKey()).toString('base64');
}

/** The raw 32-byte public key (base64) the app must have built in. */
export async function signingPublicKey() {
  const der = crypto.createPublicKey(await privateKey()).export({ format: 'der', type: 'spki' });
  return der.subarray(der.length - 32).toString('base64');
}

/** For tests. */
export function forgetSigningKey() {
  cached = undefined;
}
