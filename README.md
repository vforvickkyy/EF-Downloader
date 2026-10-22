<p align="center"><img src="build/appicon.png" width="96" alt="Eastape Downloader"></p>

<h1 align="center">Eastape Downloader</h1>

<p align="center">Download whole public Google Drive folders on Windows, with the same folder structure, a speed cap, and pause / resume.</p>

---

## What it does

- **Paste a link, press Scan.** Works with public folder links, file links, `open?id=` links and Google Docs / Sheets / Slides links. You can paste several links at once.
- **Same folders as on Drive.** Every subfolder is recreated on your PC, including empty ones.
- **Pick what to download.** Untick any file or folder before you start.
- **Speed limit, live.** Drag the slider (128 KB/s up to 100 MB/s, or unlimited) or type an exact value. It applies immediately to all downloads together, so the rest of your internet stays usable.
- **Files at once.** Download 1–8 files in parallel. You can change this while downloading.
- **Pause, Resume, Stop.** Partly downloaded files are kept as `.part` files and continue from where they stopped, even after you close the app. Scan the same link again and press Start.
- **Smart re-runs.** Files already in the folder are skipped, so running a link again only fetches new or missing files.
- **Automatic retries** for network hiccups, plus a *Retry failed* button.
- **Google Docs, Sheets, Slides and Drawings** are saved as .docx / .xlsx / .pptx / .png, or as PDF if you choose that in Settings.
- **Large files** get past Google's "can't scan this file for viruses" page automatically.
- Keeps the PC awake while downloading (optional), dark and light themes, and a live speed graph.

## Install

There is nothing to install. Download `EastapeDownloader.exe` and double-click it.

- Needs Windows 10 or 11 with the Microsoft Edge WebView2 runtime, which both already include.
- The exe isn't code-signed, so the first time you run it Windows SmartScreen may say *"Windows protected your PC"*. Click **More info → Run anyway**.
- Settings are stored in `%APPDATA%\EastapeDownloader\settings.json`.

## No-key mode and the optional API key

Out of the box the app reads public Drive pages the same way your browser does, so no login or setup is needed.

With a **free Google API key** (Settings → Google API key) the app uses Google's official Drive API instead. That gets you:

- reliable listing of very large folders (thousands of files)
- exact file sizes and a real time-left estimate before you start
- faster scans

To get a key (about 2 minutes, no billing):

1. Open <https://console.cloud.google.com/projectcreate> and create a project with any name.
2. Enable the **Google Drive API**: <https://console.cloud.google.com/apis/library/drive.googleapis.com>.
3. Go to <https://console.cloud.google.com/apis/credentials> → **Create credentials** → **API key**.
4. Paste it into Settings, click **Test**, then **Save**.

The key can only read publicly shared files.

## Limits

- Only works with items shared as **"Anyone with the link"**.
- Google limits how often a single public file can be downloaded in 24 hours. When a file hits that limit the app marks it *failed* with an explanation. Try it again later with **Retry failed**.
- Google Forms, Sites and Maps have no downloadable file and are listed as *Can't download*.

## Build from source

You need Go 1.23+ and the Wails CLI (`go install github.com/wailsapp/wails/v2/cmd/wails@v2.10.2`). There's no npm step; the UI is plain HTML, CSS and JS in `frontend/src`.

```sh
# Windows exe (also works when cross-compiling from Linux or macOS)
wails build -platform windows/amd64 -trimpath -skipbindings -ldflags "-s -w"
# → build/bin/EastapeDownloader.exe

# tests for the Drive client and download engine
go test -race ./internal/...
```

Every push runs the tests and builds the exe on GitHub Actions (the **Build** workflow; download it from the run's *Artifacts*). Pushing a tag like `v1.0.0` also attaches the exe to a GitHub Release.

## Project layout

| Path | What's there |
|---|---|
| `main.go`, `app.go` | Window setup and the methods the UI calls |
| `internal/gdrive` | Link parsing, folder listing (public pages or API key), download streams, confirmation pages, exports |
| `internal/engine` | Download queue, parallel workers, shared speed limiter, pause / resume / stop, retries, progress |
| `internal/settings` | Saved preferences |
| `internal/power` | Keeps Windows awake during downloads |
| `frontend/src` | The UI |
