package gdrive

import (
	"context"
	"crypto/tls"
	"io"
	"net"
	"net/http"
	"net/http/cookiejar"
	"strings"
	"time"
)

const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"

// Client is a Drive client for public content. The zero value is not usable;
// call NewClient.
type Client struct {
	http   *http.Client
	apiKey string

	// Endpoints, replaced by tests.
	DriveBase       string
	UserContentBase string
	DocsBase        string
	APIBase         string
}

// NewClient returns a client. With an empty apiKey everything goes through
// Drive's public web pages.
func NewClient(apiKey string) *Client {
	// HTTP/1.1 only: one TCP connection per parallel download instead of
	// HTTP/2 multiplexing them over a single connection, which is noticeably
	// faster on Google's servers. A fresh Transport is needed: a clone of
	// http.DefaultTransport keeps advertising "h2" during the TLS handshake,
	// Google then answers in HTTP/2, and every response looks malformed.
	tr := &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           (&net.Dialer{Timeout: 20 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		TLSClientConfig:       &tls.Config{NextProtos: []string{"http/1.1"}},
		TLSNextProto:          map[string]func(string, *tls.Conn) http.RoundTripper{},
		TLSHandshakeTimeout:   20 * time.Second,
		ResponseHeaderTimeout: 90 * time.Second,
		ExpectContinueTimeout: time.Second,
		IdleConnTimeout:       90 * time.Second,
		MaxIdleConns:          64,
		MaxIdleConnsPerHost:   16,
	}
	jar, _ := cookiejar.New(nil)
	return &Client{
		http:            &http.Client{Transport: tr, Jar: jar},
		apiKey:          strings.TrimSpace(apiKey),
		DriveBase:       "https://drive.google.com",
		UserContentBase: "https://drive.usercontent.google.com",
		DocsBase:        "https://docs.google.com",
		APIBase:         "https://www.googleapis.com/drive/v3",
	}
}

// HasAPIKey reports whether the official Drive API is used.
func (c *Client) HasAPIKey() bool { return c.apiKey != "" }

func (c *Client) newRequest(ctx context.Context, rawURL string) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	return req, nil
}

// fetchPage downloads a (small) page into memory.
func (c *Client) fetchPage(ctx context.Context, rawURL string) (body []byte, resp *http.Response, err error) {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	req, err := c.newRequest(ctx, rawURL)
	if err != nil {
		return nil, nil, err
	}
	resp, err = c.http.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()
	body, err = io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	return body, resp, err
}

// withRetry runs fn up to 3 times while it fails with a retryable error.
func withRetry[T any](ctx context.Context, fn func() (T, error)) (T, error) {
	var (
		v   T
		err error
	)
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return v, ctx.Err()
			case <-time.After(time.Duration(attempt*attempt) * 1500 * time.Millisecond):
			}
		}
		v, err = fn()
		if err == nil || !Retryable(err) || ctx.Err() != nil {
			return v, err
		}
	}
	return v, err
}

func (c *Client) transport() *http.Transport { return c.http.Transport.(*http.Transport) }
