package main

// Anonymous usage stats: what the app is used for, never which links or
// files. They go to the Eastape Downloader service (internal/cloud) and can
// be turned off in Settings > Privacy.

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	"eastape/internal/cloud"
	"eastape/internal/engine"
	"eastape/internal/feedback"
	"eastape/internal/gdrive"
	"eastape/internal/install"
)

const heartbeatEvery = 5 * time.Minute

func cloudOutboxPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "EastapeDownloader", "events.json")
}

// usage tracks the current session and download job.
type usage struct {
	mu        sync.Mutex
	started   time.Time
	features  map[string]bool // sent once per session
	job       *jobStats
	lastSpeed float64
}

type jobStats struct {
	started  time.Time
	bytes0   int64
	elapsed0 float64
	limit    int64
	parallel int
	errors   map[string]int
}

func newCloud(a *App) *cloud.Client {
	source := "portable"
	if install.Read().ID != "" {
		source = "installer"
	}
	osName := feedback.OSVersion()
	return cloud.Open(cloudOutboxPath(), func() cloud.Identity {
		s := a.GetSettings()
		return cloud.Identity{InstallID: s.InstallID, Version: version, OS: osName, Source: source, Stats: !s.StatsOff}
	})
}

// track records an event. Never call it while holding a.mu.
func (a *App) track(typ string, props map[string]any) { a.cloud.Track(typ, props) }

// sendSoon delivers waiting events in the background.
func (a *App) sendSoon() {
	if a.cloud.Len() == 0 {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		if err := a.cloud.Flush(ctx); err != nil && !errors.Is(err, cloud.ErrNotConfigured) {
			a.diag.add("sending usage stats", err)
		}
	}()
}

// feature records that a feature was used (once per session).
func (a *App) feature(name string) {
	a.usage.mu.Lock()
	seen := a.usage.features[name]
	a.usage.features[name] = true
	a.usage.mu.Unlock()
	if !seen {
		a.track("feature", map[string]any{"name": name})
	}
}

// startSession runs once the install ID is known.
func (a *App) startSession() {
	a.usage.mu.Lock()
	a.usage.started = time.Now()
	a.usage.mu.Unlock()

	// Was this start the result of an in-app update?
	a.mu.Lock()
	s := &a.settings
	var ev string
	props := map[string]any{"version": version}
	switch {
	case s.PendingUpdate != "" && s.PendingUpdate == version:
		ev = "update_installed"
		props["from"] = s.LastVersion
	case s.PendingUpdate != "":
		ev = "update_failed"
		props["version"], props["error"] = s.PendingUpdate, "not_installed"
	}
	changed := s.PendingUpdate != "" || s.LastVersion != version
	s.PendingUpdate, s.LastVersion = "", version
	saved := *s
	a.mu.Unlock()
	if changed {
		_ = a.save(saved)
	}
	if ev != "" {
		a.track(ev, props)
	}
	if ev == "update_installed" {
		_ = os.RemoveAll(updatesDir())
	}
	a.track("session_start", nil)
	a.sendSoon()

	t := time.NewTicker(heartbeatEvery)
	defer t.Stop()
	for range t.C {
		a.heartbeat()
	}
}

func (a *App) heartbeat() {
	a.mu.Lock()
	st := a.lastState
	a.mu.Unlock()
	a.usage.mu.Lock()
	bps := a.usage.lastSpeed
	a.usage.mu.Unlock()
	state := "idle"
	switch st {
	case engine.StateRunning:
		state = "downloading"
	case engine.StatePaused:
		state = "paused"
	default:
		bps = 0
	}
	a.track("heartbeat", map[string]any{"state": state, "bps": int64(bps)})
	a.sendSoon()
}

// endSession finishes the open job and the session, and gives the events a
// last few seconds to go out.
func (a *App) endSession() {
	a.finishJob("stopped")
	a.usage.mu.Lock()
	started := a.usage.started
	a.usage.mu.Unlock()
	if !started.IsZero() {
		a.track("session_end", map[string]any{"durationSec": int64(time.Since(started).Seconds())})
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = a.cloud.Flush(ctx)
}

// trackScan records an opened link: what kind, how big, how it went.
func (a *App) trackScan(links []gdrive.Link, res *gdrive.Result, err error, took time.Duration) {
	kinds := map[string]any{}
	for _, l := range links {
		k := map[gdrive.LinkKind]string{gdrive.LinkFolder: "folder", gdrive.LinkFile: "file", gdrive.LinkDoc: "google_doc"}[l.Kind]
		if k == "" {
			k = "other"
		}
		n, _ := kinds[k].(int)
		kinds[k] = n + 1
	}
	props := map[string]any{"ok": err == nil, "links": len(links), "kinds": kinds, "durationMs": took.Milliseconds()}
	if len(kinds) == 1 {
		for k := range kinds {
			props["kind"] = k
		}
	} else {
		props["kind"] = "mixed"
	}
	if err != nil {
		props["errorKind"] = gdrive.KindOf(err).String()
	} else {
		var files int
		var bytes int64
		unknown := false
		for _, n := range res.Nodes {
			if n.IsFolder() {
				continue
			}
			files++
			if n.Size >= 0 {
				bytes += n.Size
			} else {
				unknown = true
			}
		}
		props["files"], props["bytes"], props["sizesKnown"], props["api"] = files, bytes, !unknown, res.UsingAPI
	}
	a.track("scan", props)
	a.sendSoon()
}

// startJob begins counting a download run (Start or Retry failed).
func (a *App) startJob() {
	sum := a.mgr.Summary()
	a.usage.mu.Lock()
	defer a.usage.mu.Unlock()
	if a.usage.job != nil {
		return
	}
	a.usage.job = &jobStats{started: time.Now(), bytes0: a.mgr.Transferred(), elapsed0: sum.Elapsed, limit: sum.Limit, parallel: sum.Parallel, errors: map[string]int{}}
}

// jobError counts a file that failed for good.
func (a *App) jobError(err error) {
	kind := engine.ErrorKind(err)
	a.usage.mu.Lock()
	if a.usage.job != nil {
		a.usage.job.errors[kind]++
	}
	a.usage.mu.Unlock()
}

// finishJob reports the run that just ended: done, stopped or failed.
func (a *App) finishJob(result string) {
	a.usage.mu.Lock()
	j := a.usage.job
	a.usage.job = nil
	a.usage.mu.Unlock()
	if j == nil {
		return
	}
	sum := a.mgr.Summary()
	f := sum.Files
	bytes := a.mgr.Transferred() - j.bytes0
	secs := sum.Elapsed - j.elapsed0
	if result == "done" && f.Failed > 0 {
		result = "partial"
		if f.Done == 0 && f.Skipped == 0 {
			result = "failed"
		}
	}
	props := map[string]any{
		"result": result, "filesDone": f.Done, "filesFailed": f.Failed, "filesSkipped": f.Skipped,
		"filesTotal": f.Total, "bytes": bytes, "durationSec": int64(secs), "limitBps": j.limit, "parallel": j.parallel,
	}
	if secs >= 1 {
		props["avgBps"] = int64(float64(bytes) / secs)
	}
	a.track("job", props)
	for kind, n := range j.errors {
		a.track("error", map[string]any{"kind": kind, "count": n})
	}
	a.sendSoon()
}

// onJobState follows the job's state for usage stats.
func (a *App) onJobState(t engine.Tick) {
	a.usage.mu.Lock()
	a.usage.lastSpeed = t.Speed
	a.usage.mu.Unlock()
	switch t.State {
	case engine.StateDone:
		a.finishJob("done")
	case engine.StateStopped, engine.StateIdle, engine.StateReady:
		a.finishJob("stopped")
	}
}
