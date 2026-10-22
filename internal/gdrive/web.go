package gdrive

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/net/html"
)

// No-key mode: read the same public pages a browser shows.
//
// Folder contents come from drive.google.com/embeddedfolderview (the page
// Google serves for embedding a shared folder; it lists every child), with
// the regular folder page's inline data as a fallback.

const errParseFolderMsg = "Couldn't read this folder. Check it is shared as \"Anyone with the link\". If it is, adding a free API key in Settings will work around this."

type webEntry struct {
	ID, ResourceKey, Name, Mime string
}

// webListFolder returns the folder's name and its direct children.
func (c *Client) webListFolder(ctx context.Context, id, rk string) (string, []*Item, error) {
	return withRetry3(ctx, func() (string, []*Item, error) {
		title, entries, err := c.webEmbeddedView(ctx, id, rk)
		if err != nil {
			if k := KindOf(err); k == ErrNoAccess || k == ErrNotFound || ctx.Err() != nil {
				return "", nil, err
			}
			// Fall back to the folder page; report the first error if that
			// fails too.
			t2, e2, err2 := c.webFolderPage(ctx, id, rk)
			if err2 != nil {
				return "", nil, err
			}
			title, entries = t2, e2
		}
		items := make([]*Item, 0, len(entries))
		for _, e := range entries {
			items = append(items, &Item{ID: e.ID, ResourceKey: e.ResourceKey, Name: e.Name, MimeType: e.Mime, Size: -1})
		}
		return title, items, nil
	})
}

// Two values cannot go through withRetry's single T; this keeps the call
// sites tidy.
func withRetry3[A, B any](ctx context.Context, fn func() (A, B, error)) (A, B, error) {
	type pair struct {
		a A
		b B
	}
	p, err := withRetry(ctx, func() (pair, error) {
		a, b, err := fn()
		return pair{a, b}, err
	})
	return p.a, p.b, err
}

func (c *Client) webEmbeddedView(ctx context.Context, id, rk string) (string, []webEntry, error) {
	q := url.Values{"id": {id}, "hl": {"en"}}
	if rk != "" {
		q.Set("resourcekey", rk)
	}
	body, resp, err := c.fetchPage(ctx, c.DriveBase+"/embeddedfolderview?"+q.Encode())
	if err != nil {
		return "", nil, err
	}
	if err := checkPageResponse(resp); err != nil {
		return "", nil, err
	}
	return parseEmbeddedFolderView(body, resp.Request.URL)
}

func (c *Client) webFolderPage(ctx context.Context, id, rk string) (string, []webEntry, error) {
	q := url.Values{"hl": {"en"}}
	if rk != "" {
		q.Set("resourcekey", rk)
	}
	body, resp, err := c.fetchPage(ctx, c.DriveBase+"/drive/folders/"+url.PathEscape(id)+"?"+q.Encode())
	if err != nil {
		return "", nil, err
	}
	if err := checkPageResponse(resp); err != nil {
		return "", nil, err
	}
	return parseFolderPage(body)
}

// checkPageResponse turns sign-in redirects and error statuses into errors.
func checkPageResponse(resp *http.Response) error {
	if isSignInURL(resp.Request.URL) {
		return errNoAccess(resp.StatusCode)
	}
	if resp.StatusCode != http.StatusOK {
		return statusErr(resp.StatusCode)
	}
	return nil
}

func isSignInURL(u *url.URL) bool {
	return u != nil && (u.Host == "accounts.google.com" || strings.Contains(u.Path, "ServiceLogin"))
}

// parseEmbeddedFolderView reads the folder name (<title>) and every link to
// a child file, Google doc or subfolder.
func parseEmbeddedFolderView(body []byte, base *url.URL) (string, []webEntry, error) {
	z := html.NewTokenizer(bytes.NewReader(body))
	var (
		title     string
		inTitle   bool
		entries   []webEntry
		seen      = map[string]int{}
		curHref   string
		inAnchor  int // nesting depth inside the current <a>
		anchorTxt strings.Builder
	)
	for {
		tt := z.Next()
		switch tt {
		case html.ErrorToken:
			if title == "" {
				return "", nil, newErr(ErrParse, 0, errParseFolderMsg)
			}
			return strings.TrimSpace(title), entries, nil
		case html.StartTagToken, html.SelfClosingTagToken:
			name, hasAttr := z.TagName()
			switch string(name) {
			case "title":
				inTitle = tt == html.StartTagToken
			case "a":
				curHref = ""
				for hasAttr {
					var k, v []byte
					k, v, hasAttr = z.TagAttr()
					if string(k) == "href" {
						curHref = string(v)
					}
				}
				inAnchor = 1
				anchorTxt.Reset()
			default:
				if inAnchor > 0 && tt == html.StartTagToken {
					inAnchor++
				}
			}
		case html.EndTagToken:
			name, _ := z.TagName()
			switch string(name) {
			case "title":
				inTitle = false
			case "a":
				if inAnchor > 0 {
					if e, ok := classifyHref(curHref, base); ok {
						e.Name = strings.Join(strings.Fields(anchorTxt.String()), " ")
						if i, dup := seen[e.ID]; dup {
							if entries[i].Name == "" {
								entries[i].Name = e.Name
							}
						} else {
							seen[e.ID] = len(entries)
							entries = append(entries, e)
						}
					}
				}
				inAnchor = 0
			default:
				if inAnchor > 1 {
					inAnchor--
				}
			}
		case html.TextToken:
			if inTitle {
				title += string(z.Text())
			} else if inAnchor > 0 {
				anchorTxt.Write(z.Text())
				anchorTxt.WriteByte(' ')
			}
		}
	}
}

// classifyHref recognises links to files, docs and folders. The link, not the
// visible name, tells them apart.
func classifyHref(href string, base *url.URL) (webEntry, bool) {
	u, err := url.Parse(strings.TrimSpace(href))
	if err != nil {
		return webEntry{}, false
	}
	if base != nil {
		u = base.ResolveReference(u)
	}
	e := webEntry{ResourceKey: u.Query().Get("resourcekey")}
	switch strings.ToLower(u.Hostname()) {
	case "drive.google.com":
		if m := folderPath.FindStringSubmatch(u.Path); m != nil {
			e.ID, e.Mime = m[1], MimeFolder
		} else if m := filePath.FindStringSubmatch(u.Path); m != nil {
			e.ID, e.Mime = m[1], MimeUnknownFile
		} else if strings.HasSuffix(u.Path, "/folderview") {
			e.ID, e.Mime = u.Query().Get("id"), MimeFolder
		}
	case "docs.google.com":
		if m := docsPath.FindStringSubmatch(u.Path); m != nil && m[2] == "" {
			e.ID, e.Mime = m[3], mimeForDocsPath(m[1])
		}
	}
	return e, e.ID != "" && idPattern.MatchString(e.ID)
}

var ivdExpr = regexp.MustCompile(`_DRIVE_ivd'\]\s*=\s*'((?:[^'\\]|\\.)*)'`)

// parseFolderPage reads the data the regular folder page embeds for its
// first screen of items.
func parseFolderPage(body []byte) (string, []webEntry, error) {
	m := ivdExpr.FindSubmatch(body)
	if m == nil {
		return "", nil, newErr(ErrParse, 0, errParseFolderMsg)
	}
	raw, err := jsUnescape(string(m[1]))
	if err != nil {
		return "", nil, newErr(ErrParse, 0, "Couldn't decode the folder page: %v", err)
	}
	var arr []any
	if err := json.Unmarshal([]byte(raw), &arr); err != nil {
		return "", nil, newErr(ErrParse, 0, "Couldn't decode the folder page: %v", err)
	}
	var entries []webEntry
	if len(arr) > 0 {
		list, _ := arr[0].([]any)
		for _, x := range list {
			e, _ := x.([]any)
			if len(e) < 4 {
				continue
			}
			id, _ := e[0].(string)
			name, _ := e[2].(string)
			mime, _ := e[3].(string)
			if id == "" || name == "" {
				continue
			}
			if mime == "" {
				mime = MimeUnknownFile
			}
			entries = append(entries, webEntry{ID: id, Name: name, Mime: mime})
		}
	}
	return pageTitle(body), entries, nil
}

var (
	titleExpr   = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	ogTitleExpr = regexp.MustCompile(`(?is)<meta[^>]+property="og:title"[^>]+content="([^"]*)"`)
)

// pageTitle returns the page title without the " - Google Drive" suffix.
func pageTitle(body []byte) string {
	if m := ogTitleExpr.FindSubmatch(body); m != nil {
		if t := strings.TrimSpace(html.UnescapeString(string(m[1]))); t != "" {
			return t
		}
	}
	m := titleExpr.FindSubmatch(body)
	if m == nil {
		return ""
	}
	t := strings.TrimSpace(html.UnescapeString(string(m[1])))
	for _, suffix := range []string{" - Google Drive", " – Google Drive", " - Google Docs", " - Google Sheets", " - Google Slides"} {
		t = strings.TrimSuffix(t, suffix)
	}
	if t == "Google Drive" || t == "Meet Google Drive – One place for all your files" {
		return ""
	}
	return t
}

// jsUnescape decodes the body of a single-quoted JavaScript string literal.
func jsUnescape(s string) (string, error) {
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c != '\\' {
			b.WriteByte(c)
			continue
		}
		i++
		if i >= len(s) {
			return "", fmt.Errorf("dangling escape")
		}
		switch s[i] {
		case 'n':
			b.WriteByte('\n')
		case 't':
			b.WriteByte('\t')
		case 'r':
			b.WriteByte('\r')
		case 'b':
			b.WriteByte('\b')
		case 'f':
			b.WriteByte('\f')
		case 'v':
			b.WriteByte('\v')
		case '0':
			b.WriteByte(0)
		case '\n':
			// line continuation
		case 'x':
			if i+2 >= len(s) {
				return "", fmt.Errorf("short \\x escape")
			}
			v, err := strconv.ParseUint(s[i+1:i+3], 16, 8)
			if err != nil {
				return "", err
			}
			b.WriteRune(rune(v))
			i += 2
		case 'u':
			r, n, err := readJSUnicode(s[i+1:])
			if err != nil {
				return "", err
			}
			i += n
			if r >= 0xD800 && r < 0xDC00 && strings.HasPrefix(s[i+1:], `\u`) {
				if lo, n2, err := readJSUnicode(s[i+3:]); err == nil && lo >= 0xDC00 && lo < 0xE000 {
					r = (r-0xD800)<<10 + (lo - 0xDC00) + 0x10000
					i += 2 + n2
				}
			}
			b.WriteRune(r)
		default:
			b.WriteByte(s[i]) // \' \" \\ \/ and anything else stand for themselves
		}
	}
	return b.String(), nil
}

// readJSUnicode reads the part after "\u": XXXX or {X...}. It returns the
// code point and how many bytes it consumed.
func readJSUnicode(s string) (rune, int, error) {
	if strings.HasPrefix(s, "{") {
		end := strings.IndexByte(s, '}')
		if end < 0 {
			return 0, 0, fmt.Errorf("bad \\u{} escape")
		}
		v, err := strconv.ParseUint(s[1:end], 16, 32)
		return rune(v), end + 1, err
	}
	if len(s) < 4 {
		return 0, 0, fmt.Errorf("short \\u escape")
	}
	v, err := strconv.ParseUint(s[:4], 16, 16)
	return rune(v), 4, err
}

// webResolve finds out what an ID or file link points at, and its name, by
// following Drive's own redirects.
func (c *Client) webResolve(ctx context.Context, l Link) (*Item, error) {
	return withRetry(ctx, func() (*Item, error) {
		q := url.Values{"hl": {"en"}}
		if l.ResourceKey != "" {
			q.Set("resourcekey", l.ResourceKey)
		}
		var target string
		switch l.Kind {
		case LinkFolder:
			// The name comes with the folder listing.
			return &Item{ID: l.ID, ResourceKey: l.ResourceKey, MimeType: MimeFolder, Size: -1}, nil
		case LinkDoc:
			kind := docsKindForMime(l.Mime)
			target = c.DocsBase + "/" + kind + "/d/" + url.PathEscape(l.ID) + "/edit?" + q.Encode()
		case LinkFile:
			target = c.DriveBase + "/file/d/" + url.PathEscape(l.ID) + "/view?" + q.Encode()
		default:
			q.Set("id", l.ID)
			target = c.DriveBase + "/open?" + q.Encode()
		}
		body, resp, err := c.fetchPage(ctx, target)
		if err != nil {
			return nil, err
		}
		if err := checkPageResponse(resp); err != nil {
			return nil, err
		}
		final := resp.Request.URL
		it := &Item{ID: l.ID, ResourceKey: l.ResourceKey, Size: -1, MimeType: MimeUnknownFile}
		if e, ok := classifyHref(final.String(), nil); ok && e.ID == l.ID {
			it.MimeType = e.Mime
		} else if l.Kind == LinkDoc {
			it.MimeType = l.Mime
		}
		if it.IsFolder() {
			return it, nil
		}
		it.Name = pageTitle(body)
		if it.Name == "" {
			it.NameFromResponse = true
			it.Name = l.ID
		}
		return it, nil
	})
}

func docsKindForMime(mime string) string {
	switch mime {
	case MimeDocument:
		return "document"
	case MimeSpreadsheet:
		return "spreadsheets"
	case MimePresentation:
		return "presentation"
	case MimeDrawing:
		return "drawings"
	}
	return "document"
}
