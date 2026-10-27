// Package cloud talks to the Eastape Downloader service (see web/ in this
// repository): it sends usage events in small batches, asks whether an update
// or an announcement is waiting, and downloads and verifies updates.
//
// Events wait in an outbox file until they are delivered, so nothing is lost
// while the computer is offline. When the user turns usage stats off, only
// the essential events (installation, registration, support messages and the
// switch itself) are sent.
package cloud

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Service address and keys. AppKey is set at build time with
// -ldflags "-X eastape/internal/cloud.AppKey=..."; the others can be.
var (
	APIURL = ""
	AppKey = ""
	// UpdateKey is the Ed25519 public key (base64) whose signature every
	// update must carry. It matches RELEASE_SIGNING_KEY on the service.
	UpdateKey = "aeaXIYzvBubtN+em/W327/Gf+FcDHXyFEh6hnR8yiB8="
)

// ErrNotConfigured means this build has no service address.
var ErrNotConfigured = errors.New("cloud service not configured")

const (
	maxQueue = 1000
	maxBatch = 200
)

// Event is one thing that happened in the app.
type Event struct {
	Type  string         `json:"type"`
	TS    time.Time      `json:"ts"`
	Props map[string]any `json:"props,omitempty"`
}

// Essential reports whether an event is sent even with usage stats off.
func Essential(typ string) bool {
	switch typ {
	case "install", "update", "reinstall", "first_run", "register", "support", "stats_enabled", "stats_disabled":
		return true
	}
	return false
}

// Identity describes this copy of the app; it is read for every batch.
type Identity struct {
	InstallID string
	Version   string
	OS        string
	Source    string // installer, portable
	Stats     bool   // usage stats allowed
}

// Client queues events and sends them.
type Client struct {
	path  string
	ident func() Identity
	http  *http.Client

	mu    sync.Mutex
	queue []Event

	sending sync.Mutex
}

// Open loads the outbox at path (it may not exist yet).
func Open(path string, ident func() Identity) *Client {
	c := &Client{path: path, ident: ident, http: newHTTPClient(30 * time.Second)}
	if b, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(b, &c.queue)
	}
	return c
}

// newHTTPClient speaks HTTP/1.1 only, like the Drive client: some antivirus
// and proxy software breaks HTTP/2.
var newHTTPClient = func(timeout time.Duration) *http.Client {
	return &http.Client{Timeout: timeout, Transport: &http.Transport{
		Proxy:               http.ProxyFromEnvironment,
		DialContext:         (&net.Dialer{Timeout: 20 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		TLSClientConfig:     &tls.Config{NextProtos: []string{"http/1.1"}},
		TLSNextProto:        map[string]func(string, *tls.Conn) http.RoundTripper{},
		TLSHandshakeTimeout: 20 * time.Second,
		IdleConnTimeout:     60 * time.Second,
	}}
}

// Configured reports whether this build can reach the service.
func Configured() bool { return APIURL != "" && AppKey != "" }

// Track queues an event. Usage events are dropped while stats are off.
func (c *Client) Track(typ string, props map[string]any) {
	if !Essential(typ) && !c.ident().Stats {
		return
	}
	c.mu.Lock()
	c.queue = append(c.queue, Event{Type: typ, TS: time.Now().UTC(), Props: props})
	if len(c.queue) > maxQueue {
		c.queue = trim(c.queue, maxQueue)
	}
	c.saveLocked()
	c.mu.Unlock()
}

// trim drops the oldest usage events (never essential ones) to fit max.
func trim(q []Event, max int) []Event {
	drop := len(q) - max
	out := q[:0]
	for _, e := range q {
		if drop > 0 && !Essential(e.Type) {
			drop--
			continue
		}
		out = append(out, e)
	}
	return out
}

// DropUsage removes waiting usage events (when the user turns stats off),
// keeping the essential ones.
func (c *Client) DropUsage() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.queue = trim(c.queue, 0)
	c.saveLocked()
}

// Len returns how many events are waiting.
func (c *Client) Len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.queue)
}

func (c *Client) saveLocked() {
	if c.path == "" {
		return
	}
	if len(c.queue) == 0 {
		_ = os.Remove(c.path)
		return
	}
	b, err := json.Marshal(c.queue)
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(c.path), 0o755)
	tmp := c.path + ".tmp"
	if os.WriteFile(tmp, b, 0o600) == nil {
		_ = os.Rename(tmp, c.path)
	}
}

// Flush sends everything waiting, oldest first.
func (c *Client) Flush(ctx context.Context) error {
	if !Configured() {
		return ErrNotConfigured
	}
	c.sending.Lock()
	defer c.sending.Unlock()
	for {
		c.mu.Lock()
		if len(c.queue) == 0 {
			c.mu.Unlock()
			return nil
		}
		n := min(len(c.queue), maxBatch)
		batch := append([]Event(nil), c.queue[:n]...)
		c.mu.Unlock()

		err := c.send(ctx, batch)
		var re *rejectedError
		if err != nil && !errors.As(err, &re) {
			return err
		}
		// Delivered, or refused for good (a broken batch must not block the rest).
		c.mu.Lock()
		c.queue = c.queue[n:]
		c.saveLocked()
		c.mu.Unlock()
		if err != nil {
			return err
		}
	}
}

type rejectedError struct{ status int }

func (e *rejectedError) Error() string {
	return fmt.Sprintf("service refused the events (HTTP %d)", e.status)
}

func (c *Client) send(ctx context.Context, batch []Event) error {
	id := c.ident()
	body, err := json.Marshal(map[string]any{
		"installId":  id.InstallID,
		"appVersion": id.Version,
		"os":         id.OS,
		"source":     id.Source,
		"stats":      id.Stats,
		"events":     batch,
	})
	if err != nil {
		return err
	}
	resp, err := c.do(ctx, http.MethodPost, "/api/v1/ingest", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	switch {
	case resp.StatusCode == http.StatusOK:
		return nil
	case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500:
		return fmt.Errorf("service busy (HTTP %d)", resp.StatusCode)
	default:
		return &rejectedError{resp.StatusCode}
	}
}

func (c *Client) do(ctx context.Context, method, path string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(APIURL, "/")+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-App-Key", AppKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return c.http.Do(req)
}

// Update is a newer version the service offers.
type Update struct {
	Version     string `json:"version"`
	Notes       string `json:"notes"`
	Mandatory   bool   `json:"mandatory"`
	URL         string `json:"url"`
	Size        int64  `json:"size"`
	SHA256      string `json:"sha256"`
	Signature   string `json:"signature"`
	PublishedAt string `json:"publishedAt"`
}

// Announcement is a message to show in the app.
type Announcement struct {
	ID          int64  `json:"id"`
	Title       string `json:"title"`
	Body        string `json:"body"`
	Level       string `json:"level"` // info, success, warning, critical
	CTALabel    string `json:"ctaLabel"`
	CTAURL      string `json:"ctaUrl"`
	Dismissible bool   `json:"dismissible"`
	StartsAt    string `json:"startsAt"`
}

// CheckResult is the answer to Check.
type CheckResult struct {
	Update        *Update        `json:"update"`
	Announcements []Announcement `json:"announcements"`
}

// Check asks whether an update or announcements are waiting.
func (c *Client) Check(ctx context.Context) (*CheckResult, error) {
	if !Configured() {
		return nil, ErrNotConfigured
	}
	id := c.ident()
	q := url.Values{"installId": {id.InstallID}, "version": {id.Version}, "channel": {"stable"}}
	resp, err := c.do(ctx, http.MethodGet, "/api/v1/check?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("update check failed (HTTP %d)", resp.StatusCode)
	}
	var r CheckResult
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil, fmt.Errorf("update check: %w", err)
	}
	if r.Update != nil && r.Update.Version == "" {
		r.Update = nil
	}
	return &r, nil
}
