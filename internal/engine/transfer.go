package engine

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"eastape/internal/gdrive"
)

// stallTimeout ends a connection that has delivered nothing for this long,
// so it can be retried instead of hanging forever.
var stallTimeout = 60 * time.Second

var (
	errStalled    = errors.New("connection stalled")
	errIncomplete = errors.New("download ended early")
)

// FolderError means a folder couldn't be created in the download location.
type FolderError struct {
	Path string
	Err  error
}

func (e *FolderError) Error() string { return fmt.Sprintf("can't create folder %s: %v", e.Path, e.Err) }
func (e *FolderError) Unwrap() error { return e.Err }

// localError is a problem on this computer (disk full, no permission):
// retrying won't help.
type localError struct{ err error }

func (e *localError) Error() string { return e.err.Error() }
func (e *localError) Unwrap() error { return e.err }

func retryable(err error) bool {
	var le *localError
	if errors.As(err, &le) {
		return false
	}
	return gdrive.Retryable(err)
}

// errorText is the message shown next to a failed file. Technical details
// go to Manager.OnFileError instead.
func errorText(err error) string {
	var le *localError
	if errors.As(err, &le) {
		switch {
		case isDiskFull(le.err):
			return "Not enough disk space"
		case errors.Is(le.err, os.ErrPermission):
			return "No permission to save here. Choose another download folder."
		}
		return "Couldn't save the file on this computer"
	}
	var ge *gdrive.Error
	switch {
	case errors.Is(err, errStalled):
		return "The connection stopped responding"
	case errors.Is(err, errIncomplete):
		return "The download was interrupted"
	case errors.As(err, &ge):
		return ge.Msg
	}
	return "Network problem. Check your internet connection."
}

func joinPath(dir, rel string) string { return filepath.Join(dir, rel) }

// makeFolders recreates the Drive folder tree: every folder holding a
// selected file, and every empty folder.
func (m *Manager) makeFolders() error {
	need := make([]bool, len(m.res.Nodes))
	hasFiles := make([]bool, len(m.res.Nodes))
	for i, n := range m.res.Nodes {
		f := m.files[i]
		if f == nil {
			continue
		}
		selected := f.status != StExcluded && f.status != StNA
		for p := n.Parent; p >= 0; p = m.res.Nodes[p].Parent {
			hasFiles[p] = true
			if selected {
				need[p] = true
			}
		}
	}
	for i, n := range m.res.Nodes {
		if !n.IsFolder() || !(need[i] || !hasFiles[i]) {
			continue
		}
		if err := os.MkdirAll(joinPath(m.opts.Dir, n.RelPath), 0o755); err != nil {
			return &FolderError{Path: n.RelPath, Err: err}
		}
	}
	return nil
}

// transfer downloads one file, resuming from its .part file if there is one.
func (m *Manager) transfer(ctx context.Context, f *file) error {
	m.mu.Lock()
	client, dir, overwrite := m.client, m.opts.Dir, m.opts.Overwrite
	n := f.node
	final := joinPath(dir, n.RelPath)
	m.mu.Unlock()

	if !overwrite && !n.NameFromResponse && m.alreadyThere(f, final) {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(final), 0o755); err != nil {
		return &localError{err}
	}

	part := final + ".part"
	var offset int64
	size := f.size.Load()
	// Exports can't resume, and a file named by the server has no .part yet.
	if n.Export == nil && !n.NameFromResponse {
		if fi, err := os.Stat(part); err == nil {
			offset = fi.Size()
		}
		if size >= 0 && offset > size {
			offset = 0
		}
		if size > 0 && offset == size {
			f.done.Store(offset)
			return m.finish(f, part, final)
		}
	}

	// Cancelled when the job pauses, or when the connection stalls.
	tctx, cancel := context.WithCancelCause(ctx)
	defer cancel(nil)
	stream, err := client.Open(tctx, n, offset)
	if err != nil && gdrive.KindOf(err) == gdrive.ErrRange && offset > 0 {
		offset = 0
		stream, err = client.Open(tctx, n, 0)
	}
	if err != nil {
		return err
	}
	defer stream.Body.Close()

	if n.NameFromResponse && stream.Filename != "" {
		final, part = m.rename(f, stream.Filename)
		if !overwrite && m.alreadyThere(f, final) {
			return nil
		}
	}

	offset = stream.Offset
	if stream.Total >= 0 {
		f.size.Store(stream.Total)
		m.mu.Lock()
		n.Size = stream.Total
		f.dirty = true
		m.mu.Unlock()
	}

	flags := os.O_CREATE | os.O_WRONLY
	if offset == 0 {
		flags |= os.O_TRUNC
	}
	out, err := os.OpenFile(part, flags, 0o644)
	if err != nil {
		return &localError{err}
	}
	if _, err := out.Seek(offset, io.SeekStart); err != nil {
		out.Close()
		return &localError{err}
	}
	f.done.Store(offset)

	stall := time.AfterFunc(stallTimeout, func() { cancel(errStalled) })
	defer stall.Stop()

	buf := make([]byte, maxChunk)
	written := offset
	var copyErr error
	for {
		chunk := m.limiter.Chunk()
		nr, rerr := stream.Body.Read(buf[:chunk])
		if nr > 0 {
			stall.Reset(stallTimeout)
			if err := m.limiter.Wait(tctx, nr); err != nil {
				copyErr = err
				break
			}
			if _, err := out.Write(buf[:nr]); err != nil {
				copyErr = &localError{err}
				break
			}
			written += int64(nr)
			f.done.Store(written)
			m.transferred.Add(int64(nr))
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			copyErr = rerr
			break
		}
	}
	if cerr := out.Close(); cerr != nil && copyErr == nil {
		copyErr = &localError{cerr}
	}
	if copyErr != nil {
		if errors.Is(context.Cause(tctx), errStalled) && ctx.Err() == nil {
			return errStalled
		}
		return copyErr
	}
	if total := f.size.Load(); total >= 0 && written != total {
		return fmt.Errorf("%w (%d of %d bytes)", errIncomplete, written, total)
	}
	f.size.Store(written)
	return m.finish(f, part, final)
}

// alreadyThere marks f skipped when it is already downloaded: same size, or
// any size when Drive didn't tell us one.
func (m *Manager) alreadyThere(f *file, final string) bool {
	fi, err := os.Stat(final)
	if err != nil || !fi.Mode().IsRegular() {
		return false
	}
	size := f.size.Load()
	if size >= 0 && fi.Size() != size {
		return false
	}
	f.size.Store(fi.Size())
	f.done.Store(fi.Size())
	m.mu.Lock()
	f.status, f.dirty = StSkipped, true
	m.mu.Unlock()
	return true
}

// finish moves the completed .part file into place.
func (m *Manager) finish(f *file, part, final string) error {
	if err := os.Rename(part, final); err != nil {
		return &localError{err}
	}
	if t, err := time.Parse(time.RFC3339, f.node.Modified); err == nil {
		_ = os.Chtimes(final, time.Now(), t)
	}
	m.mu.Lock()
	f.status, f.dirty = StDone, true
	m.mu.Unlock()
	return nil
}

// rename gives a file whose name was unknown at scan time the name Google
// sent with the download.
func (m *Manager) rename(f *file, name string) (final, part string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := f.node
	n.Name = gdrive.SanitizeName(name)
	n.RelPath = filepath.Join(filepath.Dir(n.RelPath), n.Name)
	n.NameFromResponse = false
	f.renamed, f.dirty = true, true
	final = joinPath(m.opts.Dir, n.RelPath)
	return final, final + ".part"
}
