package gdrive

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestParseLink(t *testing.T) {
	const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345"
	cases := []struct {
		in   string
		kind LinkKind
		mime string
		rk   string
	}{
		{"https://drive.google.com/drive/folders/" + id + "?usp=sharing", LinkFolder, "", ""},
		{"https://drive.google.com/drive/u/1/folders/" + id, LinkFolder, "", ""},
		{"drive.google.com/drive/mobile/folders/" + id + "?resourcekey=0-abc", LinkFolder, "", "0-abc"},
		{"https://drive.google.com/folderview?id=" + id, LinkFolder, "", ""},
		{"https://drive.google.com/file/d/" + id + "/view?usp=drive_link", LinkFile, "", ""},
		{"https://drive.google.com/file/u/0/d/" + id + "/edit", LinkFile, "", ""},
		{"https://drive.google.com/uc?export=download&id=" + id, LinkFile, "", ""},
		{"https://drive.usercontent.google.com/download?id=" + id + "&export=download", LinkFile, "", ""},
		{"https://drive.google.com/open?id=" + id, LinkUnknown, "", ""},
		{"https://docs.google.com/document/d/" + id + "/edit?usp=sharing", LinkDoc, MimeDocument, ""},
		{"https://docs.google.com/spreadsheets/d/" + id + "/edit#gid=0", LinkDoc, MimeSpreadsheet, ""},
		{"https://docs.google.com/presentation/d/" + id + "/edit", LinkDoc, MimePresentation, ""},
		{id, LinkUnknown, "", ""},
	}
	for _, c := range cases {
		l, err := ParseLink(c.in)
		if err != nil {
			t.Errorf("%s: %v", c.in, err)
			continue
		}
		if l.ID != id || l.Kind != c.kind || l.Mime != c.mime || l.ResourceKey != c.rk {
			t.Errorf("%s: got %+v", c.in, l)
		}
	}
	for _, bad := range []string{"https://example.com/x", "https://drive.google.com/drive/my-drive", "https://docs.google.com/forms/d/" + id + "/edit", "hello"} {
		if _, err := ParseLink(bad); err == nil {
			t.Errorf("%s: expected an error", bad)
		}
	}
	links, err := ParseLinks("https://drive.google.com/drive/folders/" + id + "\n  https://drive.google.com/file/d/" + id + "x/view ,https://drive.google.com/drive/folders/" + id)
	if err != nil || len(links) != 2 {
		t.Fatalf("ParseLinks: %v %+v", err, links)
	}
}

func TestSanitizeAndDedupe(t *testing.T) {
	cases := map[string]string{
		`a/b\c:d*e?f"g<h>i|j`: "a_b_c_d_e_f_g_h_i_j",
		"name. . ":            "name",
		"CON.txt":             "_CON.txt",
		"lpt1":                "_lpt1",
		"   ":                 "_",
		"ok.mp4":              "ok.mp4",
	}
	for in, want := range cases {
		if got := SanitizeName(in); got != want {
			t.Errorf("SanitizeName(%q) = %q, want %q", in, got, want)
		}
	}
	long := strings.Repeat("é", 300) + ".mp4"
	if got := SanitizeName(long); len(got) > maxNameBytes || !strings.HasSuffix(got, ".mp4") {
		t.Errorf("long name not shortened: %d bytes", len(got))
	}
	var d NameDeduper
	got := []string{d.Unique("a.txt", false), d.Unique("A.TXT", false), d.Unique("a.txt", false), d.Unique("dir.v2", true), d.Unique("dir.v2", true)}
	want := []string{"a.txt", "A (2).TXT", "a (3).txt", "dir.v2", "dir.v2 (2)"}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("Unique #%d = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestNaturalCompare(t *testing.T) {
	if naturalCompare("Lesson 2.mp4", "Lesson 10.mp4") >= 0 {
		t.Error("2 should sort before 10")
	}
	if naturalCompare("a", "B") >= 0 || naturalCompare("x10", "x010") != 0 {
		t.Error("case-insensitive / leading zeros")
	}
}

func TestJSUnescapeAndFolderPage(t *testing.T) {
	// The folder page embeds its items as a JSON array inside a JS string.
	js := `\x5b\x5b\x5b\x22id_file_000000001\x22,\x5b\x22parent\x22\x5d,\x22café – notes.pdf\x22,\x22application\/pdf\x22\x5d,` +
		`\x5b\x22id_folder_00000001\x22,\x5b\x22parent\x22\x5d,\x22Sub \\\x22q\\\x22\x22,\x22application\/vnd.google-apps.folder\x22\x5d\x5d\x5d`
	page := "<html><head><title>My Folder – Google Drive</title></head><body><script>window['_DRIVE_ivd'] = '" + js + "';if (window['_DRIVE_ivdc']) {}</script></body></html>"
	title, entries, err := parseFolderPage([]byte(page))
	if err != nil {
		t.Fatal(err)
	}
	if title != "My Folder" || len(entries) != 2 {
		t.Fatalf("title %q entries %+v", title, entries)
	}
	if entries[0].Name != "café – notes.pdf" || entries[1].Name != `Sub "q"` || entries[1].Mime != MimeFolder {
		t.Fatalf("entries %+v", entries)
	}
	if s, _ := jsUnescape(`😀\x41\/`); s != "😀A/" {
		t.Fatalf("surrogates: %q", s)
	}
}

const embeddedSample = `<!DOCTYPE html><html><head><title>Course &amp; Files</title></head><body>
<div class="flip-entries">
<div class="flip-entry" id="entry-1FileAAAAAAAAAAAAAAAAAAAAAAAAAAA" tabindex="0" role="link">
 <div class="flip-entry-info"><a href="https://drive.google.com/file/d/1FileAAAAAAAAAAAAAAAAAAAAAAAAAAA/view?usp=drive_web" target="_blank">
  <div class="flip-entry-list-icon"><img src="https://drive-thirdparty.googleusercontent.com/16/type/video/mp4" alt=""></div>
  <div class="flip-entry-title">Lesson 10.mp4</div></a></div>
 <div class="flip-entry-last-modified"><div>Jan 3, 2024</div></div></div>
<div class="flip-entry" id="entry-1FileBBBBBBBBBBBBBBBBBBBBBBBBBBB"><div class="flip-entry-info">
 <a href="https://drive.google.com/file/d/1FileBBBBBBBBBBBBBBBBBBBBBBBBBBB/view?usp=drive_web&amp;resourcekey=0-rk"><div class="flip-entry-title">Lesson 2.mp4</div></a></div></div>
<div class="flip-entry" id="entry-1DocCCCCCCCCCCCCCCCCCCCCCCCCCCCC"><div class="flip-entry-info">
 <a href="https://docs.google.com/document/d/1DocCCCCCCCCCCCCCCCCCCCCCCCCCCCC/edit?usp=drive_web"><div class="flip-entry-title">Notes</div></a></div></div>
<div class="flip-entry" id="entry-1FormDDDDDDDDDDDDDDDDDDDDDDDDDDD"><div class="flip-entry-info">
 <a href="https://docs.google.com/forms/d/1FormDDDDDDDDDDDDDDDDDDDDDDDDDDD/edit"><div class="flip-entry-title">Survey</div></a></div></div>
<div class="flip-entry" id="entry-1SubEEEEEEEEEEEEEEEEEEEEEEEEEEEE"><div class="flip-entry-info">
 <a href="https://drive.google.com/drive/folders/1SubEEEEEEEEEEEEEEEEEEEEEEEEEEEE"><div class="flip-entry-title">Module: 1</div></a></div></div>
</div><a href="https://www.google.com/">Google</a></body></html>`

func TestParseEmbeddedFolderView(t *testing.T) {
	title, entries, err := parseEmbeddedFolderView([]byte(embeddedSample), nil)
	if err != nil {
		t.Fatal(err)
	}
	if title != "Course & Files" {
		t.Errorf("title %q", title)
	}
	want := []webEntry{
		{"1FileAAAAAAAAAAAAAAAAAAAAAAAAAAA", "", "Lesson 10.mp4", MimeUnknownFile},
		{"1FileBBBBBBBBBBBBBBBBBBBBBBBBBBB", "0-rk", "Lesson 2.mp4", MimeUnknownFile},
		{"1DocCCCCCCCCCCCCCCCCCCCCCCCCCCCC", "", "Notes", MimeDocument},
		{"1FormDDDDDDDDDDDDDDDDDDDDDDDDDDD", "", "Survey", MimeForm},
		{"1SubEEEEEEEEEEEEEEEEEEEEEEEEEEEE", "", "Module: 1", MimeFolder},
	}
	if len(entries) != len(want) {
		t.Fatalf("got %d entries: %+v", len(entries), entries)
	}
	for i := range want {
		if entries[i] != want[i] {
			t.Errorf("entry %d = %+v, want %+v", i, entries[i], want[i])
		}
	}
}

func TestConfirmPage(t *testing.T) {
	page := `<!DOCTYPE html><html><head><title>Google Drive - Virus scan warning</title></head><body>
<p class="uc-warning-subcaption">Google Drive can't scan this file for viruses.</p>
<form id="download-form" action="https://drive.usercontent.google.com/download" method="get">
<input type="submit" id="uc-download-link" class="goog-inline-block jfk-button jfk-button-action" value="Download anyway"/>
<input type="hidden" name="id" value="1BigFile"><input type="hidden" name="export" value="download">
<input type="hidden" name="confirm" value="t"><input type="hidden" name="uuid" value="abc-123"></form></body></html>`
	link, msg := parseConfirmPage([]byte(page), nil)
	u, _ := url.Parse(link)
	if msg != "" || u.Host != "drive.usercontent.google.com" || u.Query().Get("uuid") != "abc-123" || u.Query().Get("id") != "1BigFile" {
		t.Fatalf("link %q msg %q", link, msg)
	}
	_, msg = parseConfirmPage([]byte(`<p class="uc-error-subcaption">Sorry, you can&#39;t view or download this file at this time.</p>`), nil)
	if msg != "Sorry, you can't view or download this file at this time." {
		t.Fatalf("msg %q", msg)
	}
	if fn := filenameFrom(`attachment; filename="Lesson 1.mp4"; filename*=UTF-8''Lesson%201.mp4`); fn != "Lesson 1.mp4" {
		t.Fatalf("filename %q", fn)
	}
}

// fakeDrive serves a tiny public Drive: a root folder with a subfolder, two
// files that share a name, a Google Doc and a Form.
type fakeDrive struct {
	files map[string][]byte
	// bigID needs the virus-scan confirmation; quotaID always hits the quota.
	bigID, quotaID string
	rangeIgnored   bool
	hits           map[string]int
}

func newFakeDrive(t *testing.T) (*fakeDrive, *Client) {
	fd := &fakeDrive{
		files: map[string][]byte{
			"fileA0000000000000000000000000001": []byte("first copy"),
			"fileA0000000000000000000000000002": []byte("second copy"),
			"fileB0000000000000000000000000003": []byte(strings.Repeat("0123456789", 1000)),
		},
		bigID:   "fileB0000000000000000000000000003",
		quotaID: "fileQ0000000000000000000000000004",
		hits:    map[string]int{},
	}
	folders := map[string]string{
		"root00000000000000000000000000000": `<title>Root: Folder</title>
<a href="https://drive.google.com/file/d/fileA0000000000000000000000000002/view">same.txt</a>
<a href="https://drive.google.com/file/d/fileA0000000000000000000000000001/view">same.txt</a>
<a href="https://docs.google.com/document/d/doc00000000000000000000000000005/edit">Notes</a>
<a href="https://docs.google.com/forms/d/form0000000000000000000000000006/edit">Survey</a>
<a href="https://drive.google.com/drive/folders/sub000000000000000000000000000007">Sub</a>`,
		"sub000000000000000000000000000007": `<title>Sub</title>
<a href="https://drive.google.com/file/d/fileB0000000000000000000000000003/view">Lesson 10.bin</a>
<a href="https://drive.google.com/file/d/fileQ0000000000000000000000000004/view">popular.zip</a>`,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/embeddedfolderview", func(w http.ResponseWriter, r *http.Request) {
		body, ok := folders[r.URL.Query().Get("id")]
		if !ok {
			http.Redirect(w, r, "/ServiceLogin", http.StatusFound)
			return
		}
		fmt.Fprint(w, "<html><head>"+body+"</body></html>")
	})
	mux.HandleFunc("/ServiceLogin", func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "<title>Sign in</title>") })
	mux.HandleFunc("/file/d/", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<html><head><meta property="og:title" content="single.bin"><title>single.bin - Google Drive</title></head></html>`)
	})
	mux.HandleFunc("/download", func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Query().Get("id")
		fd.hits[id]++
		if id == fd.quotaID {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			fmt.Fprint(w, `<p class="uc-error-subcaption">Too many users have viewed or downloaded this file recently.</p>`)
			return
		}
		if id == fd.bigID && r.URL.Query().Get("uuid") == "" {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			fmt.Fprintf(w, `<form id="download-form" action="/download" method="get"><input type="hidden" name="id" value="%s"><input type="hidden" name="export" value="download"><input type="hidden" name="confirm" value="t"><input type="hidden" name="uuid" value="u-1"></form>`, id)
			return
		}
		data, ok := fd.files[id]
		if !ok {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", `attachment; filename="server-name.bin"`)
		if rg := r.Header.Get("Range"); rg != "" && !fd.rangeIgnored {
			start, _ := strconv.Atoi(strings.TrimSuffix(strings.TrimPrefix(rg, "bytes="), "-"))
			w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, len(data)-1, len(data)))
			w.Header().Set("Content-Length", strconv.Itoa(len(data)-start))
			w.WriteHeader(http.StatusPartialContent)
			w.Write(data[start:])
			return
		}
		w.Header().Set("Content-Length", strconv.Itoa(len(data)))
		w.Write(data)
	})
	mux.HandleFunc("/document/d/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Disposition", `attachment; filename="Notes.docx"`)
		fmt.Fprint(w, "DOCX:"+r.URL.Query().Get("format"))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	c := NewClient("")
	c.DriveBase, c.UserContentBase, c.DocsBase = srv.URL, srv.URL, srv.URL
	return fd, c
}

func TestScanWeb(t *testing.T) {
	_, c := newFakeDrive(t)
	links, _ := ParseLinks("https://drive.google.com/drive/folders/root00000000000000000000000000000")
	var last ScanProgress
	res, err := c.Scan(context.Background(), links, DocsOffice, func(p ScanProgress) { last = p })
	if err != nil {
		t.Fatal(err)
	}
	var paths []string
	for _, n := range res.Nodes {
		paths = append(paths, filepath.ToSlash(n.RelPath))
	}
	want := []string{
		"Root_ Folder",
		"Root_ Folder/Sub",
		"Root_ Folder/Sub/Lesson 10.bin",
		"Root_ Folder/Sub/popular.zip",
		"Root_ Folder/Notes.docx",
		"Root_ Folder/same.txt",
		"Root_ Folder/same (2).txt",
		"Root_ Folder/Survey",
	}
	if strings.Join(paths, "|") != strings.Join(want, "|") {
		t.Fatalf("paths:\n%s\nwant:\n%s", strings.Join(paths, "\n"), strings.Join(want, "\n"))
	}
	// The ID decides which duplicate gets the suffix, so re-scans agree.
	if res.Nodes[5].ID != "fileA0000000000000000000000000001" {
		t.Errorf("dedupe order not stable: %s", res.Nodes[5].ID)
	}
	if res.Nodes[7].NoDownload == "" || res.Nodes[4].Export == nil {
		t.Errorf("form/doc handling: %+v %+v", res.Nodes[7], res.Nodes[4])
	}
	if res.Title != "Root_ Folder" || last.Folders != 2 || last.Files != 6 {
		t.Errorf("title %q progress %+v", res.Title, last)
	}

	if _, err := c.Scan(context.Background(), []Link{{ID: "private000000000000000000000000000", Kind: LinkFolder}}, DocsOffice, nil); KindOf(err) != ErrNoAccess {
		t.Errorf("private folder: %v", err)
	}
}

func TestOpenWeb(t *testing.T) {
	fd, c := newFakeDrive(t)
	ctx := context.Background()
	read := func(n *Node, off int64) (*Stream, string) {
		s, err := c.Open(ctx, n, off)
		if err != nil {
			t.Fatalf("%s: %v", n.ID, err)
		}
		b, _ := io.ReadAll(s.Body)
		s.Body.Close()
		return s, string(b)
	}

	big := &Node{Item: Item{ID: fd.bigID}}
	s, body := read(big, 0)
	if body != string(fd.files[fd.bigID]) || s.Total != 10000 || s.Offset != 0 || s.Filename != "server-name.bin" {
		t.Fatalf("confirm flow: total %d offset %d len %d", s.Total, s.Offset, len(body))
	}
	s, body = read(big, 9990)
	if body != "0123456789" || s.Offset != 9990 || s.Total != 10000 {
		t.Fatalf("resume: %q offset %d total %d", body, s.Offset, s.Total)
	}
	fd.rangeIgnored = true
	s, body = read(big, 9990)
	if s.Offset != 0 || len(body) != 10000 {
		t.Fatalf("ignored range must restart: offset %d len %d", s.Offset, len(body))
	}

	_, body = read(&Node{Item: Item{ID: "doc00000000000000000000000000005", MimeType: MimeDocument}, Export: &Export{Format: "docx", WebPath: "document"}}, 0)
	if body != "DOCX:docx" {
		t.Fatalf("export: %q", body)
	}

	if _, err := c.Open(ctx, &Node{Item: Item{ID: fd.quotaID}}, 0); KindOf(err) != ErrQuota {
		t.Fatalf("quota: %v", err)
	}
	if _, err := c.Open(ctx, &Node{Item: Item{ID: "missing00000000000000000000000000"}}, 0); KindOf(err) != ErrNotFound {
		t.Fatalf("missing: %v", err)
	}
	if _, err := c.Open(ctx, &Node{NoDownload: "Google Forms can't be downloaded"}, 0); KindOf(err) != ErrNotDownloadable {
		t.Fatalf("form: %v", err)
	}
}

func TestScanAndOpenAPI(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/files/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("key") != "good" {
			w.WriteHeader(400)
			fmt.Fprint(w, `{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","errors":[{"reason":"badRequest"}],"status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}`)
			return
		}
		id := strings.TrimPrefix(r.URL.Path, "/files/")
		switch {
		case id == "rootAPI000000000000000000000000000":
			fmt.Fprint(w, `{"id":"rootAPI000000000000000000000000000","name":"API Root","mimeType":"application/vnd.google-apps.folder"}`)
		case id == "big0000000000000000000000000000000" && r.URL.Query().Get("alt") == "media":
			if r.Header.Get("X-Goog-Drive-Resource-Keys") != "big0000000000000000000000000000000/0-key" {
				w.WriteHeader(404)
				fmt.Fprint(w, `{"error":{"code":404,"errors":[{"reason":"notFound"}]}}`)
				return
			}
			w.Header().Set("Content-Range", "bytes 5-9/10")
			w.WriteHeader(206)
			fmt.Fprint(w, "56789")
		case id == "quota00000000000000000000000000000":
			w.WriteHeader(403)
			fmt.Fprint(w, `{"error":{"code":403,"message":"The download quota for this file has been exceeded.","errors":[{"reason":"downloadQuotaExceeded"}]}}`)
		default:
			w.WriteHeader(404)
			fmt.Fprint(w, `{"error":{"code":404,"message":"File not found","errors":[{"reason":"notFound"}]}}`)
		}
	})
	mux.HandleFunc("/files", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query().Get("q")
		switch {
		case strings.Contains(q, "rootAPI") && r.URL.Query().Get("pageToken") == "":
			fmt.Fprint(w, `{"nextPageToken":"p2","files":[{"id":"big0000000000000000000000000000000","name":"video.mp4","mimeType":"video/mp4","size":"10","resourceKey":"0-key"}]}`)
		case strings.Contains(q, "rootAPI"):
			fmt.Fprint(w, `{"files":[{"id":"sheet00000000000000000000000000000","name":"Budget","mimeType":"application/vnd.google-apps.spreadsheet"}]}`)
		default:
			fmt.Fprint(w, `{"files":[]}`)
		}
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	c := NewClient("good")
	c.APIBase = srv.URL
	if err := c.TestKey(context.Background()); err != nil {
		t.Fatalf("good key: %v", err)
	}
	res, err := c.Scan(context.Background(), []Link{{ID: "rootAPI000000000000000000000000000", Kind: LinkFolder}}, DocsPDF, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Nodes) != 3 || res.Nodes[1].Name != "Budget.pdf" || res.Nodes[2].Size != 10 || !res.UsingAPI {
		t.Fatalf("nodes: %+v %+v", res.Nodes[1], res.Nodes[2])
	}
	s, err := c.Open(context.Background(), res.Nodes[2], 5)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(s.Body)
	if string(b) != "56789" || s.Offset != 5 || s.Total != 10 {
		t.Fatalf("api range: %q %d %d", b, s.Offset, s.Total)
	}
	if _, err := c.Open(context.Background(), &Node{Item: Item{ID: "quota00000000000000000000000000000"}}, 0); KindOf(err) != ErrQuota {
		t.Fatalf("quota: %v", err)
	}

	bad := NewClient("nope")
	bad.APIBase = srv.URL
	if err := bad.TestKey(context.Background()); KindOf(err) != ErrBadKey {
		t.Fatalf("bad key: %v", err)
	}
}
