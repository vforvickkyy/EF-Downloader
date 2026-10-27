package engine

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"eastape/internal/gdrive"
)

// server is a fake public Drive folder:
//
//	Course/
//	  a.bin (300 KB)
//	  Week 1/b.bin (200 KB), flaky.bin (fails once with 500)
//	  Empty/
//	  popular.zip (quota exceeded)
type server struct {
	mu       sync.Mutex
	files    map[string][]byte
	hits     map[string]int
	ranges   map[string][]string
	failOnce map[string]bool
	slow     time.Duration // pause after each 16 KB written
}

func newServer(t *testing.T) (*server, *gdrive.Client) {
	s := &server{
		files: map[string][]byte{
			"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1": bytes.Repeat([]byte("a"), 300<<10),
			"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2": bytes.Repeat([]byte("b"), 200<<10),
			"flakyyyyyyyyyyyyyyyyyyyyyyyyyyyy3": []byte("eventually fine"),
		},
		hits:     map[string]int{},
		ranges:   map[string][]string{},
		failOnce: map[string]bool{"flakyyyyyyyyyyyyyyyyyyyyyyyyyyyy3": true},
	}
	folders := map[string]string{
		"course0000000000000000000000000000": `<title>Course</title>
<a href="https://drive.google.com/file/d/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1/view">a.bin</a>
<a href="https://drive.google.com/file/d/quotaaaaaaaaaaaaaaaaaaaaaaaaaaa4/view">popular.zip</a>
<a href="https://drive.google.com/drive/folders/week10000000000000000000000000000">Week 1</a>
<a href="https://drive.google.com/drive/folders/empty0000000000000000000000000000">Empty</a>`,
		"week10000000000000000000000000000": `<title>Week 1</title>
<a href="https://drive.google.com/file/d/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2/view">b.bin</a>
<a href="https://drive.google.com/file/d/flakyyyyyyyyyyyyyyyyyyyyyyyyyyyy3/view">flaky.bin</a>`,
		"empty0000000000000000000000000000": `<title>Empty</title>`,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/embeddedfolderview", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "<html><head>"+folders[r.URL.Query().Get("id")]+"</body></html>")
	})
	mux.HandleFunc("/download", func(w http.ResponseWriter, r *http.Request) {
		id := r.URL.Query().Get("id")
		s.mu.Lock()
		s.hits[id]++
		s.ranges[id] = append(s.ranges[id], r.Header.Get("Range"))
		fail := s.failOnce[id]
		delete(s.failOnce, id)
		data, ok := s.files[id]
		slow := s.slow
		s.mu.Unlock()
		if strings.HasPrefix(id, "quota") {
			w.Header().Set("Content-Type", "text/html")
			fmt.Fprint(w, "<p class=\"uc-error-subcaption\">Too many users have viewed or downloaded this file recently.</p>")
			return
		}
		if fail {
			http.Error(w, "boom", 500)
			return
		}
		if !ok {
			http.NotFound(w, r)
			return
		}
		start := 0
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", `attachment; filename="x"`)
		if rg := r.Header.Get("Range"); rg != "" {
			start, _ = strconv.Atoi(strings.TrimSuffix(strings.TrimPrefix(rg, "bytes="), "-"))
			w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, len(data)-1, len(data)))
			w.Header().Set("Content-Length", strconv.Itoa(len(data)-start))
			w.WriteHeader(206)
		} else {
			w.Header().Set("Content-Length", strconv.Itoa(len(data)))
		}
		for p := start; p < len(data); p += 16 << 10 {
			end := min(p+16<<10, len(data))
			if _, err := w.Write(data[p:end]); err != nil {
				return
			}
			w.(http.Flusher).Flush()
			if slow > 0 {
				select {
				case <-time.After(slow):
				case <-r.Context().Done():
					return
				}
			}
		}
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	c := gdrive.NewClient("")
	c.DriveBase, c.UserContentBase, c.DocsBase = srv.URL, srv.URL, srv.URL
	return s, c
}

type recorder struct {
	mu       sync.Mutex
	finished chan Counts
	ticks    []Tick
}

func (r *recorder) emit(ev string, data any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	switch ev {
	case "job:tick":
		r.ticks = append(r.ticks, data.(Tick))
	case "job:finished":
		r.finished <- data.(Counts)
	}
}

func setup(t *testing.T) (*server, *Manager, *recorder, string) {
	srv, client := newServer(t)
	links, _ := gdrive.ParseLinks("https://drive.google.com/drive/folders/course0000000000000000000000000000")
	res, err := client.Scan(context.Background(), links, gdrive.DocsOffice, nil)
	if err != nil {
		t.Fatal(err)
	}
	rec := &recorder{finished: make(chan Counts, 4)}
	m := NewManager(rec.emit)
	m.SetClient(client)
	if err := m.Load(res); err != nil {
		t.Fatal(err)
	}
	return srv, m, rec, t.TempDir()
}

func waitFinished(t *testing.T, rec *recorder) Counts {
	t.Helper()
	select {
	case c := <-rec.finished:
		return c
	case <-time.After(30 * time.Second):
		t.Fatal("job did not finish")
	}
	return Counts{}
}

func TestFullRun(t *testing.T) {
	srv, m, rec, dir := setup(t)
	if err := m.Start(Options{Dir: dir, Parallel: 3, Retries: 2}, nil); err != nil {
		t.Fatal(err)
	}
	c := waitFinished(t, rec)
	if c.Done != 3 || c.Failed != 1 || c.Total != 4 {
		t.Fatalf("counts %+v", c)
	}
	if s := m.Summary(); s.Files != c || s.State != StateDone || s.Elapsed <= 0 || s.Parallel != 3 {
		t.Fatalf("summary %+v, counts %+v", s, c)
	}
	if got := m.Transferred(); got < (300+200)<<10 {
		t.Fatalf("transferred %d bytes", got)
	}
	for path, size := range map[string]int{"Course/a.bin": 300 << 10, "Course/Week 1/b.bin": 200 << 10, "Course/Week 1/flaky.bin": 15} {
		fi, err := os.Stat(filepath.Join(dir, filepath.FromSlash(path)))
		if err != nil || fi.Size() != int64(size) {
			t.Errorf("%s: %v size %v", path, err, fi)
		}
	}
	if fi, err := os.Stat(filepath.Join(dir, "Course", "Empty")); err != nil || !fi.IsDir() {
		t.Errorf("empty folder not created: %v", err)
	}
	if srv.hits["quotaaaaaaaaaaaaaaaaaaaaaaaaaaa4"] != 1 {
		t.Errorf("quota errors must not be retried: %d hits", srv.hits["quotaaaaaaaaaaaaaaaaaaaaaaaaaaa4"])
	}
	if srv.hits["flakyyyyyyyyyyyyyyyyyyyyyyyyyyyy3"] != 2 {
		t.Errorf("flaky file should be retried once: %d hits", srv.hits["flakyyyyyyyyyyyyyyyyyyyyyyyyyyyy3"])
	}
	matches, _ := filepath.Glob(filepath.Join(dir, "Course", "*.part"))
	if len(matches) != 0 {
		t.Errorf("leftover part files: %v", matches)
	}

	// A second run skips everything already on disk.
	before := srv.hits["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1"]
	if err := m.Load(mustRescan(t, m)); err != nil {
		t.Fatal(err)
	}
	if err := m.Start(Options{Dir: dir, Parallel: 3}, nil); err != nil {
		t.Fatal(err)
	}
	c = waitFinished(t, rec)
	if c.Skipped != 3 || srv.hits["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1"] != before {
		t.Fatalf("rerun should skip existing files: %+v", c)
	}
}

func mustRescan(t *testing.T, m *Manager) *gdrive.Result {
	links, _ := gdrive.ParseLinks("https://drive.google.com/drive/folders/course0000000000000000000000000000")
	res, err := m.client.Scan(context.Background(), links, gdrive.DocsOffice, nil)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestSpeedLimit(t *testing.T) {
	_, m, rec, dir := setup(t)
	// a.bin + b.bin = 500 KB at 200 KB/s: about 2.5 s.
	sel := []int{}
	for i, n := range m.res.Nodes {
		if strings.HasSuffix(n.Name, ".bin") && n.Name != "flaky.bin" {
			sel = append(sel, i)
		}
	}
	start := time.Now()
	if err := m.Start(Options{Dir: dir, Parallel: 2, LimitBps: 200 << 10}, sel); err != nil {
		t.Fatal(err)
	}
	c := waitFinished(t, rec)
	took := time.Since(start)
	if c.Done != 2 || c.Excluded != 2 {
		t.Fatalf("counts %+v", c)
	}
	if took < 2*time.Second || took > 5*time.Second {
		t.Fatalf("500 KB at 200 KB/s took %v", took)
	}
}

func TestPauseResumeStop(t *testing.T) {
	srv, m, rec, dir := setup(t)
	srv.slow = 40 * time.Millisecond // ~400 KB/s per file
	var aIdx int
	for i, n := range m.res.Nodes {
		if n.Name == "a.bin" {
			aIdx = i
		}
	}
	if err := m.Start(Options{Dir: dir, Parallel: 1}, []int{aIdx}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(300 * time.Millisecond)
	m.Pause()
	if m.State() != StatePaused {
		t.Fatalf("state %s", m.State())
	}
	part := filepath.Join(dir, "Course", "a.bin.part")
	fi, err := os.Stat(part)
	if err != nil || fi.Size() == 0 || fi.Size() >= 300<<10 {
		t.Fatalf("part file after pause: %v %v", err, fi)
	}
	paused := fi.Size()
	time.Sleep(200 * time.Millisecond)
	if fi, _ := os.Stat(part); fi.Size() != paused {
		t.Fatal("still downloading while paused")
	}

	// Stop while paused, then Start: continues from the .part file.
	m.Stop()
	if m.State() != StateStopped {
		t.Fatalf("state %s", m.State())
	}
	if err := m.Start(Options{Dir: dir, Parallel: 1}, []int{aIdx}); err != nil {
		t.Fatal(err)
	}
	c := waitFinished(t, rec)
	if c.Done != 1 {
		t.Fatalf("counts %+v", c)
	}
	got, _ := os.ReadFile(filepath.Join(dir, "Course", "a.bin"))
	if len(got) != 300<<10 || !bytes.Equal(got, srv.files["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1"]) {
		t.Fatalf("resumed file is wrong: %d bytes", len(got))
	}
	rs := srv.ranges["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1"]
	if len(rs) != 2 || rs[0] != "" || rs[1] != "bytes="+strconv.FormatInt(paused, 10)+"-" {
		t.Fatalf("expected a resume request from %d, got %q", paused, rs)
	}
	last := rec.ticks[len(rec.ticks)-1]
	if last.State != StateDone || last.Percent != 100 {
		t.Fatalf("last tick %+v", last)
	}
}

func TestLimiterLiveChange(t *testing.T) {
	l := NewLimiter(64 << 10)
	if l.Chunk() != minChunk {
		t.Fatalf("chunk %d", l.Chunk())
	}
	l.Set(0)
	if l.Chunk() != maxChunk {
		t.Fatalf("unlimited chunk %d", l.Chunk())
	}
	// A chunk read under a high cap must still pass after the cap drops.
	l.Set(1 << 20)
	n := l.Chunk()
	l.Set(64 << 10)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := l.Wait(ctx, n); err != nil {
		t.Fatal(err)
	}
}
