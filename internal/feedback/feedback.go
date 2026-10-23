// Package feedback sends installation notices, registrations and support
// messages to Eastape Tech. They go to a private relay (a Google Apps Script
// web app, see server/apps-script) that forwards them by email, so no email
// address or mail password is stored in the app. Messages that can't be sent
// right away wait in an outbox and are retried later.
package feedback

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Relay endpoint and shared token, set at build time with
// -ldflags "-X eastape/internal/feedback.RelayURL=... -X eastape/internal/feedback.RelayToken=...".
var (
	RelayURL   = ""
	RelayToken = ""
)

// ErrNotConfigured means this build has no relay address.
var ErrNotConfigured = errors.New("relay not configured")

// Event types.
const (
	TypeInstall   = "install"   // new installation (sent by the installer)
	TypeUpdate    = "update"    // installed over an older version
	TypeReinstall = "reinstall" // installed again, same version
	TypeFirstRun  = "first_run" // portable copy started for the first time
	TypeRegister  = "register"  // user entered name and email
	TypeSupport   = "support"   // contact-support message
)

// Event is one message for Eastape Tech.
type Event struct {
	Type        string `json:"type"`
	InstallID   string `json:"installId"`
	AppVersion  string `json:"appVersion"`
	OS          string `json:"os"`
	Time        string `json:"time"`
	Source      string `json:"source,omitempty"` // installer, app, portable
	PrevVersion string `json:"prevVersion,omitempty"`
	Name        string `json:"name,omitempty"`
	Email       string `json:"email,omitempty"`
	Topic       string `json:"topic,omitempty"`
	Message     string `json:"message,omitempty"`
	Details     string `json:"details,omitempty"`
}

// NewEvent fills in the fields every event carries.
func NewEvent(typ, installID, appVersion string) Event {
	return Event{Type: typ, InstallID: installID, AppVersion: appVersion, OS: OSVersion(), Time: time.Now().UTC().Format(time.RFC3339)}
}

// NewID returns a random install ID.
func NewID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

var httpClient = &http.Client{Timeout: 25 * time.Second}

// Send delivers one event to the relay.
func Send(ctx context.Context, ev Event) error {
	if RelayURL == "" {
		return ErrNotConfigured
	}
	body, err := json.Marshal(struct {
		Token string `json:"token"`
		Event Event  `json:"event"`
	}{RelayToken, ev})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, RelayURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	// text/plain keeps Apps Script from trying to parse the body as a form.
	req.Header.Set("Content-Type", "text/plain;charset=utf-8")
	// Apps Script answers POSTs with a redirect to the result, which the
	// client follows with a GET.
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var r struct {
		OK    bool   `json:"ok"`
		Error string `json:"error"`
	}
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if resp.StatusCode != http.StatusOK || json.Unmarshal(raw, &r) != nil || !r.OK {
		return fmt.Errorf("relay answered %d: %s", resp.StatusCode, firstLine(r.Error, raw))
	}
	return nil
}

func firstLine(msg string, raw []byte) string {
	if msg != "" {
		return msg
	}
	s := string(raw)
	if len(s) > 120 {
		s = s[:120]
	}
	return s
}

// Outbox keeps events that still have to be sent, in a JSON file.
type Outbox struct {
	path     string
	mu       sync.Mutex
	events   []Event
	flushing bool
}

const maxOutbox = 100

// OpenOutbox loads the outbox stored at path (missing is fine).
func OpenOutbox(path string) *Outbox {
	o := &Outbox{path: path}
	if b, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(b, &o.events)
	}
	return o
}

// Add queues an event.
func (o *Outbox) Add(ev Event) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.events = append(o.events, ev)
	if len(o.events) > maxOutbox {
		o.events = o.events[len(o.events)-maxOutbox:]
	}
	o.saveLocked()
}

// Len returns how many events are waiting.
func (o *Outbox) Len() int {
	o.mu.Lock()
	defer o.mu.Unlock()
	return len(o.events)
}

// Flush sends waiting events in order and stops at the first failure, so
// nothing is lost while offline. Only one flush runs at a time.
func (o *Outbox) Flush(ctx context.Context) error {
	o.mu.Lock()
	if o.flushing {
		o.mu.Unlock()
		return nil
	}
	o.flushing = true
	o.mu.Unlock()
	defer func() {
		o.mu.Lock()
		o.flushing = false
		o.mu.Unlock()
	}()

	for {
		o.mu.Lock()
		if len(o.events) == 0 {
			o.mu.Unlock()
			return nil
		}
		ev := o.events[0]
		o.mu.Unlock()

		if err := Send(ctx, ev); err != nil {
			return err
		}
		o.mu.Lock()
		if len(o.events) > 0 {
			o.events = o.events[1:]
		}
		o.saveLocked()
		o.mu.Unlock()
	}
}

func (o *Outbox) saveLocked() {
	if o.path == "" {
		return
	}
	_ = os.MkdirAll(filepath.Dir(o.path), 0o755)
	b, _ := json.Marshal(o.events)
	tmp := o.path + ".tmp"
	if os.WriteFile(tmp, b, 0o600) == nil {
		_ = os.Rename(tmp, o.path)
	}
}
