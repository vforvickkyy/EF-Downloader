// Package power keeps Windows from going to sleep while downloads run.
package power

import (
	"runtime"
	"sync"
	"syscall"
)

const (
	esContinuous     = 0x80000000
	esSystemRequired = 0x00000001
)

var (
	setThreadExecutionState = syscall.NewLazyDLL("kernel32.dll").NewProc("SetThreadExecutionState")

	mu      sync.Mutex
	release chan struct{}
)

// Keep asks Windows not to sleep until Release is called. The request belongs
// to one OS thread, so a dedicated, locked goroutine holds it.
func Keep() {
	mu.Lock()
	defer mu.Unlock()
	if release != nil {
		return
	}
	release = make(chan struct{})
	go func(done chan struct{}) {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		setThreadExecutionState.Call(esContinuous | esSystemRequired)
		<-done
		setThreadExecutionState.Call(esContinuous)
	}(release)
}

// Release lets Windows sleep again.
func Release() {
	mu.Lock()
	defer mu.Unlock()
	if release != nil {
		close(release)
		release = nil
	}
}
