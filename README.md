<p align="center"><img src="build/appicon.png" width="96" alt="Eastape Downloader"></p>

<h1 align="center">Eastape Downloader</h1>

<p align="center"><b>Made by Creators, for Creators</b><br>Download whole public Google Drive folders on Windows and Mac, with the same folder structure, a speed limit, and pause / resume.<br>Version 1.4 · © 2026 Eastape Tech. All rights reserved.</p>

---

## Features

- **Paste a link, press Scan.** Works with public folder links, file links, `open?id=` links and Google Docs / Sheets / Slides links. You can paste several links at once.
- **Same folders as on Drive.** Every subfolder is recreated on your computer, including empty ones.
- **Pick what to download.** Untick any file or folder before you start.
- **Speed limit, live.** 128 KB/s up to 100 MB/s, or unlimited. You can type an exact value, and changes apply immediately.
- **Files at once.** 1–8 parallel downloads, changeable while downloading.
- **Pause, Resume, Stop.** Unfinished files continue from where they stopped, even after closing the app.
- **Smart re-runs.** Files already downloaded are skipped.
- **Automatic retries** and a *Retry failed* button.
- **Google Docs, Sheets, Slides, Drawings** are saved as Office files or PDF.
- **Updates in one click** on Windows: the app checks for new versions and installs them itself; signed, so only Eastape Tech's updates are accepted. On the Mac it offers the new disk image.
- **News from Eastape** (announcements) right in the app.
- **Help & support** form inside the app; Terms, Privacy Policy, Disclaimer and open-source licences in Settings → Legal.

## Installing

### Windows

Share **`EastapeDownloader-Setup-<version>.exe`**. The installer has a welcome page, Terms and Conditions (must be accepted), a choice of desktop shortcut, a folder picker, and an uninstaller in *Installed apps*. It installs for the current Windows user (in `%LOCALAPPDATA%\Programs`), so it needs no administrator rights and the app can update itself silently. It also:

- installs Microsoft Edge WebView2 if the PC doesn't have it;
- moves a version 1.1 installation (installed for all users) to the current user, keeping its settings and install ID; Windows asks once for permission to remove the old copy;
- refuses to overwrite the app while it is running and asks the user to close it.

`Setup.exe /S` installs silently; `/S /UPDATE` is what the in-app updater uses (waits for the app to close, then reopens it).

`EastapeDownloader.exe` alone also runs without installing (portable).

Because the files aren't code-signed yet, Windows SmartScreen shows "Windows protected your PC" when someone opens a downloaded installer: **More info → Run anyway**. Only a code-signing certificate removes that warning; the build already supports signing (`SIGN_CMD`, see below).

### Mac

Share **`EastapeDownloader-<version>-mac.dmg`**. It opens a window with the app and a shortcut to Applications: drag the app onto Applications. It runs natively on Apple silicon and Intel Macs with macOS 11 or later. The first time it saves into Downloads (or another protected folder), macOS asks for permission.

Until the app is signed with an Apple Developer ID and notarized, macOS refuses to open it the first time ("Apple could not verify…"). Open **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to Eastape Downloader (on macOS 14 and earlier, right-click the app → **Open** also works). Signing and notarization are built in (see below) and remove this step.

On the Mac, updates are offered in the app as a download of the new disk image; the user drags the new version into Applications, replacing the old one. Settings and the install ID are kept.

## Dashboard, stats, updates and support

- The **Eastape Downloader cloud** ([`web/`](web), on Vercel + Neon) receives installs, registrations, support messages and anonymous usage stats, offers updates and announcements, and has the **admin dashboard** (live users, downloads, data, versions, problems, support inbox, update publishing, announcements, team). See **[web/README.md](web/README.md)**.
- On first start a **welcome screen** walks new users through setup: **name and email are required**, with acceptance of the Terms, Privacy Policy and Disclaimer, and the app can't be used until it's done. When the terms change (`termsVersion` in `app.go`), existing users accept the new version once.
- Every installation, update and reinstall is reported once, even if the user never registers.
- Usage stats are always sent (since 1.3; disclosed in the Privacy Policy and Terms) and never include links, file names or files.
- Install notices, registrations and support messages can also be emailed through a private relay in your Google account ([server/apps-script/README.md](server/apps-script/README.md)); the receiving addresses live only in the relay's settings.
- Without a network the app keeps everything in an outbox and sends it later.
- Everything that is collected is listed in the Privacy Policy (`frontend/src/legal/privacy.md`). Change the policy if you change what is sent.

## Building

You need Go 1.23+, the Wails CLI (`go install github.com/wailsapp/wails/v2/cmd/wails@v2.10.2`) and, for Windows, NSIS (`makensis`); the Mac version builds only on a Mac with Xcode's command line tools. There's no npm step; the UI is plain HTML, CSS and JS in `frontend/src`.

```sh
# settings (once), files at the project root that git ignores:
#   cloud.env:  EASTAPE_APP_KEY=<APP_KEY of the cloud service>
#   relay.env:  EASTAPE_RELAY_URL=https://script.google.com/macros/s/.../exec   (optional email relay)
#               EASTAPE_RELAY_TOKEN=<same value as the RELAY_TOKEN script property>

./scripts/build-windows.sh            # → build/bin/EastapeDownloader.exe + EastapeDownloader-Setup-1.4.0.exe
./scripts/build-macos.sh              # on a Mac → build/bin/Eastape Downloader.app + EastapeDownloader-1.4.0-mac.dmg
go test -race ./internal/...          # tests
python3 scripts/gen-licenses.py       # refresh the open-source licences page after changing dependencies
python3 scripts/make-icons.py icon.png # new 1024x1024 icon → app icon (Windows and Mac), logos, favicons, installer art
```

GitHub Actions builds the Windows files and the Mac disk image on every push (download them from the run's *Artifacts*); the Mac job also checks that the app starts and keeps a screenshot. Add the repository secret `EASTAPE_APP_KEY` (and optionally `EASTAPE_RELAY_URL` / `EASTAPE_RELAY_TOKEN`) so those builds can talk to the service. Pushing a tag like `v1.4.0` attaches the files to a GitHub Release.

To ship an update to existing users, upload the new Setup (Windows) or disk image (Mac) in the dashboard (**Updates → New update**, choose the platform) and publish it. Each platform has its own updates.

**Code signing:** set `SIGN_CMD` to a script that signs the file passed as its argument (for example `signtool sign /n "Eastape Tech" /fd SHA256 /tr <your CA's timestamp server> /td SHA256 %1`, with the certificate's token or cloud-signing app connected). The app, the installer and the uninstaller are then all signed.

**Mac signing and notarization** (needs an Apple Developer Program membership): in GitHub Actions, add the secrets `MAC_CERT_P12` (the "Developer ID Application" certificate with its private key, exported as .p12 and base64-encoded), `MAC_CERT_PASSWORD` (the .p12's password), `APPLE_ID` (the developer account's Apple ID) and `APPLE_APP_PASSWORD` (an app-specific password for that Apple ID). The build finds the certificate name and Team ID itself, signs the app with the hardened runtime, notarizes the disk image with Apple and staples the ticket; the *Check the build* step shows what Gatekeeper says. On a Mac, `MAC_SIGN_IDENTITY`, `APPLE_ID` and `APPLE_APP_PASSWORD` do the same for `build-macos.sh`.

## Project layout

| Path | What's there |
|---|---|
| `main.go`, `app.go` | Window setup and the methods the UI calls |
| `account.go` | Registration, install notices, support messages, diagnostics |
| `usage.go`, `updates.go` | Usage stats; update checks, the in-app updater and announcements |
| `internal/gdrive` | Link parsing, folder listing, download streams, exports |
| `internal/engine` | Download queue, parallel workers, speed limiter, pause / resume / stop |
| `internal/cloud` | Talking to the cloud service: event outbox, update check, signed update download |
| `internal/feedback` | Sending to the email relay, offline outbox |
| `internal/install` | Install ID and folder in the registry |
| `internal/settings`, `internal/power` | Preferences; keeping the computer awake (Windows and Mac) |
| `frontend/src` | The UI; `frontend/src/legal` holds the legal documents |
| `build/windows/installer` | NSIS installer script and artwork |
| `server/apps-script` | The email relay to deploy in Google Apps Script |
| `web` | The cloud service and admin dashboard (Vercel + Neon) |
