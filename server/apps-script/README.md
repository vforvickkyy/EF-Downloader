# Eastape Downloader relay

Version 1.1 of the app sends installation notices, registrations and support
messages to this small Google Apps Script web app, which emails them to Eastape
Tech. The app never contains an email address or mail password, and the
receiving addresses are kept in the script's properties, not in this repository:

| Event | Sent to (script property) |
|---|---|
| New installation / update / reinstall / portable first start | `INSTALLS_TO` |
| New user (name + email entered on first start) | `INSTALLS_TO` |
| Contact support form | `SUPPORT_TO` (reply goes straight to the user) |

Version 1.2 and later talk to the cloud dashboard in [`web/`](../../web) instead.
The relay can pass version 1.1 events on to that dashboard too (`CLOUD_URL`).

## Set it up (about 5 minutes)

1. Sign in to the Google account that should **send** these emails (any Gmail or
   Google Workspace account of Eastape), then open <https://script.google.com> →
   **New project**. Name it `Eastape Downloader Relay`.
2. Replace everything in `Code.gs` with the contents of [`Code.gs`](Code.gs) and
   press **Save**.
3. **Project Settings** (gear icon) → **Script properties** → **Add script property**:
   - `RELAY_TOKEN` = the token from your build configuration (`relay.env`, or the
     `EASTAPE_RELAY_TOKEN` GitHub secret).
   - `INSTALLS_TO` = the address that gets installation and new-user notices.
   - `SUPPORT_TO` = the address that gets Contact support messages.
   - Optional: `SHEET_ID` = the ID of a Google Sheet (the long part of its URL) to
     also log every event as a row.
   - Optional: `CLOUD_URL` = the dashboard's address and `CLOUD_APP_KEY` = its
     `APP_KEY`, so version 1.1 users also appear in the dashboard.
4. **Deploy** → **New deployment** → gear → **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone**
   - **Deploy**, then **Authorize access**. Google warns that the app isn't
     verified because it's your own script: click **Advanced** → **Go to Eastape
     Downloader Relay** → **Allow**.
5. Copy the **Web app URL** (ends in `/exec`). Opening it in a browser should show
   `{"ok":true,"service":"eastape-relay"}`.
6. Put the URL into the build configuration:
   - local builds: `EASTAPE_RELAY_URL=...` in `relay.env` at the project root
   - GitHub Actions: repository secrets `EASTAPE_RELAY_URL` and `EASTAPE_RELAY_TOKEN`

Builds made without a URL still work; their messages wait in the app's outbox and
are never delivered, so always set it before sharing an installer.

## Limits

- Google allows about **100 emails a day** from a free Gmail account and **1,500**
  from Google Workspace.
- The script accepts at most 20 events an hour per installation, 5 of them support
  messages, to stop spam.
- To change the receiving addresses, edit the `INSTALLS_TO` / `SUPPORT_TO` script
  properties. To change the code, paste the new `Code.gs` and deploy a **new
  version** (Deploy → Manage deployments → edit → New version). The URL stays the
  same, so the app doesn't need rebuilding.
