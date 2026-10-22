package gdrive

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// API-key mode: the official Drive API v3. Public files only need a key, not
// a login. It lists folders of any size and reports exact file sizes.

const apiFileFields = "id,name,mimeType,size,md5Checksum,modifiedTime,resourceKey,shortcutDetails"

type apiFile struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	MimeType        string `json:"mimeType"`
	Size            string `json:"size"`
	MD5             string `json:"md5Checksum"`
	ModifiedTime    string `json:"modifiedTime"`
	ResourceKey     string `json:"resourceKey"`
	ShortcutDetails *struct {
		TargetID          string `json:"targetId"`
		TargetMimeType    string `json:"targetMimeType"`
		TargetResourceKey string `json:"targetResourceKey"`
	} `json:"shortcutDetails"`
}

func (f *apiFile) item() *Item {
	it := &Item{ID: f.ID, ResourceKey: f.ResourceKey, Name: f.Name, MimeType: f.MimeType, Size: -1, MD5: f.MD5, Modified: f.ModifiedTime}
	if n, err := strconv.ParseInt(f.Size, 10, 64); err == nil && !it.IsGoogleNative() {
		it.Size = n
	}
	return it
}

type apiError struct {
	Error struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Status  string `json:"status"`
		Errors  []struct {
			Reason string `json:"reason"`
		} `json:"errors"`
		Details []struct {
			Reason string `json:"reason"`
		} `json:"details"`
	} `json:"error"`
}

// apiErr classifies a Drive API error response.
func apiErr(status int, body []byte) error {
	var ae apiError
	_ = json.Unmarshal(body, &ae)
	reasons := ae.Error.Status
	for _, e := range ae.Error.Errors {
		reasons += " " + e.Reason
	}
	for _, d := range ae.Error.Details {
		reasons += " " + d.Reason
	}
	msg := ae.Error.Message
	switch {
	case strings.Contains(reasons, "downloadQuotaExceeded"):
		return errQuota(status)
	case strings.Contains(reasons, "accessNotConfigured"), strings.Contains(reasons, "SERVICE_DISABLED"):
		return newErr(ErrBadKey, status, "The Google Drive API is turned off for your API key's project. Turn it on in Google Cloud Console → APIs & Services → Library → Google Drive API.")
	case strings.Contains(reasons, "keyInvalid"), strings.Contains(reasons, "API_KEY_INVALID"), strings.Contains(msg, "API key not valid"):
		return newErr(ErrBadKey, status, "Your API key isn't valid. Check it in Settings.")
	case strings.Contains(reasons, "API_KEY_SERVICE_BLOCKED"), strings.Contains(reasons, "API_KEY_HTTP_REFERRER_BLOCKED"), strings.Contains(reasons, "API_KEY_IP_ADDRESS_BLOCKED"):
		return newErr(ErrBadKey, status, "Your API key is restricted and can't call the Drive API. Remove the restriction or allow \"Google Drive API\" for it.")
	case strings.Contains(reasons, "RATE_LIMIT_EXCEEDED"), strings.Contains(reasons, "rateLimitExceeded"), strings.Contains(reasons, "userRateLimitExceeded"), status == 429:
		return newErr(ErrTransient, status, "Google is rate limiting requests; retrying")
	case strings.Contains(reasons, "exportSizeLimitExceeded"):
		return newErr(ErrNotDownloadable, status, "Too large for the API to convert")
	case strings.Contains(reasons, "cannotDownloadAbusiveFile"):
		return newErr(ErrNoAccess, status, "Google flagged this file as possibly harmful")
	case strings.Contains(reasons, "fileNotDownloadable"):
		return newErr(ErrNotDownloadable, status, "Google doesn't allow downloading this file type")
	case status == 404 || strings.Contains(reasons, "notFound"):
		return errNotFound(status)
	}
	e := statusErr(status)
	if msg != "" && e.Kind == ErrTransient {
		e.Msg += ": " + msg
	}
	return e
}

func (c *Client) apiRequest(ctx context.Context, path string, q url.Values, resourceKeys ...string) (*http.Request, error) {
	q.Set("key", c.apiKey)
	q.Set("supportsAllDrives", "true")
	req, err := c.newRequest(ctx, c.APIBase+path+"?"+q.Encode())
	if err != nil {
		return nil, err
	}
	var rk []string
	for i := 0; i+1 < len(resourceKeys); i += 2 {
		if resourceKeys[i+1] != "" {
			rk = append(rk, resourceKeys[i]+"/"+resourceKeys[i+1])
		}
	}
	if len(rk) > 0 {
		req.Header.Set("X-Goog-Drive-Resource-Keys", strings.Join(rk, ","))
	}
	return req, nil
}

func (c *Client) apiJSON(ctx context.Context, path string, q url.Values, out any, resourceKeys ...string) error {
	_, err := withRetry(ctx, func() (struct{}, error) {
		req, err := c.apiRequest(ctx, path, q, resourceKeys...)
		if err != nil {
			return struct{}{}, err
		}
		resp, err := c.http.Do(req)
		if err != nil {
			return struct{}{}, err
		}
		defer resp.Body.Close()
		body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
		if err != nil {
			return struct{}{}, err
		}
		if resp.StatusCode != http.StatusOK {
			return struct{}{}, apiErr(resp.StatusCode, body)
		}
		return struct{}{}, json.Unmarshal(body, out)
	})
	return err
}

// apiGet returns one file's metadata, following shortcuts.
func (c *Client) apiGet(ctx context.Context, id, rk string) (*Item, error) {
	var f apiFile
	if err := c.apiJSON(ctx, "/files/"+url.PathEscape(id), url.Values{"fields": {apiFileFields}}, &f, id, rk); err != nil {
		return nil, err
	}
	if f.MimeType == MimeShortcut && f.ShortcutDetails != nil {
		t, err := c.apiGet(ctx, f.ShortcutDetails.TargetID, f.ShortcutDetails.TargetResourceKey)
		if err != nil {
			return nil, err
		}
		t.Name = f.Name
		return t, nil
	}
	return f.item(), nil
}

// apiList returns a folder's direct children.
func (c *Client) apiList(ctx context.Context, folderID, rk string) ([]*Item, error) {
	var items []*Item
	pageToken := ""
	for {
		q := url.Values{
			"q":                         {"'" + folderID + "' in parents and trashed = false"},
			"fields":                    {"nextPageToken,files(" + apiFileFields + ")"},
			"pageSize":                  {"1000"},
			"includeItemsFromAllDrives": {"true"},
		}
		if pageToken != "" {
			q.Set("pageToken", pageToken)
		}
		var page struct {
			NextPageToken string    `json:"nextPageToken"`
			Files         []apiFile `json:"files"`
		}
		if err := c.apiJSON(ctx, "/files", q, &page, folderID, rk); err != nil {
			return nil, err
		}
		for i := range page.Files {
			f := &page.Files[i]
			if f.MimeType == MimeShortcut {
				if f.ShortcutDetails == nil {
					continue
				}
				t, err := c.apiGet(ctx, f.ShortcutDetails.TargetID, f.ShortcutDetails.TargetResourceKey)
				if err != nil {
					continue // shortcut to something we can't see
				}
				t.Name = f.Name
				items = append(items, t)
				continue
			}
			items = append(items, f.item())
		}
		if page.NextPageToken == "" {
			return items, nil
		}
		pageToken = page.NextPageToken
	}
}

// TestKey checks that the API key is valid and the Drive API is enabled for
// it, by asking for a file that doesn't exist: a good key gets "not found".
func (c *Client) TestKey(ctx context.Context) error {
	var f apiFile
	err := c.apiJSON(ctx, "/files/eastape-key-check-0000", url.Values{"fields": {"id"}}, &f)
	switch KindOf(err) {
	case ErrNotFound, ErrNoAccess:
		return nil
	}
	return err
}
