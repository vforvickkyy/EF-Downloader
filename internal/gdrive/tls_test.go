package gdrive

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

// Google's servers prefer HTTP/2. The client must still get proper responses
// over TLS, whichever protocol it settles on.
func TestHTTPSWithHTTP2Server(t *testing.T) {
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "<html><head><title>Over TLS</title></head><body></body></html>")
	}))
	srv.EnableHTTP2 = true
	srv.StartTLS()
	defer srv.Close()

	c := NewClient("")
	c.DriveBase = srv.URL
	c.transport().TLSClientConfig.RootCAs = srv.Client().Transport.(*http.Transport).TLSClientConfig.RootCAs
	title, _, err := c.webEmbeddedView(context.Background(), "folder0000000000000000000000000", "")
	if err != nil {
		t.Fatal(err)
	}
	if title != "Over TLS" {
		t.Fatalf("title %q", title)
	}
}

// Live check against Google's real front end (googleapis.com shares it with
// drive.google.com). Run with EASTAPE_LIVE=1.
func TestLiveGoogleTLS(t *testing.T) {
	if os.Getenv("EASTAPE_LIVE") == "" {
		t.Skip("set EASTAPE_LIVE=1")
	}
	err := NewClient("AIzaSyInvalidKeyForTesting000000000000").TestKey(context.Background())
	if KindOf(err) != ErrBadKey {
		t.Fatalf("want a parsed bad-key error from Google, got: %v", err)
	}
}
