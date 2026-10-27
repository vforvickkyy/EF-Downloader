package cloud

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"testing"
)

// TestService runs against a real service (web/), e.g. the local dev server:
//
//	EASTAPE_E2E_URL=http://127.0.0.1:3100 EASTAPE_E2E_APP_KEY=... EASTAPE_E2E_UPDATE_KEY=... go test ./internal/cloud -run TestService
//
// The service must offer a published update newer than 1.2.0.
func TestService(t *testing.T) {
	url := os.Getenv("EASTAPE_E2E_URL")
	if url == "" {
		t.Skip("EASTAPE_E2E_URL not set")
	}
	old := [3]string{APIURL, AppKey, UpdateKey}
	APIURL, AppKey, UpdateKey = url, os.Getenv("EASTAPE_E2E_APP_KEY"), os.Getenv("EASTAPE_E2E_UPDATE_KEY")
	defer func() { APIURL, AppKey, UpdateKey = old[0], old[1], old[2] }()

	b := make([]byte, 16)
	_, _ = rand.Read(b)
	id := hex.EncodeToString(b)
	t.Log("install ID", id)
	c := Open("", func() Identity {
		return Identity{InstallID: id, Version: "1.2.0", OS: "Windows 11 (build 26100)", Source: "installer", Stats: true}
	})
	c.Track("install", map[string]any{"source": "installer"})
	c.Track("register", map[string]any{"name": "E2E Tester", "email": "e2e-" + id[:6] + "@example.com"})
	c.Track("session_start", nil)
	c.Track("scan", map[string]any{"ok": true, "links": 1, "kind": "folder", "kinds": map[string]any{"folder": 1}, "files": 12, "bytes": 3 << 20})
	c.Track("job", map[string]any{"result": "done", "filesDone": 12, "bytes": 3 << 20, "durationSec": 4, "avgBps": 786432})
	c.Track("heartbeat", map[string]any{"state": "downloading", "bps": 786432})
	c.Track("support", map[string]any{"name": "E2E Tester", "email": "e2e@example.com", "topic": "Question", "message": "Hello from the end-to-end test"})
	if err := c.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}

	res, err := c.Check(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.Update == nil {
		t.Fatal("no update offered")
	}
	if err := res.Update.Verify(); err != nil {
		t.Fatalf("update from the service doesn't verify: %v", err)
	}
	t.Logf("offered %s, %d announcements", res.Update.Version, len(res.Announcements))
}
