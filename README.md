<p align="center"><img src="build/appicon.png" width="96" alt="Eastape Downloader"></p>

<h1 align="center">Eastape Downloader</h1>

<p align="center"><b>Made by Creators, for Creators</b><br>Download whole public Google Drive folders on Windows, with the same folder structure, a speed limit, and pause / resume.<br>Version 1.1 · Developed by Eastape Tech · © 2026 Eastape Tech. All rights reserved.</p>

---

## Features

- **Paste a link, press Scan.** Works with public folder links, file links, `open?id=` links and Google Docs / Sheets / Slides links. You can paste several links at once.
- **Same folders as on Drive.** Every subfolder is recreated on your PC, including empty ones.
- **Pick what to download.** Untick any file or folder before you start.
- **Speed limit, live.** 128 KB/s up to 100 MB/s, or unlimited. You can type an exact value, and changes apply immediately.
- **Files at once.** 1–8 parallel downloads, changeable while downloading.
- **Pause, Resume, Stop.** Unfinished files continue from where they stopped, even after closing the app.
- **Smart re-runs.** Files already downloaded are skipped.
- **Automatic retries** and a *Retry failed* button.
- **Google Docs, Sheets, Slides, Drawings** are saved as Office files or PDF.
- **Help & support** form inside the app; Terms, Privacy Policy, Disclaimer and open-source licences in Settings → Legal.

## Installing

Share **`EastapeDownloader-Setup-<version>.exe`**. The installer has a welcome page, Terms and Conditions (must be accepted), a choice of desktop shortcut, a folder picker, and an uninstaller in *Apps & features*. It also:

- installs Microsoft Edge WebView2 if the PC doesn't have it;
- adds a Windows Firewall allow rule for the app;
- refuses to overwrite the app while it is running and asks the user to close it.

`EastapeDownloader.exe` alone also runs without installing (portable).

Because the files aren't code-signed yet, Windows SmartScreen shows "Windows protected your PC" when someone opens a downloaded installer: **More info → Run anyway**. Only a code-signing certificate removes that warning; the build already supports signing (`SIGN_CMD`, see below).

## Registration, install notices and support

- On first start the app asks for the user's **name and email** (required) and acceptance of the Terms, Privacy Policy and Disclaimer.
- Every installation, update and reinstall is reported once, even if the user never registers. Registrations and support messages are sent too.
- Everything goes through a private relay that you deploy in your own Google account, so the app contains no email address or password: **[server/apps-script/README.md](server/apps-script/README.md)**. Installs and registrations go to `tech@`, support messages to `info@`; the addresses only exist in the relay script.
- Without a network the app keeps messages in an outbox and sends them later.
- Everything that is collected is listed in the Privacy Policy (`frontend/src/legal/privacy.md`). Change the policy if you change what is sent.

## Building

You need Go 1.23+, the Wails CLI (`go install github.com/wailsapp/wails/v2/cmd/wails@v2.10.2`) and NSIS (`makensis`). There's no npm step; the UI is plain HTML, CSS and JS in `frontend/src`.

```sh
# relay settings (once): create relay.env at the project root
#   EASTAPE_RELAY_URL=https://script.google.com/macros/s/.../exec
#   EASTAPE_RELAY_TOKEN=<same value as the RELAY_TOKEN script property>

./scripts/build-windows.sh            # → build/bin/EastapeDownloader.exe + EastapeDownloader-Setup-1.1.0.exe
go test -race ./internal/...          # tests
python3 scripts/gen-licenses.py       # refresh the open-source licences page after changing dependencies
```

GitHub Actions builds both files on every push (download them from the run's *Artifacts*). Add the repository secrets `EASTAPE_RELAY_URL` and `EASTAPE_RELAY_TOKEN` so those builds can send messages. Pushing a tag like `v1.1.0` attaches the files to a GitHub Release.

**Code signing:** set `SIGN_CMD` to a script that signs the file passed as its argument (for example with `signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /f cert.pfx /p ... %1`). The installer and uninstaller are then signed automatically.

## Project layout

| Path | What's there |
|---|---|
| `main.go`, `app.go` | Window setup and the methods the UI calls |
| `account.go` | Registration, install notices, support messages, diagnostics |
| `internal/gdrive` | Link parsing, folder listing, download streams, exports |
| `internal/engine` | Download queue, parallel workers, speed limiter, pause / resume / stop |
| `internal/feedback` | Sending to the relay, offline outbox |
| `internal/install` | Install ID in the registry |
| `internal/settings`, `internal/power` | Preferences; keeping Windows awake |
| `frontend/src` | The UI; `frontend/src/legal` holds the legal documents |
| `build/windows/installer` | NSIS installer script and artwork |
| `server/apps-script` | The email relay to deploy in Google Apps Script |
