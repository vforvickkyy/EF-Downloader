package main

// Registration, installation notices, support messages and the technical
// details a user can attach to a support message.

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"eastape/internal/cloud"
	"eastape/internal/feedback"
	"eastape/internal/install"
	"eastape/internal/settings"
)

var emailExpr = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]{2,}$`)

func outboxPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, "EastapeDownloader", "outbox.json")
}

// initIdentity gives this copy an install ID and makes sure its installation
// is reported once: by the installer, or here if the installer couldn't
// (offline), or here for a portable copy.
func (a *App) initIdentity() {
	inst := install.Read()
	var ev *feedback.Event
	var usageType string
	var usageProps map[string]any

	a.mu.Lock()
	s := &a.settings
	if inst.ID != "" {
		s.InstallID = inst.ID
		if !inst.PingSent && s.ReportedID != inst.ID {
			e := feedback.NewEvent(feedback.TypeInstall, inst.ID, version)
			e.Source = "app (installer was offline)"
			ev = &e
			usageType, usageProps = "install", map[string]any{"source": "app"}
			s.ReportedID = inst.ID
		}
	} else {
		if s.InstallID == "" {
			s.InstallID = feedback.NewID()
		}
		if s.ReportedID != s.InstallID {
			e := feedback.NewEvent(feedback.TypeFirstRun, s.InstallID, version)
			e.Source = "portable"
			ev = &e
			usageType, usageProps = "first_run", map[string]any{"source": "portable"}
			s.ReportedID = s.InstallID
		}
	}
	saved := *s
	a.mu.Unlock()

	if ev != nil {
		a.outbox.Add(*ev)
		a.track(usageType, usageProps)
	}
	_ = settings.Save(saved)
	a.flushOutbox()
}

// flushOutbox sends waiting messages in the background.
func (a *App) flushOutbox() {
	if a.outbox.Len() == 0 {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		if err := a.outbox.Flush(ctx); err != nil && !errors.Is(err, feedback.ErrNotConfigured) {
			a.diag.add("sending messages", err)
		}
	}()
}

// retryOutbox keeps trying to deliver waiting messages while the app is open.
func (a *App) retryOutbox() {
	t := time.NewTicker(10 * time.Minute)
	defer t.Stop()
	for range t.C {
		a.flushOutbox()
	}
}

// flushBeforeExit gives waiting messages a last short chance to go out.
func (a *App) flushBeforeExit() {
	if a.outbox.Len() == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = a.outbox.Flush(ctx)
}

// Register stores the user's name and email (asked on first start) and
// sends them to Eastape Tech.
func (a *App) Register(name, email string) (settings.Settings, error) {
	name = strings.Join(strings.Fields(name), " ")
	email = strings.TrimSpace(email)
	switch {
	case len([]rune(name)) < 2:
		return a.GetSettings(), errors.New("Please enter your name.")
	case len(name) > 100:
		return a.GetSettings(), errors.New("That name is too long.")
	case len(email) > 200 || !emailExpr.MatchString(email):
		return a.GetSettings(), errors.New("Please enter a valid email address.")
	}

	a.mu.Lock()
	first := a.settings.RegisteredAt == ""
	changed := a.settings.UserName != name || !strings.EqualFold(a.settings.UserEmail, email)
	a.settings.UserName, a.settings.UserEmail = name, email
	if first {
		a.settings.RegisteredAt = time.Now().UTC().Format(time.RFC3339)
	}
	s := a.settings
	a.mu.Unlock()

	if err := settings.Save(s); err != nil {
		a.diag.add("saving profile", err)
		return s, errors.New("Couldn't save your details. Please try again.")
	}
	if first || changed {
		ev := feedback.NewEvent(feedback.TypeRegister, s.InstallID, version)
		ev.Name, ev.Email = name, email
		if !first {
			ev.Source = "profile updated"
		}
		a.outbox.Add(ev)
		a.flushOutbox()
		a.track("register", map[string]any{"name": name, "email": email, "source": ev.Source})
		a.sendSoon()
	}
	return s, nil
}

// SupportRequest is the contact-support form.
type SupportRequest struct {
	Name           string `json:"name"`
	Email          string `json:"email"`
	Topic          string `json:"topic"`
	Message        string `json:"message"`
	IncludeDetails bool   `json:"includeDetails"`
}

// SendSupport sends a message to Eastape Tech support. It returns "sent", or
// "queued" when it will go out automatically once the internet is back.
func (a *App) SendSupport(req SupportRequest) (string, error) {
	req.Name = strings.Join(strings.Fields(req.Name), " ")
	req.Email = strings.TrimSpace(req.Email)
	req.Message = strings.TrimSpace(req.Message)
	switch {
	case len([]rune(req.Name)) < 2:
		return "", errors.New("Please enter your name.")
	case !emailExpr.MatchString(req.Email):
		return "", errors.New("Please enter a valid email address so we can reply.")
	case len([]rune(req.Message)) < 10:
		return "", errors.New("Please describe your question in a few words (at least 10 characters).")
	case len([]rune(req.Message)) > 5000:
		return "", errors.New("Your message is too long. Please keep it under 5,000 characters.")
	}

	ev := feedback.NewEvent(feedback.TypeSupport, a.GetSettings().InstallID, version)
	ev.Name, ev.Email, ev.Topic, ev.Message = req.Name, req.Email, req.Topic, req.Message
	if req.IncludeDetails {
		ev.Details = a.diagnostics()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()

	// The message goes to the dashboard and, while the email relay is set
	// up, by email too. Either one counts as sent.
	props := map[string]any{"name": ev.Name, "email": ev.Email, "topic": ev.Topic, "message": ev.Message}
	if ev.Details != "" {
		props["details"] = ev.Details
	}
	a.track("support", props)
	sent := false
	if err := a.cloud.Flush(ctx); err == nil {
		sent = true
	} else if !errors.Is(err, cloud.ErrNotConfigured) {
		a.diag.add("support message", err)
	}
	if err := feedback.Send(ctx, ev); err == nil {
		sent = true
	} else if !errors.Is(err, feedback.ErrNotConfigured) {
		a.diag.add("support message by email", err)
		a.outbox.Add(ev)
	}
	if !sent {
		return "queued", nil
	}
	return "sent", nil
}

// diagnostics describes the app's state for a support message. The user
// chooses whether to include it.
func (a *App) diagnostics() string {
	s := a.GetSettings()
	t := a.mgr.Snapshot()
	inst := "portable copy"
	if install.Read().ID != "" {
		inst = "installed"
	}
	limit := "unlimited"
	if s.SpeedLimitKB > 0 {
		limit = fmt.Sprintf("%d KB/s", s.SpeedLimitKB)
	}
	var b strings.Builder
	fmt.Fprintf(&b, "App: %s %s (%s)\n", appName, version, inst)
	fmt.Fprintf(&b, "Windows: %s\n", feedback.OSVersion())
	fmt.Fprintf(&b, "Install ID: %s\n", s.InstallID)
	fmt.Fprintf(&b, "Google API key: %v\n", s.APIKey != "")
	fmt.Fprintf(&b, "Settings: %d at once, limit %s, docs as %s, re-download existing %v, retries %d\n", s.Parallel, limit, s.DocsFormat, s.Overwrite, s.Retries)
	f := t.Files
	fmt.Fprintf(&b, "Current job: %s, %d files (%d done, %d already saved, %d failed, %d waiting)\n", t.State, f.Total, f.Done, f.Skipped, f.Failed, f.Queued+f.Active)
	fmt.Fprintf(&b, "Messages waiting to send: %d\n", a.outbox.Len())
	b.WriteString("\nRecent problems:\n")
	b.WriteString(a.diag.text())
	return b.String()
}

// diagLog keeps the last technical errors, so users never see them but can
// share them with support.
type diagLog struct {
	mu      sync.Mutex
	entries []string
}

func (d *diagLog) add(where string, err error) {
	if err == nil || errors.Is(err, context.Canceled) {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	d.entries = append(d.entries, fmt.Sprintf("%s  %s: %v", time.Now().Format("2006-01-02 15:04:05"), where, err))
	if len(d.entries) > 30 {
		d.entries = d.entries[len(d.entries)-30:]
	}
}

func (d *diagLog) text() string {
	d.mu.Lock()
	defer d.mu.Unlock()
	if len(d.entries) == 0 {
		return "(none)\n"
	}
	return strings.Join(d.entries, "\n") + "\n"
}

// reportInstall runs when the installer starts the app with --report-install:
// it records the install ID and tells Eastape Tech about the installation,
// then exits without opening a window. An existing install ID is kept, also
// when moving from a version 1.1 installation for all users.
func reportInstall() {
	prev := install.Read()
	typ := feedback.TypeInstall
	id := prev.ID
	switch {
	case id == "":
		id = feedback.NewID()
	case prev.Version != version:
		typ = feedback.TypeUpdate
	default:
		typ = feedback.TypeReinstall
	}
	ev := feedback.NewEvent(typ, id, version)
	ev.Source = "installer"
	if typ == feedback.TypeUpdate {
		ev.PrevVersion = prev.Version
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// Usage stats are on by default; the setting lives with the user's settings.
	stats := !settings.Load().StatsOff
	c := cloud.Open("", func() cloud.Identity {
		return cloud.Identity{InstallID: id, Version: version, OS: ev.OS, Source: "installer", Stats: stats}
	})
	props := map[string]any{"source": "installer"}
	if ev.PrevVersion != "" {
		props["prevVersion"] = ev.PrevVersion
	}
	c.Track(typ, props)
	cloudErr := c.Flush(ctx)
	relayErr := feedback.Send(ctx, ev)

	// The dashboard is the record; without it, the email relay.
	sent := cloudErr == nil || (errors.Is(cloudErr, cloud.ErrNotConfigured) && relayErr == nil)
	dir := ""
	if exe, err := os.Executable(); err == nil {
		dir = filepath.Dir(exe)
	}
	_ = install.Write(install.Info{ID: id, Version: version, Dir: dir, PingSent: sent})
}
