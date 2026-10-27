package cloud

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

type fakeService struct {
	mu      sync.Mutex
	batches []map[string]any
	status  int
	check   string
}

func (f *fakeService) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-App-Key") != "k" {
		w.WriteHeader(401)
		return
	}
	switch r.URL.Path {
	case "/api/v1/ingest":
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.status != 0 {
			w.WriteHeader(f.status)
			return
		}
		f.batches = append(f.batches, body)
		w.Write([]byte(`{"ok":true}`))
	case "/api/v1/check":
		if r.URL.Query().Get("installId") != "abc123abc123abc123" || r.URL.Query().Get("version") != "1.2.0" {
			w.WriteHeader(400)
			return
		}
		w.Write([]byte(f.check))
	default:
		w.WriteHeader(404)
	}
}

func setup(t *testing.T, stats *bool) (*Client, *fakeService, string) {
	t.Helper()
	svc := &fakeService{}
	srv := httptest.NewServer(svc)
	t.Cleanup(srv.Close)
	oldURL, oldKey := APIURL, AppKey
	APIURL, AppKey = srv.URL, "k"
	t.Cleanup(func() { APIURL, AppKey = oldURL, oldKey })
	path := filepath.Join(t.TempDir(), "events.json")
	c := Open(path, func() Identity {
		return Identity{InstallID: "abc123abc123abc123", Version: "1.2.0", OS: "Windows 11", Source: "installer", Stats: *stats}
	})
	return c, svc, path
}

func TestTrackAndFlush(t *testing.T) {
	stats := true
	c, svc, path := setup(t, &stats)
	c.Track("session_start", nil)
	c.Track("scan", map[string]any{"ok": true, "files": 3})
	stats = false
	c.Track("feature", map[string]any{"name": "pause"}) // dropped: stats off
	c.Track("support", map[string]any{"message": "hi"}) // essential: kept
	if c.Len() != 3 {
		t.Fatalf("queued %d, want 3", c.Len())
	}

	// The outbox survives a restart.
	again := Open(path, c.ident)
	if again.Len() != 3 {
		t.Fatalf("reloaded %d, want 3", again.Len())
	}

	if err := c.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	if c.Len() != 0 {
		t.Fatal("queue not empty after flush")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("outbox file not removed")
	}
	if len(svc.batches) != 1 {
		t.Fatalf("%d batches", len(svc.batches))
	}
	b := svc.batches[0]
	if b["installId"] != "abc123abc123abc123" || b["appVersion"] != "1.2.0" || b["stats"] != false {
		t.Fatalf("bad batch header: %v", b)
	}
	if n := len(b["events"].([]any)); n != 3 {
		t.Fatalf("%d events sent", n)
	}
}

func TestFlushKeepsEventsWhenServiceIsDown(t *testing.T) {
	stats := true
	c, svc, _ := setup(t, &stats)
	c.Track("session_start", nil)
	svc.status = 503
	if err := c.Flush(context.Background()); err == nil {
		t.Fatal("expected an error")
	}
	if c.Len() != 1 {
		t.Fatal("event lost while the service was down")
	}
	// A batch the service refuses for good is dropped, not retried forever.
	svc.status = 400
	if err := c.Flush(context.Background()); err == nil {
		t.Fatal("expected an error")
	}
	if c.Len() != 0 {
		t.Fatal("refused batch kept")
	}
}

func TestTrimKeepsEssentialEvents(t *testing.T) {
	q := []Event{{Type: "install"}, {Type: "scan"}, {Type: "register"}, {Type: "feature"}, {Type: "job"}}
	out := trim(q, 3)
	if len(out) != 3 || out[0].Type != "install" || out[1].Type != "register" || out[2].Type != "job" {
		t.Fatalf("trim = %v", out)
	}
}

func TestNotConfigured(t *testing.T) {
	old := APIURL
	APIURL = ""
	defer func() { APIURL = old }()
	c := Open("", func() Identity { return Identity{Stats: true} })
	c.Track("session_start", nil)
	if err := c.Flush(context.Background()); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("err = %v", err)
	}
	if _, err := c.Check(context.Background()); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("err = %v", err)
	}
}

func signedUpdate(t *testing.T, file []byte, url string) Update {
	t.Helper()
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	old := UpdateKey
	UpdateKey = base64.StdEncoding.EncodeToString(pub)
	t.Cleanup(func() { UpdateKey = old })
	sum := sha256.Sum256(file)
	u := Update{Version: "1.3.0", URL: url, Size: int64(len(file)), SHA256: hex.EncodeToString(sum[:])}
	u.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(priv, []byte(SigningText(u))))
	return u
}

func TestCheckAndDownloadUpdate(t *testing.T) {
	stats := true
	c, svc, _ := setup(t, &stats)
	file := append([]byte("MZ"), make([]byte, 300_000)...)
	files := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/setup.exe":
			w.Write(file)
		case "/tampered.exe":
			bad := append([]byte(nil), file...)
			bad[100] = 1
			w.Write(bad)
		}
	}))
	defer files.Close()
	// Trust the test server's certificate in Download.
	oldNew := newHTTPClient
	defer func() { newHTTPClient = oldNew }()
	newHTTPClient = func(time.Duration) *http.Client { return files.Client() }

	u := signedUpdate(t, file, files.URL+"/setup.exe")
	offer, _ := json.Marshal(map[string]any{"ok": true, "update": u, "announcements": []map[string]any{{"id": 7, "title": "Hello", "level": "info", "dismissible": true}}})
	svc.check = string(offer)
	res, err := c.Check(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.Update == nil || res.Update.Version != "1.3.0" || len(res.Announcements) != 1 || res.Announcements[0].ID != 7 {
		t.Fatalf("check = %+v", res)
	}

	dir := t.TempDir()
	var last int64
	path, err := res.Update.Download(context.Background(), dir, func(done, total int64) { last = done })
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(path); len(got) != len(file) || last != int64(len(file)) {
		t.Fatal("downloaded file differs")
	}
	// A second call reuses the verified file.
	if p2, err := res.Update.Download(context.Background(), dir, nil); err != nil || p2 != path {
		t.Fatalf("reuse: %v %v", p2, err)
	}

	// Changing anything in the offer breaks the signature.
	forged := *res.Update
	forged.URL = files.URL + "/tampered.exe"
	if _, err := forged.Download(context.Background(), t.TempDir(), nil); !errors.Is(err, ErrBadUpdate) {
		t.Fatalf("forged offer: %v", err)
	}
	// A correctly signed offer whose file was swapped fails the hash check.
	swapped := signedUpdate(t, file, files.URL+"/tampered.exe")
	if _, err := swapped.Download(context.Background(), t.TempDir(), nil); !errors.Is(err, ErrBadUpdate) {
		t.Fatalf("swapped file: %v", err)
	}
	// Plain http links are refused.
	plain := signedUpdate(t, file, "http://example.com/setup.exe")
	if err := plain.Verify(); !errors.Is(err, ErrBadUpdate) {
		t.Fatalf("http link: %v", err)
	}
}
