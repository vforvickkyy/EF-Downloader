package main

import (
	"os/exec"
	"syscall"
)

func openPath(p string) {
	_ = exec.Command("explorer.exe", p).Start()
}

func revealPath(p string) {
	cmd := exec.Command("explorer.exe")
	// explorer needs /select,"path" verbatim; Go's argument quoting breaks it.
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: `explorer.exe /select,"` + p + `"`}
	_ = cmd.Start()
}
