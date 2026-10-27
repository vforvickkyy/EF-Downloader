// Package engine runs a download job: a queue of Drive files fetched a few at
// a time, under a shared speed cap, with pause, resume and stop.
package engine

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"eastape/internal/gdrive"
)

// Status of one file.
type Status string

const (
	StQueued   Status = "queued"
	StActive   Status = "active"
	StRetrying Status = "retrying"
	StPaused   Status = "paused" // was downloading when the job paused or stopped
	StDone     Status = "done"
	StSkipped  Status = "skipped" // already on disk
	StFailed   Status = "failed"
	StExcluded Status = "excluded"
	StNA       Status = "na" // Google offers no download (Forms, ...)
)

func (s Status) pending() bool { return s == StQueued || s == StPaused }

// State of the job.
type State string

const (
	StateIdle    State = "idle"
	StateReady   State = "ready"
	StateRunning State = "running"
	StatePaused  State = "paused"
	StateStopped State = "stopped"
	StateDone    State = "done"
)

// Options for a run.
type Options struct {
	Dir       string
	Parallel  int
	LimitBps  int64
	Overwrite bool // re-download files that already exist
	Retries   int
}

type file struct {
	idx      int
	node     *gdrive.Node
	status   Status
	err      string
	size     atomic.Int64 // -1 unknown
	done     atomic.Int64 // bytes on disk
	lastDone int64        // at the previous tick, for per-file speed
	speed    float64
	dirty    bool
	renamed  bool
}

// FileUpdate is one file's changed state, sent to the UI.
type FileUpdate struct {
	I      int     `json:"i"`
	Status Status  `json:"st"`
	Done   int64   `json:"d"`
	Size   int64   `json:"s"`
	Speed  float64 `json:"sp"`
	Err    string  `json:"e,omitempty"`
	Name   string  `json:"n,omitempty"`
	Path   string  `json:"path,omitempty"`
}

// Counts of files by outcome.
type Counts struct {
	Total    int `json:"total"` // selected, downloadable files
	Done     int `json:"done"`
	Skipped  int `json:"skipped"`
	Failed   int `json:"failed"`
	Active   int `json:"active"`
	Queued   int `json:"queued"`
	Excluded int `json:"excluded"`
	NA       int `json:"na"`
}

// Tick is the job's progress, sent to the UI a few times a second.
type Tick struct {
	State       State        `json:"state"`
	Speed       float64      `json:"speed"` // bytes/s, all files together
	Limit       int64        `json:"limit"`
	Parallel    int          `json:"parallel"`
	DoneBytes   int64        `json:"doneBytes"`
	TotalBytes  int64        `json:"totalBytes"` // of files with a known size
	UnknownSize int          `json:"unknownSize"`
	Percent     float64      `json:"percent"`
	ETA         float64      `json:"eta"`       // seconds, -1 unknown
	ETAApprox   bool         `json:"etaApprox"` // some sizes are guessed
	Elapsed     float64      `json:"elapsed"`
	Files       Counts       `json:"files"`
	Updates     []FileUpdate `json:"updates"`
	Dir         string       `json:"dir"`
}

// Manager owns at most one job at a time.
type Manager struct {
	emit func(event string, data any)

	// OnFileError, if set, receives the technical error behind every file
	// that finally fails (the UI shows a plain-language message).
	OnFileError func(path string, err error)

	mu        sync.Mutex
	client    *gdrive.Client
	res       *gdrive.Result
	files     []*file // by node index; nil for folders
	queue     []*file
	state     State
	opts      Options
	limiter   *Limiter
	active    int
	runCancel context.CancelFunc
	runDone   chan struct{}
	wake      chan struct{}
	runStart  time.Time
	inRun     bool // between startRunLocked and the end of dispatch
	elapsed   time.Duration

	transferred atomic.Int64 // bytes received, for the speed meter
	samples     []sample
}

type sample struct {
	t     time.Time
	bytes int64
}

// NewManager returns an idle manager. emit receives "job:tick" and
// "job:finished" events.
func NewManager(emit func(event string, data any)) *Manager {
	return &Manager{emit: emit, state: StateIdle, limiter: NewLimiter(0), wake: make(chan struct{}, 1)}
}

// SetClient sets the Drive client used for later downloads.
func (m *Manager) SetClient(c *gdrive.Client) {
	m.mu.Lock()
	m.client = c
	m.mu.Unlock()
}

// State returns the job state.
func (m *Manager) State() State {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state
}

// Busy reports whether a job is running or paused.
func (m *Manager) Busy() bool {
	s := m.State()
	return s == StateRunning || s == StatePaused
}

// Load replaces the current job with a scan result.
func (m *Manager) Load(res *gdrive.Result) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state == StateRunning || m.state == StatePaused {
		return errors.New("stop the current download first")
	}
	m.res = res
	m.files = make([]*file, len(res.Nodes))
	for i, n := range res.Nodes {
		if n.IsFolder() {
			continue
		}
		f := &file{idx: i, node: n, status: StQueued}
		if n.NoDownload != "" {
			f.status, f.err = StNA, n.NoDownload
		}
		f.size.Store(n.Size)
		m.files[i] = f
	}
	m.state = StateReady
	m.elapsed = 0
	return nil
}

// Start downloads the selected files (nil selects all) into opts.Dir. It also
// continues a stopped or finished job: files already done stay done.
func (m *Manager) Start(opts Options, selected []int) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	switch m.state {
	case StateIdle:
		return errors.New("scan a link first")
	case StateRunning:
		return nil
	case StatePaused:
		m.startRunLocked()
		return nil
	}
	if opts.Parallel < 1 {
		opts.Parallel = 1
	}
	if opts.Retries < 0 {
		opts.Retries = 0
	}
	m.opts = opts
	m.limiter.Set(opts.LimitBps)

	var sel map[int]bool
	if selected != nil {
		sel = make(map[int]bool, len(selected))
		for _, i := range selected {
			sel[i] = true
		}
	}
	for _, f := range m.files {
		if f == nil || f.status == StNA {
			continue
		}
		want := sel == nil || sel[f.idx]
		switch {
		case !want && f.status != StDone && f.status != StSkipped:
			f.status, f.err = StExcluded, ""
		case want && (f.status == StExcluded || f.status == StFailed):
			f.status, f.err = StQueued, ""
		}
		f.dirty = true
	}
	if err := m.makeFolders(); err != nil {
		return err
	}
	m.startRunLocked()
	return nil
}

// RetryFailed queues failed files again and runs them.
func (m *Manager) RetryFailed() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, f := range m.files {
		if f != nil && f.status == StFailed {
			f.status, f.err, f.dirty = StQueued, "", true
			n++
		}
	}
	if n == 0 {
		return nil
	}
	if m.state == StateRunning {
		m.queue = append(m.queue, m.pendingLocked()...)
		m.signal()
		return nil
	}
	if m.state == StatePaused {
		return nil // picked up on resume
	}
	m.startRunLocked()
	return nil
}

// Pause stops transfers but keeps their progress; Resume continues them.
func (m *Manager) Pause() { m.halt(StatePaused) }

// Resume continues a paused job.
func (m *Manager) Resume() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state == StatePaused {
		m.startRunLocked()
	}
}

// Stop ends the run. Partly downloaded files are kept and continue where
// they left off on the next Start.
func (m *Manager) Stop() { m.halt(StateStopped) }

func (m *Manager) halt(to State) {
	m.mu.Lock()
	if m.state == StatePaused && to == StateStopped {
		m.state = to
		m.mu.Unlock()
		m.emitTick()
		return
	}
	if m.state != StateRunning {
		m.mu.Unlock()
		return
	}
	m.state = to
	cancel, done := m.runCancel, m.runDone
	m.mu.Unlock()
	cancel()
	<-done
}

// SetLimit changes the speed cap immediately; <= 0 is unlimited.
func (m *Manager) SetLimit(bytesPerSec int64) {
	m.mu.Lock()
	m.opts.LimitBps = bytesPerSec
	m.mu.Unlock()
	m.limiter.Set(bytesPerSec)
}

// SetParallel changes how many files download at once, immediately.
func (m *Manager) SetParallel(n int) {
	if n < 1 {
		n = 1
	}
	m.mu.Lock()
	m.opts.Parallel = n
	m.mu.Unlock()
	m.signal()
}

// Dir returns the folder the current run downloads into.
func (m *Manager) Dir() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.opts.Dir
}

// LocalPath returns where file i is (or will be) saved.
func (m *Manager) LocalPath(i int) (string, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.res == nil || i < 0 || i >= len(m.res.Nodes) || m.opts.Dir == "" {
		return "", false
	}
	return joinPath(m.opts.Dir, m.res.Nodes[i].RelPath), true
}

func (m *Manager) signal() {
	select {
	case m.wake <- struct{}{}:
	default:
	}
}

func (m *Manager) pendingLocked() []*file {
	var q []*file
	for _, f := range m.files {
		if f != nil && f.status.pending() {
			q = append(q, f)
		}
	}
	return q
}

func (m *Manager) startRunLocked() {
	ctx, cancel := context.WithCancel(context.Background())
	m.runCancel = cancel
	m.runDone = make(chan struct{})
	m.queue = m.pendingLocked()
	m.state = StateRunning
	m.runStart = time.Now()
	m.inRun = true
	m.samples = nil
	go m.dispatch(ctx, m.runDone)
	go m.ticker(ctx)
}

// dispatch starts files while fewer than Parallel are running, until the
// queue is empty or the run is cancelled.
func (m *Manager) dispatch(ctx context.Context, done chan struct{}) {
	defer close(done)
	var wg sync.WaitGroup
	for {
		m.mu.Lock()
		for ctx.Err() == nil && m.active < m.opts.Parallel && len(m.queue) > 0 {
			f := m.queue[0]
			m.queue = m.queue[1:]
			if !f.status.pending() {
				continue
			}
			f.status, f.err, f.dirty = StActive, "", true
			m.active++
			wg.Add(1)
			go func() {
				defer wg.Done()
				m.runFile(ctx, f)
			}()
		}
		finished := m.active == 0 && len(m.queue) == 0
		m.mu.Unlock()
		if finished || ctx.Err() != nil {
			break
		}
		select {
		case <-ctx.Done():
		case <-m.wake:
		}
	}
	wg.Wait()

	m.mu.Lock()
	completed := ctx.Err() == nil
	if completed {
		m.state = StateDone
	}
	m.elapsed += time.Since(m.runStart)
	m.inRun = false
	m.runCancel()
	m.mu.Unlock()

	m.emitTick()
	if completed {
		m.emit("job:finished", m.counts())
	}
}

func (m *Manager) runFile(ctx context.Context, f *file) {
	var err error
	for attempt := 0; ; attempt++ {
		err = m.transfer(ctx, f)
		if err == nil || ctx.Err() != nil || !retryable(err) || attempt >= m.opts.Retries {
			break
		}
		wait := time.Duration(2+attempt*4) * time.Second
		m.mu.Lock()
		f.status, f.err, f.dirty = StRetrying, fmt.Sprintf("Retrying (%d of %d): %s", attempt+1, m.opts.Retries, errorText(err)), true
		m.mu.Unlock()
		select {
		case <-ctx.Done():
		case <-time.After(wait):
		}
		if ctx.Err() != nil {
			break
		}
		m.mu.Lock()
		f.status, f.dirty = StActive, true
		m.mu.Unlock()
	}

	m.mu.Lock()
	m.active--
	switch {
	case ctx.Err() != nil:
		f.status, f.err = StPaused, ""
	case err != nil:
		f.status, f.err = StFailed, errorText(err)
	}
	f.speed, f.dirty = 0, true
	path, failed := f.node.RelPath, err != nil && ctx.Err() == nil
	m.mu.Unlock()
	if failed && m.OnFileError != nil {
		m.OnFileError(path, err)
	}
	m.signal()
}

func (m *Manager) ticker(ctx context.Context) {
	t := time.NewTicker(500 * time.Millisecond)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			m.emitTick()
		}
	}
}

// Transferred returns the bytes received since the manager was created.
func (m *Manager) Transferred() int64 { return m.transferred.Load() }

// Summary is the job at a glance, for usage stats.
type Summary struct {
	State    State
	Files    Counts
	Elapsed  float64 // seconds spent downloading
	Limit    int64
	Parallel int
}

// Summary describes the job without changing what the next tick reports.
func (m *Manager) Summary() Summary {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := Summary{State: m.state, Elapsed: m.elapsed.Seconds(), Limit: m.opts.LimitBps, Parallel: m.opts.Parallel}
	if m.inRun {
		s.Elapsed += time.Since(m.runStart).Seconds()
	}
	for _, f := range m.files {
		if f != nil {
			s.Files.add(f.status)
		}
	}
	return s
}

func (c *Counts) add(st Status) {
	switch st {
	case StExcluded:
		c.Excluded++
	case StNA:
		c.NA++
	default:
		c.Total++
		switch st {
		case StDone:
			c.Done++
		case StSkipped:
			c.Skipped++
		case StFailed:
			c.Failed++
		case StActive, StRetrying:
			c.Active++
		default:
			c.Queued++
		}
	}
}

// Snapshot returns the full state of every file, for a UI that just loaded.
func (m *Manager) Snapshot() Tick {
	m.mu.Lock()
	for _, f := range m.files {
		if f != nil {
			f.dirty = true
		}
	}
	m.mu.Unlock()
	return m.tick()
}

func (m *Manager) emitTick() { m.emit("job:tick", m.tick()) }

func (m *Manager) tick() Tick {
	now := time.Now()
	total := m.transferred.Load()

	m.mu.Lock()
	defer m.mu.Unlock()

	// Overall speed over the last 3 seconds.
	m.samples = append(m.samples, sample{now, total})
	for len(m.samples) > 2 && now.Sub(m.samples[0].t) > 3*time.Second {
		m.samples = m.samples[1:]
	}
	var speed float64
	if first := m.samples[0]; now.Sub(first.t) > 200*time.Millisecond {
		speed = float64(total-first.bytes) / now.Sub(first.t).Seconds()
	}
	if m.state != StateRunning {
		speed = 0
	}

	t := Tick{State: m.state, Speed: speed, Limit: m.opts.LimitBps, Parallel: m.opts.Parallel, ETA: -1, Dir: m.opts.Dir}
	t.Elapsed = m.elapsed.Seconds()
	if m.state == StateRunning {
		t.Elapsed += now.Sub(m.runStart).Seconds()
	}
	var partial float64 // fractional progress of unfinished files, for Percent
	for _, f := range m.files {
		if f == nil {
			continue
		}
		size, done := f.size.Load(), f.done.Load()
		if f.status == StActive {
			inst := float64(done-f.lastDone) / 0.5
			if inst < 0 {
				inst = 0
			}
			f.speed = 0.6*f.speed + 0.4*inst
			f.dirty = true
		}
		f.lastDone = done
		t.Files.add(f.status)
		if f.status != StExcluded && f.status != StNA {
			if size >= 0 {
				t.TotalBytes += size
				if size > 0 && f.status != StDone && f.status != StSkipped {
					partial += float64(done) / float64(size)
				}
			} else {
				t.UnknownSize++
			}
			if f.status == StDone || f.status == StSkipped {
				if size >= 0 {
					t.DoneBytes += size
				} else {
					t.DoneBytes += done
				}
			} else {
				t.DoneBytes += done
			}
		}
		if f.dirty {
			u := FileUpdate{I: f.idx, Status: f.status, Done: done, Size: size, Err: f.err}
			if f.status == StActive {
				u.Speed = f.speed
			}
			if f.renamed {
				u.Name, u.Path = f.node.Name, f.node.RelPath
			}
			t.Updates = append(t.Updates, u)
			f.dirty = false
		}
	}
	finished := t.Files.Done + t.Files.Skipped + t.Files.Failed
	switch {
	case t.Files.Total == 0:
		t.Percent = 0
	case t.UnknownSize == 0 && t.TotalBytes > 0:
		t.Percent = 100 * float64(t.DoneBytes) / float64(t.TotalBytes)
	default:
		t.Percent = 100 * (float64(finished) + partial) / float64(t.Files.Total)
	}
	if t.Percent > 100 {
		t.Percent = 100
	}
	if speed > 1 {
		remaining := float64(t.TotalBytes - t.DoneBytes)
		if known := t.Files.Total - t.UnknownSize; t.UnknownSize > 0 && known > 0 && t.TotalBytes > 0 {
			// Guess files of unknown size are as big as the average known one.
			remaining += float64(t.TotalBytes) / float64(known) * float64(t.UnknownSize)
			t.ETAApprox = true
		}
		if t.UnknownSize == 0 || t.ETAApprox {
			t.ETA = max(0, remaining) / speed
		}
	}
	return t
}

func (m *Manager) counts() Counts {
	return m.tick().Files
}
