# Eastape Downloader relay

The app never contains an email address or mail password. Installation notices,
registrations and support messages are sent to this small Google Apps Script web
app, which emails them:

| Event | Sent to |
|---|---|
| New installation / update / reinstall / portable first start | `tech@eastapefilms.com` |
| New user (name + email entered on first start) | `tech@eastapefilms.com` |
| Contact support form | `info@eastapefilms.com` (reply goes straight to the user) |

## Set it up (about 5 minutes)

1. Sign in to the Google account that should **send** these emails (any Gmail or
   Google Workspace account of Eastape), then open <https://script.google.com> →
   **New project**. Name it `Eastape Downloader Relay`.
2. Replace everything in `Code.gs` with the contents of [`Code.gs`](Code.gs) and
   press **Save**.
3. **Project Settings** (gear icon) → **Script properties** → **Add script property**:
   - `RELAY_TOKEN` = the token from your build configuration (`relay.env`, or the
     `EASTAPE_RELAY_TOKEN` GitHub secret).
   - Optional: `SHEET_ID` = the ID of a Google Sheet (the long part of its URL) to
     also log every event as a row.
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
- To change the receiving addresses, edit `INSTALLS_TO` / `SUPPORT_TO` in the script
  and deploy a **new version** (Deploy → Manage deployments → edit → New version).
  The URL stays the same, so the app doesn't need rebuilding.
