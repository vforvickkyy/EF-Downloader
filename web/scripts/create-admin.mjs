// Creates (or resets) a dashboard account and prints a one-time password:
//   DATABASE_URL=... node scripts/create-admin.mjs you@example.com [owner|admin|viewer]
import { db, closeDb } from '../lib/db.js';
import { hashPassword, randomToken } from '../lib/crypto.js';

const email = (process.argv[2] || '').toLowerCase();
const role = process.argv[3] || 'owner';
if (!email.includes('@')) { console.error('usage: create-admin.mjs email [role]'); process.exit(1); }
const password = randomToken(12);
const sql = db();
await sql`
  insert into admin_users (email, role, password_hash) values (${email}, ${role}, ${hashPassword(password)})
  on conflict ((lower(email))) do update set password_hash = excluded.password_hash, role = excluded.role`;
console.log(`${email} (${role}) password: ${password}`);
await closeDb();
