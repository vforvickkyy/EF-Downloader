//go:build !windows

package main

import (
	"os/exec"
	"path/filepath"
	"runtime"
)

func openPath(p string) {
	cmd := "xdg-open"
	if runtime.GOOS == "darwin" {
		cmd = "open"
	}
	_ = exec.Command(cmd, p).Start()
}

func revealPath(p string) { openPath(filepath.Dir(p)) }
