package main

// In-app updates and announcements from the Eastape Downloader service.
// The app checks at start and every few hours. An installed copy downloads
// the new Setup, checks its signature and installs it silently; a portable
// copy opens the download instead.

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"eastape/internal/cloud"
	"eastape/internal/install"
	"eastape/internal/settings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const checkEvery = 4 * time.Hour

// UpdateInfo is the update state shown in the window.
type UpdateInfo struct {
	State      string  `json:"state"` // none, available, downloading, installing, failed
	Current    string  `json:"current"`
	Version    string  `json:"version"`
	Notes      string  `json:"notes"`
	Mandatory  bool    `json:"mandatory"`
	Size       int64   `json:"size"`
	Progress   float64 `json:"progress"` // 0-100 while downloading
	Error      string  `json:"error"`
	CanInstall bool    `json:"canInstall"` // false for a portable copy
	Checked    string  `json:"checked"`    // when the last check succeeded
}

// Notice is an announcement plus what the user did with it.
type Notice struct {
	cloud.Announcement
	Seen      bool `json:"seen"`
	Dismissed bool `json:"dismissed"`
}

type updateState struct {
	offer    *cloud.Update
	info     UpdateInfo
	notices  []cloud.Announcement
	offered  string // version already reported as offered
	checking bool
}

// installedCopy reports whether this exe is the per-user installation, which
// can update itself without asking for administrator rights.
func installedCopy() bool {
	info := install.Read()
	if !info.PerUser || info.Dir == "" {
		return false
	}
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	return strings.EqualFold(filepath.Clean(filepath.Dir(exe)), filepath.Clean(info.Dir))
}

func updatesDir() string {
	dir, err := os.UserCacheDir()
	if err != nil {
		dir = os.TempDir()
	}
	return filepath.Join(dir, "EastapeDownloader", "updates")
}

// checkLoop checks for updates and announcements now and every few hours.
func (a *App) checkLoop() {
	time.Sleep(4 * time.Second)
	for {
		_, _ = a.checkNow()
		time.Sleep(checkEvery)
	}
}

func (a *App) checkNow() (UpdateInfo, error) {
	a.mu.Lock()
	if a.upd.checking {
		info := a.upd.info
		a.mu.Unlock()
		return info, nil
	}
	a.upd.checking = true
	a.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	res, err := a.cloud.Check(ctx)

	a.mu.Lock()
	a.upd.checking = false
	if err != nil {
		info := a.upd.info
		a.mu.Unlock()
		if !errors.Is(err, cloud.ErrNotConfigured) {
			a.diag.add("checking for updates", err)
		}
		return info, err
	}
	a.upd.notices = res.Announcements
	busy := a.upd.info.State == "downloading" || a.upd.info.State == "installing"
	newOffer := ""
	if !busy {
		a.upd.offer = res.Update
		a.upd.info = UpdateInfo{State: "none", Current: version, CanInstall: installedCopy()}
		if u := res.Update; u != nil {
			a.upd.info.State, a.upd.info.Version, a.upd.info.Notes = "available", u.Version, u.Notes
			a.upd.info.Mandatory, a.upd.info.Size = u.Mandatory, u.Size
			if a.upd.offered != u.Version {
				a.upd.offered, newOffer = u.Version, u.Version
			}
		}
	}
	a.upd.info.Checked = time.Now().Format(time.RFC3339)
	info := a.upd.info
	a.mu.Unlock()

	if newOffer != "" {
		a.track("update_offered", map[string]any{"version": newOffer})
	}
	a.emitUpdate()
	a.emitNotices()
	return info, nil
}

func (a *App) emitUpdate() {
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "cloud:update", a.GetUpdate())
	}
}

func (a *App) emitNotices() {
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "cloud:notices", a.GetNotices())
	}
}

// GetUpdate returns the current update state.
func (a *App) GetUpdate() UpdateInfo {
	a.mu.Lock()
	defer a.mu.Unlock()
	info := a.upd.info
	if info.State == "" {
		info = UpdateInfo{State: "none", Current: version, CanInstall: installedCopy()}
	}
	return info
}

// CheckForUpdates checks right away (About > Check for updates).
func (a *App) CheckForUpdates() (UpdateInfo, error) {
	a.feature("check_updates")
	info, err := a.checkNow()
	if err != nil {
		if errors.Is(err, cloud.ErrNotConfigured) {
			return info, errors.New("Update checks aren't available in this copy.")
		}
		return info, errors.New("Couldn't check for updates. Check your internet connection and try again.")
	}
	return info, nil
}

// InstallUpdate downloads, verifies and installs the offered update, then
// closes the app; the installer opens the new version when it's done.
func (a *App) InstallUpdate() error {
	a.mu.Lock()
	u := a.upd.offer
	state := a.upd.info.State
	a.mu.Unlock()
	if u == nil {
		return errors.New("There's no update to install right now.")
	}
	if state == "downloading" || state == "installing" {
		return nil
	}
	if !installedCopy() {
		// Portable copies can't replace themselves: open the new Setup instead.
		if err := u.Verify(); err != nil {
			a.diag.add("update", err)
			return errors.New("This update couldn't be verified, so it wasn't opened.")
		}
		runtime.BrowserOpenURL(a.ctx, u.URL)
		return nil
	}
	if a.mgr.Busy() {
		return errors.New("Finish or stop the current download first, then update.")
	}

	a.setUpdate(func(i *UpdateInfo) { i.State, i.Progress, i.Error = "downloading", 0, "" })
	a.track("update_started", map[string]any{"version": u.Version})
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()
		path, err := u.Download(ctx, updatesDir(), func(done, total int64) {
			a.setUpdate(func(i *UpdateInfo) { i.Progress = 100 * float64(done) / float64(max(total, 1)) })
		})
		if err != nil {
			a.updateFailed(u.Version, err)
			return
		}
		a.setUpdate(func(i *UpdateInfo) { i.State, i.Progress = "installing", 100 })

		a.mu.Lock()
		a.settings.PendingUpdate = u.Version
		s := a.settings
		a.mu.Unlock()
		_ = settings.Save(s)
		ctx2, cancel2 := context.WithTimeout(context.Background(), 4*time.Second)
		_ = a.cloud.Flush(ctx2)
		cancel2()

		if err := startDetached(path, "/S", "/UPDATE"); err != nil {
			a.mu.Lock()
			a.settings.PendingUpdate = ""
			s := a.settings
			a.mu.Unlock()
			_ = settings.Save(s)
			a.updateFailed(u.Version, err)
			return
		}
		a.quitting.Store(true)
		runtime.Quit(a.ctx)
	}()
	return nil
}

func (a *App) updateFailed(v string, err error) {
	a.diag.add("updating to "+v, err)
	msg := "The download stopped. Check your internet connection and try again."
	kind := "download"
	if errors.Is(err, cloud.ErrBadUpdate) {
		msg, kind = "The update didn't pass its security check, so it wasn't installed.", "verify"
	} else if _, ok := err.(*os.PathError); ok {
		msg, kind = "Couldn't save the update on this computer.", "save"
	}
	a.setUpdate(func(i *UpdateInfo) { i.State, i.Error = "failed", msg })
	a.track("update_failed", map[string]any{"version": v, "error": kind})
	a.sendSoon()
}

func (a *App) setUpdate(change func(*UpdateInfo)) {
	a.mu.Lock()
	change(&a.upd.info)
	a.mu.Unlock()
	a.emitUpdate()
}

// ---- Announcements ----

// GetNotices returns the current announcements, newest first.
func (a *App) GetNotices() []Notice {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := make([]Notice, 0, len(a.upd.notices))
	for _, n := range a.upd.notices {
		out = append(out, Notice{Announcement: n, Seen: hasID(a.settings.SeenNotices, n.ID), Dismissed: hasID(a.settings.DismissedNotices, n.ID)})
	}
	return out
}

func hasID(list []int64, id int64) bool {
	for _, x := range list {
		if x == id {
			return true
		}
	}
	return false
}

// MarkNoticesSeen records that the user saw these announcements.
func (a *App) MarkNoticesSeen(ids []int64) {
	var fresh []int64
	a.mu.Lock()
	for _, id := range ids {
		if a.knownNotice(id) && !hasID(a.settings.SeenNotices, id) {
			a.settings.SeenNotices = settings.AddNotice(a.settings.SeenNotices, id)
			fresh = append(fresh, id)
		}
	}
	s := a.settings
	a.mu.Unlock()
	if len(fresh) == 0 {
		return
	}
	_ = a.save(s)
	for _, id := range fresh {
		a.track("announcement_seen", map[string]any{"id": id})
	}
	a.emitNotices()
}

// DismissNotice hides an announcement for good.
func (a *App) DismissNotice(id int64) {
	a.mu.Lock()
	if !a.knownNotice(id) {
		a.mu.Unlock()
		return
	}
	a.settings.DismissedNotices = settings.AddNotice(a.settings.DismissedNotices, id)
	a.settings.SeenNotices = settings.AddNotice(a.settings.SeenNotices, id)
	s := a.settings
	a.mu.Unlock()
	_ = a.save(s)
	a.track("announcement_dismissed", map[string]any{"id": id})
	a.emitNotices()
}

// OpenNotice opens an announcement's link.
func (a *App) OpenNotice(id int64) {
	a.mu.Lock()
	var link string
	for _, n := range a.upd.notices {
		if n.ID == id {
			link = n.CTAURL
		}
	}
	a.mu.Unlock()
	if !strings.HasPrefix(link, "https://") {
		return
	}
	a.track("announcement_clicked", map[string]any{"id": id})
	runtime.BrowserOpenURL(a.ctx, link)
}

// knownNotice must be called with a.mu held.
func (a *App) knownNotice(id int64) bool {
	for _, n := range a.upd.notices {
		if n.ID == id {
			return true
		}
	}
	return false
}
