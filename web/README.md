# Eastape Downloader cloud

Usage stats, in-app updates, announcements, support messages and the admin
dashboard for Eastape Downloader. Hosted on **Vercel** (functions in Singapore,
`sin1`) with a **Neon** Postgres database and **Vercel Blob** for update files.

```
web/
  api/main.js          the one Vercel Function (all /api/* routes, see vercel.json)
  lib/                 API code: ingest, update check, dashboard, auth, cron
  migrations/          database schema
  public/              the admin dashboard (plain HTML/CSS/JS, no build step)
  scripts/             local dev server, migrations, admin accounts, signing key
  test/                API tests (need a local Postgres)
```

## Endpoints

| | |
|---|---|
| `POST /api/v1/ingest` | the app sends batches of usage events (`x-app-key` header) |
| `GET /api/v1/check` | the app asks for updates and announcements (`x-app-key`) |
| `GET /api/v1/health` | status check |
| `/api/admin/*` | the dashboard (signed-in session + `x-eastape-dashboard` header) |
| `GET /api/cron/daily` | Vercel Cron: daily totals, removes raw events older than 180 days |

## Environment variables (Vercel project settings)

| Name | What |
|---|---|
| `DATABASE_URL` | Neon connection string (pooled) |
| `APP_KEY` | shared key built into the app (`EASTAPE_APP_KEY` when building) |
| `RELEASE_SIGNING_KEY` | Ed25519 private key that signs updates (`node scripts/gen-signing-key.mjs`). Keep a private backup: the app only installs updates signed with it. |
| `CRON_SECRET` | protects the daily cron job |
| `BLOB_READ_WRITE_TOKEN` | added automatically when the Blob store is connected |

## Publishing an update

1. Build the new Setup (`scripts/build-windows.sh` at the repository root).
2. Dashboard → **Updates** → **New update**: version, the Setup `.exe`, release notes.
   The server checks the file, records its SHA-256 and signs it.
3. **Publish**, starting with a small rollout and raising it later. The app checks at
   start and every few hours, downloads the Setup, verifies the signature and
   installs it silently.

## Local development

```sh
npm install
# a local Postgres
DATABASE_URL=postgres://postgres@127.0.0.1:5432/eastape npm run migrate
DATABASE_URL=... node scripts/create-admin.mjs you@example.com owner
DATABASE_URL=... APP_KEY=dev RELEASE_SIGNING_KEY=... npm run dev   # http://localhost:3000
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/eastape_test npm test   # wipes that database
```

`public/vendor/blob-client.js` is the browser build of `@vercel/blob/client`
(`npm run vendor` rebuilds it), so the dashboard loads no third-party scripts.
