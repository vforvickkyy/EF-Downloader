import postgres from 'postgres';

let client;

/** Shared Postgres client (Neon's pooled connection in production). */
export function db() {
  if (!client) {
    const raw = process.env.DATABASE_URL;
    if (!raw) throw new Error('DATABASE_URL is not set');
    // Neon's connection strings carry libpq-only options; postgres.js would
    // send them to the server as settings. TLS is set below instead.
    const parsed = new URL(raw);
    parsed.searchParams.delete('channel_binding');
    parsed.searchParams.delete('sslmode');
    const url = parsed.toString();
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || url.includes('host=/');
    client = postgres(url, {
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false, // required by Neon's transaction pooler
      ssl: local ? false : 'require',
      transform: { undefined: null },
      onnotice: () => {},
    });
  }
  return client;
}

/** For tests: close and forget the client. */
export async function closeDb() {
  if (client) {
    await client.end({ timeout: 2 });
    client = undefined;
  }
}
