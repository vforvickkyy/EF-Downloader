package gdrive

import (
	"bytes"
	"context"
	"io"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/net/html"
)

// Stream is an open download.
type Stream struct {
	Body     io.ReadCloser
	Offset   int64  // where Body starts in the file: the requested offset, or 0 if the server ignored it
	Total    int64  // full file size, -1 when unknown
	Filename string // from Content-Disposition, "" when absent
}

// Open starts downloading n from byte offset. Google Docs are exported and
// always start at 0.
func (c *Client) Open(ctx context.Context, n *Node, offset int64) (*Stream, error) {
	if n.NoDownload != "" {
		return nil, newErr(ErrNotDownloadable, 0, "%s", n.NoDownload)
	}
	if n.Export != nil {
		if c.HasAPIKey() {
			q := url.Values{"mimeType": {n.Export.Mime}}
			s, err := c.openAPI(ctx, "/files/"+url.PathEscape(n.ID)+"/export", q, n, 0)
			if err == nil || ctx.Err() != nil || KindOf(err) == ErrQuota {
				return s, err
			}
			// The API can't export files over 10 MB; docs.google.com can.
		}
		return c.openWebExport(ctx, n)
	}
	if c.HasAPIKey() {
		s, err := c.openAPI(ctx, "/files/"+url.PathEscape(n.ID), url.Values{"alt": {"media"}}, n, offset)
		if err == nil || ctx.Err() != nil {
			return s, err
		}
		switch KindOf(err) {
		case ErrQuota, ErrRange, ErrTransient, ErrNotFound:
			return s, err
		}
		// Bad key or a refusal specific to the API: the public download
		// link may still work.
	}
	return c.openWeb(ctx, n, offset)
}

func (c *Client) openAPI(ctx context.Context, path string, q url.Values, n *Node, offset int64) (*Stream, error) {
	req, err := c.apiRequest(ctx, path, q, n.ID, n.ResourceKey)
	if err != nil {
		return nil, err
	}
	setDownloadHeaders(req, offset)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		resp.Body.Close()
		if resp.StatusCode == http.StatusRequestedRangeNotSatisfiable {
			return nil, statusErr(resp.StatusCode)
		}
		return nil, apiErr(resp.StatusCode, body)
	}
	return streamFrom(resp, offset)
}

func setDownloadHeaders(req *http.Request, offset int64) {
	// Ask for the raw bytes so Content-Length and Range line up with the file.
	req.Header.Set("Accept-Encoding", "identity")
	if offset > 0 {
		req.Header.Set("Range", "bytes="+strconv.FormatInt(offset, 10)+"-")
	}
}

var contentRangeExpr = regexp.MustCompile(`^bytes (\d+)-(\d+)/(\d+|\*)$`)

// streamFrom checks a successful response and works out where it starts.
func streamFrom(resp *http.Response, offset int64) (*Stream, error) {
	s := &Stream{Body: resp.Body, Total: -1, Filename: filenameFrom(resp.Header.Get("Content-Disposition"))}
	identity := resp.Header.Get("Content-Encoding") == "" || strings.EqualFold(resp.Header.Get("Content-Encoding"), "identity")
	if resp.StatusCode == http.StatusPartialContent {
		m := contentRangeExpr.FindStringSubmatch(resp.Header.Get("Content-Range"))
		start, _ := strconv.ParseInt(safeIdx(m, 1), 10, 64)
		if m == nil || start != offset || !identity {
			resp.Body.Close()
			return nil, newErr(ErrRange, resp.StatusCode, "Server answered with the wrong part of the file")
		}
		s.Offset = start
		if total, err := strconv.ParseInt(m[3], 10, 64); err == nil {
			s.Total = total
		}
		return s, nil
	}
	s.Offset = 0
	if identity && resp.ContentLength >= 0 {
		s.Total = resp.ContentLength
	}
	return s, nil
}

func safeIdx(m []string, i int) string {
	if i < len(m) {
		return m[i]
	}
	return ""
}

func filenameFrom(cd string) string {
	if cd == "" {
		return ""
	}
	if _, params, err := mime.ParseMediaType(cd); err == nil && params["filename"] != "" {
		return params["filename"]
	}
	// Google sometimes sends both filename="..." and a filename*= that the
	// strict parser rejects.
	if i := strings.Index(cd, "filename*=UTF-8''"); i >= 0 {
		v := cd[i+len("filename*=UTF-8''"):]
		if j := strings.IndexByte(v, ';'); j >= 0 {
			v = v[:j]
		}
		if u, err := url.PathUnescape(strings.TrimSpace(v)); err == nil {
			return u
		}
	}
	if m := regexp.MustCompile(`filename="([^"]*)"`).FindStringSubmatch(cd); m != nil {
		return m[1]
	}
	return ""
}

// openWeb downloads through the public download link, getting past the
// "can't scan this file for viruses" page Google shows for big files.
func (c *Client) openWeb(ctx context.Context, n *Node, offset int64) (*Stream, error) {
	q := url.Values{"id": {n.ID}, "export": {"download"}, "confirm": {"t"}}
	if n.ResourceKey != "" {
		q.Set("resourcekey", n.ResourceKey)
	}
	next := c.UserContentBase + "/download?" + q.Encode()
	triedUC := false
	for hop := 0; hop < 5; hop++ {
		req, err := c.newRequest(ctx, next)
		if err != nil {
			return nil, err
		}
		setDownloadHeaders(req, offset)
		resp, err := c.http.Do(req)
		if err != nil {
			return nil, err
		}
		if isSignInURL(resp.Request.URL) {
			resp.Body.Close()
			return nil, errNoAccess(resp.StatusCode)
		}
		isHTML := strings.HasPrefix(resp.Header.Get("Content-Type"), "text/html") && resp.Header.Get("Content-Disposition") == ""
		if !isHTML && (resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusPartialContent) {
			return streamFrom(resp, offset)
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		resp.Body.Close()
		if !isHTML {
			return nil, statusErr(resp.StatusCode)
		}
		link, errMsg := parseConfirmPage(body, resp.Request.URL)
		switch {
		case link != "":
			next = link
		case quotaPage(body):
			return nil, errQuota(resp.StatusCode)
		case errMsg != "":
			return nil, newErr(ErrNoAccess, resp.StatusCode, "Google: %s", errMsg)
		case resp.StatusCode == http.StatusNotFound:
			return nil, errNotFound(resp.StatusCode)
		case !triedUC:
			// Older style link; Google redirects it wherever is current.
			triedUC = true
			next = c.DriveBase + "/uc?export=download&id=" + url.QueryEscape(n.ID)
			if n.ResourceKey != "" {
				next += "&resourcekey=" + url.QueryEscape(n.ResourceKey)
			}
		case resp.StatusCode >= 500 || resp.StatusCode == 429:
			return nil, statusErr(resp.StatusCode)
		default:
			return nil, newErr(ErrNoAccess, resp.StatusCode, "Google didn't allow the download. Check the file is shared as \"Anyone with the link\".")
		}
	}
	return nil, newErr(ErrParse, 0, "Couldn't get past Google's download confirmation page")
}

func quotaPage(body []byte) bool {
	b := bytes.ToLower(body)
	return bytes.Contains(b, []byte("too many users have viewed or downloaded this file")) ||
		bytes.Contains(b, []byte("download quota")) ||
		bytes.Contains(b, []byte("quota exceeded"))
}

var (
	ucHrefExpr       = regexp.MustCompile(`href="(/uc\?export=download[^"]+)"`)
	downloadURLExpr  = regexp.MustCompile(`"downloadUrl":"([^"]+)"`)
	ucErrorExpr      = regexp.MustCompile(`(?s)<p class="uc-error-subcaption">(.*?)</p>`)
	stripTagsExpr    = regexp.MustCompile(`<[^>]+>`)
	downloadFormName = "download-form"
)

// parseConfirmPage finds the real download link on Google's confirmation
// page, or the error it shows instead.
func parseConfirmPage(body []byte, base *url.URL) (link, errMsg string) {
	if l := parseDownloadForm(body, base); l != "" {
		return l, ""
	}
	if m := ucHrefExpr.FindSubmatch(body); m != nil {
		u, err := url.Parse(html.UnescapeString(string(m[1])))
		if err == nil {
			if base == nil {
				base, _ = url.Parse("https://drive.google.com/")
			}
			return base.ResolveReference(u).String(), ""
		}
	}
	if m := downloadURLExpr.FindSubmatch(body); m != nil {
		if s, err := jsUnescape(string(m[1])); err == nil {
			return s, ""
		}
	}
	if m := ucErrorExpr.FindSubmatch(body); m != nil {
		msg := strings.TrimSpace(html.UnescapeString(stripTagsExpr.ReplaceAllString(string(m[1]), "")))
		return "", msg
	}
	return "", ""
}

// parseDownloadForm builds the URL that <form id="download-form"> submits.
func parseDownloadForm(body []byte, base *url.URL) string {
	z := html.NewTokenizer(bytes.NewReader(body))
	var (
		inForm bool
		action string
		params = url.Values{}
	)
	for {
		tt := z.Next()
		switch tt {
		case html.ErrorToken:
			return ""
		case html.StartTagToken, html.SelfClosingTagToken:
			tag, hasAttr := z.TagName()
			attrs := map[string]string{}
			for hasAttr {
				var k, v []byte
				k, v, hasAttr = z.TagAttr()
				attrs[string(k)] = string(v)
			}
			switch string(tag) {
			case "form":
				if attrs["id"] == downloadFormName {
					inForm = true
					action = attrs["action"]
				}
			case "input":
				if inForm && attrs["name"] != "" && (attrs["type"] == "hidden" || attrs["type"] == "") {
					params.Set(attrs["name"], attrs["value"])
				}
			}
		case html.EndTagToken:
			tag, _ := z.TagName()
			if string(tag) == "form" && inForm {
				u, err := url.Parse(action)
				if err != nil || action == "" {
					return ""
				}
				if base != nil {
					u = base.ResolveReference(u)
				}
				q := u.Query()
				for k, v := range params {
					q[k] = v
				}
				u.RawQuery = q.Encode()
				return u.String()
			}
		}
	}
}

// openWebExport converts a Google Doc through docs.google.com.
func (c *Client) openWebExport(ctx context.Context, n *Node) (*Stream, error) {
	e := n.Export
	var target string
	if e.WebPath == "drawings" {
		target = c.DocsBase + "/drawings/d/" + url.PathEscape(n.ID) + "/export/" + e.Format
	} else {
		target = c.DocsBase + "/" + e.WebPath + "/d/" + url.PathEscape(n.ID) + "/export?format=" + e.Format
	}
	if n.ResourceKey != "" {
		if strings.Contains(target, "?") {
			target += "&"
		} else {
			target += "?"
		}
		target += "resourcekey=" + url.QueryEscape(n.ResourceKey)
	}
	req, err := c.newRequest(ctx, target)
	if err != nil {
		return nil, err
	}
	setDownloadHeaders(req, 0)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	if isSignInURL(resp.Request.URL) {
		resp.Body.Close()
		return nil, errNoAccess(resp.StatusCode)
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, statusErr(resp.StatusCode)
	}
	if strings.HasPrefix(resp.Header.Get("Content-Type"), "text/html") && resp.Header.Get("Content-Disposition") == "" {
		resp.Body.Close()
		return nil, newErr(ErrNoAccess, resp.StatusCode, "Google didn't allow exporting this document. Check it is shared as \"Anyone with the link\".")
	}
	return streamFrom(resp, 0)
}
