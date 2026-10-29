// Package power keeps the Mac from going to sleep while downloads run.
package power

import (
	"os"
	"os/exec"
	"strconv"
	"sync"
)

var (
	mu  sync.Mutex
	cmd *exec.Cmd
)

// Keep asks macOS not to sleep until Release is called. caffeinate is tied to
// this process, so it also stops if the app quits unexpectedly.
func Keep() {
	mu.Lock()
	defer mu.Unlock()
	if cmd != nil {
		return
	}
	c := exec.Command("/usr/bin/caffeinate", "-i", "-w", strconv.Itoa(os.Getpid()))
	if c.Start() != nil {
		return
	}
	cmd = c
	go func() { _ = c.Wait() }()
}

// Release lets the Mac sleep again.
func Release() {
	mu.Lock()
	defer mu.Unlock()
	if cmd != nil {
		_ = cmd.Process.Kill()
		cmd = nil
	}
}
