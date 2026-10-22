package gdrive

import (
	"fmt"
	"net/url"
	"regexp"
	"strings"
)

// LinkKind is what a pasted link points at, as far as the URL alone tells.
type LinkKind int

const (
	LinkUnknown LinkKind = iota // bare ID or open?id= link: resolved while scanning
	LinkFolder
	LinkFile
	LinkDoc // Google Docs / Sheets / Slides / Drawings
)

// Link is a parsed Google Drive link.
type Link struct {
	Raw         string
	ID          string
	ResourceKey string
	Kind        LinkKind
	Mime        string // set for LinkDoc
}

var (
	idPattern      = regexp.MustCompile(`^[-\w]{10,}$`)
	folderPath     = regexp.MustCompile(`^/drive/(?:u/\d+/)?(?:mobile/)?folders/([-\w]+)`)
	filePath       = regexp.MustCompile(`^/file/(?:u/\d+/)?d/([-\w]+)`)
	docsPath       = regexp.MustCompile(`^/(document|spreadsheets|presentation|drawings|forms)/(?:u/\d+/)?d/(e/)?([-\w]+)`)
	splitLinksExpr = regexp.MustCompile(`[\s,;]+`)
)

// ParseLinks splits user input (one or more links separated by spaces or new
// lines) into links. It returns the links it understood, de-duplicated, and
// an error describing the first one it did not.
func ParseLinks(input string) ([]Link, error) {
	var links []Link
	seen := map[string]bool{}
	var firstErr error
	for _, part := range splitLinksExpr.Split(input, -1) {
		part = strings.Trim(part, "<>\"'()[]")
		if part == "" {
			continue
		}
		l, err := ParseLink(part)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if seen[l.ID] {
			continue
		}
		seen[l.ID] = true
		links = append(links, l)
	}
	if len(links) == 0 && firstErr == nil {
		firstErr = fmt.Errorf("paste a Google Drive folder or file link")
	}
	return links, firstErr
}

// ParseLink understands every common shape of Drive link:
// folders, file views, uc/download links, open?id=, Docs/Sheets/Slides, and
// bare IDs.
func ParseLink(s string) (Link, error) {
	s = strings.TrimSpace(s)
	l := Link{Raw: s}
	if idPattern.MatchString(s) {
		l.ID, l.Kind = s, LinkUnknown
		return l, nil
	}
	if !strings.Contains(s, "://") {
		s = "https://" + s
	}
	u, err := url.Parse(s)
	if err != nil {
		return l, fmt.Errorf("not a valid link: %s", l.Raw)
	}
	host := strings.ToLower(strings.TrimPrefix(u.Hostname(), "www."))
	q := u.Query()
	l.ResourceKey = q.Get("resourcekey")

	switch host {
	case "drive.google.com", "drive.usercontent.google.com":
		if m := folderPath.FindStringSubmatch(u.Path); m != nil {
			l.ID, l.Kind = m[1], LinkFolder
		} else if m := filePath.FindStringSubmatch(u.Path); m != nil {
			l.ID, l.Kind = m[1], LinkFile
		} else {
			switch strings.TrimSuffix(u.Path, "/") {
			case "/folderview", "/embeddedfolderview":
				l.ID, l.Kind = q.Get("id"), LinkFolder
			case "/uc", "/download":
				l.ID, l.Kind = q.Get("id"), LinkFile
			case "/open", "":
				l.ID, l.Kind = q.Get("id"), LinkUnknown
			}
		}
	case "docs.google.com":
		if m := docsPath.FindStringSubmatch(u.Path); m != nil {
			if m[2] != "" {
				return l, fmt.Errorf("\"published to the web\" links are not supported; use the normal share link instead")
			}
			if m[1] == "forms" {
				return l, fmt.Errorf("Google Forms can't be downloaded")
			}
			l.ID, l.Kind, l.Mime = m[3], LinkDoc, mimeForDocsPath(m[1])
		} else if strings.TrimSuffix(u.Path, "/") == "/uc" || u.Path == "/open" {
			l.ID, l.Kind = q.Get("id"), LinkUnknown
		}
	default:
		return l, fmt.Errorf("not a Google Drive link: %s", l.Raw)
	}
	if !idPattern.MatchString(l.ID) {
		return l, fmt.Errorf("couldn't find a file or folder ID in: %s", l.Raw)
	}
	return l, nil
}
