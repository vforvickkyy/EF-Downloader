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
| `GET /api/v1/update-key` | the public key updates are signed with |
| `/api/admin/*` | the dashboard (signed-in session + `x-eastape-dashboard` header) |
| `GET /api/cron/daily` | Vercel Cron: daily totals, removes raw events older than 180 days |

## Environment variables (Vercel project settings)

| Name | What |
|---|---|
| `DATABASE_URL` | Neon connection string (pooled) |
| `APP_KEY` | shared key built into the app (`EASTAPE_APP_KEY` when building) |
| `RELEASE_SIGNING_KEY` | optional. Without it the service creates its own update signing key on first use and keeps it in the database (`server_keys`); `GET /api/v1/update-key` shows the public half, which is built into the app. The app only installs updates signed with that key, so don't delete that row. |
| `CRON_SECRET` | optional; lets only Vercel Cron run the daily job (without it the job runs at most every 30 minutes) |
| `BLOB_READ_WRITE_TOKEN` | added automatically when the Blob store is connected |

## The dashboard

- **Overview**: who is using the app right now (refreshes every 15 seconds), the
  chosen period (7, 30 or 90 days) against the one before it, daily trends, all-time
  totals, breakdowns (platform, version, system, link types, features, problems) and
  the latest activity.
- **Activity**: every event, newest first, grouped by day. Filter by type or search
  by name, email or install ID; scroll or press *Load more* to go back as far as the
  raw events go (180 days). New events wait behind a "new events" button.
- **Users**: everyone who installed the app. Filter by status (signed up, active,
  online, downloading), platform and version; sort by recent activity, install date,
  name, data, downloads, files or time in the app (also by clicking the column
  headings); 25, 50 or 100 rows per page; export the current view as CSV. Click a
  person for a side panel with their numbers, details, support messages and their
  own activity.
- **Support**, **Updates**, **Announcements**, **Team** as before.

Filters, sorting and an open user are kept in the address, so a view can be
bookmarked or shared with the team. **Refresh** (or <kbd>R</kbd>) reloads the page's
numbers; <kbd>/</kbd> searches; <kbd>G</kbd> then <kbd>O</kbd>/<kbd>A</kbd>/<kbd>U</kbd>/<kbd>S</kbd>
opens Overview, Activity, Users or Support. The theme (system, light or dark) is in
the account menu.

## Publishing an update

1. Build the new version: `scripts/build-windows.sh` (Setup `.exe`) or, on a Mac,
   `scripts/build-macos.sh` (`.dmg`), or take them from GitHub Actions.
2. Dashboard → **Updates** → **New update**: platform, version, the file, release notes.
   The server checks the file, records its SHA-256 and signs it.
3. **Publish**, starting with a small rollout and raising it later. The app checks at
   start and every few hours. On Windows it downloads the Setup, verifies the
   signature and installs it silently; on the Mac it offers the new disk image.

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
