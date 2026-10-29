package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"eastape/internal/cloud"
	"eastape/internal/engine"
	"eastape/internal/feedback"
	"eastape/internal/gdrive"
	"eastape/internal/power"
	"eastape/internal/settings"

	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	appName   = "Eastape Downloader"
	company   = "Eastape Tech"
	slogan    = "Made by Creators, for Creators"
	copyright = "© 2026 Eastape Tech. All rights reserved."
)

// version is set at build time with -ldflags "-X main.version=...".
var version = "1.3.0"

// termsVersion names the current Terms and Conditions, Privacy Policy and
// Disclaimer. Users accept it when they register; when it changes, everyone
// is asked to accept the new version before continuing. (Version 1.4 of the
// documents only added the Mac wording, so earlier acceptances still count.)
const termsVersion = "2026-10-28"

// App is the bridge between the window (frontend) and the download engine.
// Its exported methods are callable from JavaScript.
type App struct {
	ctx context.Context
	mgr *engine.Manager

	outbox *feedback.Outbox
	cloud  *cloud.Client
	diag   *diagLog
	usage  usage

	quitting atomic.Bool

	mu         sync.Mutex
	settings   settings.Settings
	scanCancel context.CancelFunc
	lastState  engine.State
	lastTitle  string
	upd        updateState
}

// NewApp creates the application.
func NewApp() *App {
	a := &App{settings: settings.Load(), outbox: feedback.OpenOutbox(outboxPath()), diag: &diagLog{}}
	a.usage.features = map[string]bool{}
	a.cloud = newCloud(a)
	a.mgr = engine.NewManager(a.onEngineEvent)
	a.mgr.OnFileError = func(path string, err error) {
		a.diag.add("download "+path, err)
		a.jobError(err)
	}
	a.mgr.SetClient(gdrive.NewClient(a.settings.APIKey))
	return a
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.applyTheme(a.settings.Theme)
	go func() {
		a.initIdentity()
		go a.checkLoop()
		a.startSession()
	}()
	go a.retryOutbox()
}

// beforeClose asks before quitting in the middle of a download.
func (a *App) beforeClose(ctx context.Context) bool {
	if a.quitting.Load() || !a.mgr.Busy() {
		a.flushBeforeExit()
		return false
	}
	answer, err := runtime.MessageDialog(ctx, runtime.MessageDialogOptions{
		Type:          runtime.QuestionDialog,
		Title:         appName,
		Message:       "Downloads are still in progress.\n\nQuit anyway? Unfinished files will continue from where they stopped next time you download the same link.",
		Buttons:       []string{"Yes", "No"},
		DefaultButton: "No",
		CancelButton:  "No",
	})
	if err == nil && answer != "Yes" {
		return true
	}
	a.mgr.Stop()
	power.Release()
	a.flushBeforeExit()
	return false
}

// onSecondInstance brings the open window forward when the exe is started
// again.
func (a *App) onSecondInstance(options.SecondInstanceData) {
	if a.ctx == nil {
		return
	}
	runtime.WindowUnminimise(a.ctx)
	runtime.Show(a.ctx)
	runtime.WindowSetAlwaysOnTop(a.ctx, true)
	runtime.WindowSetAlwaysOnTop(a.ctx, false)
}

func (a *App) shutdown(context.Context) {
	power.Release()
	a.endSession()
	a.flushBeforeExit()
}

// onEngineEvent forwards engine events to the window and keeps the title,
// sleep prevention and "open when done" in step with the job.
func (a *App) onEngineEvent(name string, data any) {
	if a.ctx == nil {
		return
	}
	switch name {
	case "job:tick":
		t := data.(engine.Tick)
		a.mu.Lock()
		prev := a.lastState
		a.lastState = t.State
		prevent := a.settings.PreventSleep
		a.mu.Unlock()
		a.usage.mu.Lock()
		a.usage.lastSpeed = t.Speed
		a.usage.mu.Unlock()
		if t.State != prev {
			a.onJobState(t)
			if t.State == engine.StateRunning && prevent {
				power.Keep()
			} else if t.State != engine.StateRunning {
				power.Release()
			}
		}
		title := appName
		switch t.State {
		case engine.StateRunning:
			title = fmt.Sprintf("%d%% · %s", int(t.Percent), appName)
		case engine.StatePaused:
			title = fmt.Sprintf("Paused %d%% · %s", int(t.Percent), appName)
		}
		a.mu.Lock()
		changed := title != a.lastTitle
		a.lastTitle = title
		a.mu.Unlock()
		if changed {
			runtime.WindowSetTitle(a.ctx, title)
		}
	case "job:finished":
		a.mu.Lock()
		open := a.settings.OpenWhenDone
		a.mu.Unlock()
		if open {
			a.openDownloadFolder()
		}
	}
	runtime.EventsEmit(a.ctx, name, data)
}

// ---- Settings ----

// GetSettings returns the saved settings.
func (a *App) GetSettings() settings.Settings {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.settings
}

// SaveSettings stores and applies new settings.
func (a *App) SaveSettings(s settings.Settings) (settings.Settings, error) {
	s = s.Normalize()
	a.mu.Lock()
	s = s.KeepIdentity(a.settings)
	keyChanged := s.APIKey != a.settings.APIKey
	a.settings = s
	a.mu.Unlock()

	a.mgr.SetLimit(s.SpeedLimitKB * 1024)
	a.mgr.SetParallel(s.Parallel)
	if keyChanged {
		a.mgr.SetClient(gdrive.NewClient(s.APIKey))
	}
	a.applyTheme(s.Theme)
	if err := settings.Save(s); err != nil {
		a.diag.add("saving settings", err)
		return s, errors.New("Couldn't save your settings. Please try again.")
	}
	return s, nil
}

// SetSpeedLimit changes the speed cap (KB/s, 0 = unlimited) right away.
func (a *App) SetSpeedLimit(kb int64) error {
	if kb < 0 {
		kb = 0
	}
	a.mu.Lock()
	a.settings.SpeedLimitKB = kb
	s := a.settings
	a.mu.Unlock()
	a.mgr.SetLimit(kb * 1024)
	if kb > 0 {
		a.feature("speed_limit")
	}
	return a.save(s)
}

// SetParallel changes how many files download at once, right away.
func (a *App) SetParallel(n int) error {
	a.mu.Lock()
	a.settings.Parallel = n
	a.settings = a.settings.Normalize()
	s := a.settings
	a.mu.Unlock()
	a.mgr.SetParallel(s.Parallel)
	a.feature("parallel")
	return a.save(s)
}

// save writes settings, keeping the technical error for support.
func (a *App) save(s settings.Settings) error {
	if err := settings.Save(s); err != nil {
		a.diag.add("saving settings", err)
		return errors.New("Couldn't save your settings. Please try again.")
	}
	return nil
}

// ChooseFolder lets the user pick the download folder.
func (a *App) ChooseFolder() (string, error) {
	cur := a.GetSettings().DownloadDir
	start := cur
	for start != "" {
		if fi, err := os.Stat(start); err == nil && fi.IsDir() {
			break
		}
		parent := filepath.Dir(start)
		if parent == start {
			start = ""
			break
		}
		start = parent
	}
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:                "Choose where to save downloads",
		DefaultDirectory:     start,
		CanCreateDirectories: true,
	})
	if err != nil {
		a.diag.add("folder picker", err)
		return cur, errors.New("Couldn't open the folder picker. Please try again.")
	}
	if dir == "" {
		return cur, nil
	}
	a.mu.Lock()
	a.settings.DownloadDir = dir
	s := a.settings
	a.mu.Unlock()
	return dir, a.save(s)
}

func (a *App) applyTheme(theme string) {
	if a.ctx == nil {
		return
	}
	switch theme {
	case "light":
		runtime.WindowSetLightTheme(a.ctx)
	case "system":
		runtime.WindowSetSystemDefaultTheme(a.ctx)
	default:
		runtime.WindowSetDarkTheme(a.ctx)
	}
}

// TestAPIKey checks an API key without saving it.
func (a *App) TestAPIKey(key string) (string, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return "", errors.New("Enter an API key first.")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := gdrive.NewClient(key).TestKey(ctx); err != nil {
		a.diag.add("testing API key", err)
		if gdrive.KindOf(err) == gdrive.ErrBadKey {
			return "", err
		}
		return "", errors.New("Couldn't reach Google. Check your internet connection and try again.")
	}
	a.feature("api_key")
	return "Key works. Large folders will now be listed with exact sizes.", nil
}

// ---- Scanning ----

// NodeInfo is one row of the file tree shown in the window.
type NodeInfo struct {
	I        int    `json:"i"`
	Parent   int    `json:"p"`
	Name     string `json:"n"`
	IsFolder bool   `json:"f"`
	Size     int64  `json:"s"`
	Mime     string `json:"m"`
	Depth    int    `json:"d"`
	Path     string `json:"path"`
	NA       string `json:"na,omitempty"`
}

// ScanResult is what Scan returns to the window.
type ScanResult struct {
	Title    string      `json:"title"`
	Nodes    []NodeInfo  `json:"nodes"`
	UsingAPI bool        `json:"usingAPI"`
	Warnings []string    `json:"warnings"`
	Tick     engine.Tick `json:"tick"`
}

// Scan reads the links and lists everything in them.
func (a *App) Scan(input string) (*ScanResult, error) {
	if err := a.requireSetup(); err != nil {
		return nil, err
	}
	if a.mgr.Busy() {
		return nil, errors.New("A download is in progress. Stop it before opening another link.")
	}
	links, err := gdrive.ParseLinks(input)
	if err != nil && len(links) == 0 {
		return nil, err
	}

	ctx, cancel := context.WithCancel(context.Background())
	a.mu.Lock()
	if a.scanCancel != nil {
		a.scanCancel()
	}
	a.scanCancel = cancel
	s := a.settings
	a.mu.Unlock()
	defer cancel()

	client := gdrive.NewClient(s.APIKey)
	began := time.Now()
	var lastEmit time.Time
	var emitMu sync.Mutex
	res, err := client.Scan(ctx, links, gdrive.DocsFormat(s.DocsFormat), func(p gdrive.ScanProgress) {
		emitMu.Lock()
		defer emitMu.Unlock()
		if time.Since(lastEmit) > 120*time.Millisecond {
			lastEmit = time.Now()
			runtime.EventsEmit(a.ctx, "scan:progress", p)
		}
	})
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return nil, errors.New("scan cancelled")
		}
		a.trackScan(links, nil, err, time.Since(began))
		a.diag.add("scanning "+input, err)
		var de *gdrive.Error
		if !errors.As(err, &de) || de.Kind == gdrive.ErrTransient {
			return nil, errors.New("Couldn't reach Google Drive. Check your internet connection and try again.")
		}
		return nil, err
	}
	a.trackScan(links, res, nil, time.Since(began))
	a.mgr.SetClient(client)
	if err := a.mgr.Load(res); err != nil {
		return nil, err
	}

	a.mu.Lock()
	a.settings.AddRecent(strings.TrimSpace(input))
	saved := a.settings
	a.mu.Unlock()
	_ = settings.Save(saved)

	out := &ScanResult{Title: res.Title, UsingAPI: res.UsingAPI, Warnings: res.Warnings, Nodes: make([]NodeInfo, len(res.Nodes))}
	for i, n := range res.Nodes {
		out.Nodes[i] = NodeInfo{I: i, Parent: n.Parent, Name: n.Name, IsFolder: n.IsFolder(), Size: n.Size, Mime: n.MimeType, Depth: n.Depth, Path: filepath.ToSlash(n.RelPath), NA: n.NoDownload}
	}
	out.Tick = a.mgr.Snapshot()
	return out, nil
}

// CancelScan stops a running scan.
func (a *App) CancelScan() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.scanCancel != nil {
		a.scanCancel()
		a.scanCancel = nil
	}
}

// ---- Downloading ----

// Start downloads the selected files (indexes into the scanned nodes; empty
// or null downloads everything).
func (a *App) Start(selected []int) error {
	if err := a.requireSetup(); err != nil {
		return err
	}
	s := a.GetSettings()
	if err := os.MkdirAll(s.DownloadDir, 0o755); err != nil {
		a.diag.add("download folder", err)
		return fmt.Errorf("Can't save files in %s. Choose a different download folder.", s.DownloadDir)
	}
	err := a.mgr.Start(engine.Options{
		Dir:       s.DownloadDir,
		Parallel:  s.Parallel,
		LimitBps:  s.SpeedLimitKB * 1024,
		Overwrite: s.Overwrite,
		Retries:   s.Retries,
	}, selected)
	if err != nil {
		a.diag.add("starting download", err)
		var fe *engine.FolderError
		if errors.As(err, &fe) {
			return fmt.Errorf("Can't create folders in %s. Choose a different download folder.", s.DownloadDir)
		}
		return err
	}
	a.startJob()
	return nil
}

// Pause pauses all downloads.
func (a *App) Pause() {
	a.mgr.Pause()
	a.feature("pause")
}

// Resume continues paused downloads.
func (a *App) Resume() {
	a.mgr.Resume()
	a.feature("resume")
}

// Stop stops all downloads; Start continues them later.
func (a *App) Stop() {
	a.mgr.Stop()
	a.feature("stop")
}

// RetryFailed downloads the failed files again.
func (a *App) RetryFailed() error {
	err := a.mgr.RetryFailed()
	if err != nil {
		a.diag.add("retrying", err)
		return err
	}
	a.feature("retry_failed")
	a.startJob()
	return nil
}

// ---- Shell helpers ----

// OpenDownloadFolder opens the folder the current job saves into.
func (a *App) OpenDownloadFolder() {
	a.feature("open_folder")
	a.openDownloadFolder()
}

func (a *App) openDownloadFolder() {
	dir := a.mgr.Dir()
	if dir == "" {
		dir = a.GetSettings().DownloadDir
	}
	if p, ok := a.mgr.LocalPath(0); ok {
		if fi, err := os.Stat(p); err == nil && fi.IsDir() {
			dir = p
		}
	}
	_ = os.MkdirAll(dir, 0o755)
	openPath(dir)
}

// OpenPath opens a folder in Explorer.
func (a *App) OpenPath(p string) {
	if p == "" {
		p = a.GetSettings().DownloadDir
	}
	_ = os.MkdirAll(p, 0o755)
	openPath(p)
}

// RevealFile shows a downloaded file in Explorer.
func (a *App) RevealFile(i int) {
	p, ok := a.mgr.LocalPath(i)
	if !ok {
		return
	}
	a.feature("reveal_file")
	if _, err := os.Stat(p); err != nil {
		openPath(filepath.Dir(p))
		return
	}
	revealPath(p)
}

// OpenURL opens a web page in the default browser.
func (a *App) OpenURL(u string) {
	if strings.HasPrefix(u, "https://") {
		runtime.BrowserOpenURL(a.ctx, u)
	}
}

// ClipboardLink returns a Drive link from the clipboard, or "".
func (a *App) ClipboardLink() string {
	text, err := runtime.ClipboardGetText(a.ctx)
	if err != nil {
		return ""
	}
	text = strings.TrimSpace(text)
	if len(text) > 4000 {
		return ""
	}
	if links, _ := gdrive.ParseLinks(text); len(links) > 0 && (strings.Contains(text, "drive.google.com") || strings.Contains(text, "docs.google.com")) {
		return text
	}
	return ""
}

// AppInfo describes the app for the About screen.
func (a *App) AppInfo() map[string]string {
	short := version
	if strings.HasSuffix(short, ".0") {
		short = strings.TrimSuffix(short, ".0")
	}
	return map[string]string{
		"name":         appName,
		"version":      version,
		"shortVersion": short,
		"company":      company,
		"slogan":       slogan,
		"copyright":    copyright,
		"language":     "English",
		"edition":      "Personal use",
		"os":           feedback.OSVersion(),
		"platform":     goruntime.GOOS,
		"cloud":        fmt.Sprint(cloud.Configured()),
		"termsVersion": termsVersion,
	}
}
