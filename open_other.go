//go:build !windows && !darwin

package main

import (
	"os/exec"
	"path/filepath"
)

func openPath(p string) { _ = exec.Command("xdg-open", p).Start() }

func revealPath(p string) { openPath(filepath.Dir(p)) }
