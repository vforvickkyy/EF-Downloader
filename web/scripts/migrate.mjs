// Applies migrations/NNN_*.sql that haven't run yet:  DATABASE_URL=... node scripts/migrate.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, closeDb } from '../lib/db.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const sql = db();
await sql`create table if not exists schema_migrations (version int primary key, applied_at timestamptz not null default now())`;
const done = new Set((await sql`select version from schema_migrations`).map((r) => r.version));
for (const file of fs.readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()) {
  const version = parseInt(file, 10);
  if (done.has(version)) continue;
  await sql.unsafe(fs.readFileSync(path.join(dir, file), 'utf8'));
  console.log('applied', file);
}
await closeDb();
