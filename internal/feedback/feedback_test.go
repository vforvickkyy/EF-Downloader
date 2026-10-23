package feedback

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
)

// fakeRelay behaves like an Apps Script web app: a POST is answered with a
// redirect, and the result is fetched with a GET.
type fakeRelay struct {
	mu       sync.Mutex
	received []Event
	down     bool
}

func (f *fakeRelay) server(t *testing.T) *httptest.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/exec", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		down := f.down
		f.mu.Unlock()
		if down {
			http.Error(w, "unavailable", http.StatusServiceUnavailable)
			return
		}
		var body struct {
			Token string `json:"token"`
			Event Event  `json:"event"`
		}
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &body)
		result := "/result?ok=1"
		if r.Method != http.MethodPost || body.Token != "secret" {
			result = "/result?ok=0"
		} else {
			f.mu.Lock()
			f.received = append(f.received, body.Event)
			f.mu.Unlock()
		}
		http.Redirect(w, r, result, http.StatusFound)
	})
	mux.HandleFunc("/result", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("result fetched with %s", r.Method)
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Query().Get("ok") == "1" {
			io.WriteString(w, `{"ok":true}`)
		} else {
			io.WriteString(w, `{"ok":false,"error":"unauthorized"}`)
		}
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func useRelay(t *testing.T, url, token string) {
	oldURL, oldToken := RelayURL, RelayToken
	RelayURL, RelayToken = url, token
	t.Cleanup(func() { RelayURL, RelayToken = oldURL, oldToken })
}

func TestSend(t *testing.T) {
	relay := &fakeRelay{}
	srv := relay.server(t)
	ctx := context.Background()

	useRelay(t, "", "")
	if err := Send(ctx, NewEvent(TypeInstall, "id1", "1.1.0")); err != ErrNotConfigured {
		t.Fatalf("unconfigured: %v", err)
	}

	useRelay(t, srv.URL+"/exec", "secret")
	ev := NewEvent(TypeSupport, "id1", "1.1.0")
	ev.Name, ev.Email, ev.Message = "Asha", "asha@example.com", "Hello there, need help"
	if err := Send(ctx, ev); err != nil {
		t.Fatal(err)
	}
	if len(relay.received) != 1 || relay.received[0].Email != "asha@example.com" || relay.received[0].OS == "" || relay.received[0].Time == "" {
		t.Fatalf("received %+v", relay.received)
	}

	useRelay(t, srv.URL+"/exec", "wrong")
	if err := Send(ctx, ev); err == nil {
		t.Fatal("a wrong token must fail")
	}
}

func TestOutboxKeepsOrderAndSurvivesOffline(t *testing.T) {
	relay := &fakeRelay{down: true}
	srv := relay.server(t)
	useRelay(t, srv.URL+"/exec", "secret")
	path := filepath.Join(t.TempDir(), "outbox.json")

	o := OpenOutbox(path)
	o.Add(NewEvent(TypeInstall, "id1", "1.1.0"))
	o.Add(NewEvent(TypeRegister, "id1", "1.1.0"))
	if err := o.Flush(context.Background()); err == nil {
		t.Fatal("flush must fail while the relay is down")
	}
	if o.Len() != 2 {
		t.Fatalf("events lost while offline: %d", o.Len())
	}

	// Reopen from disk (app restarted), relay back up.
	o = OpenOutbox(path)
	relay.mu.Lock()
	relay.down = false
	relay.mu.Unlock()
	if err := o.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	if o.Len() != 0 || len(relay.received) != 2 || relay.received[0].Type != TypeInstall || relay.received[1].Type != TypeRegister {
		t.Fatalf("len %d received %+v", o.Len(), relay.received)
	}
	if OpenOutbox(path).Len() != 0 {
		t.Fatal("sent events must be removed from disk")
	}
}
