package main

import (
	"os/exec"
	"syscall"
)

// startDetached starts a program that keeps running after the app exits
// (the update installer).
func startDetached(path string, args ...string) error {
	const detachedProcess, newProcessGroup = 0x00000008, 0x00000200
	cmd := exec.Command(path, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: detachedProcess | newProcessGroup}
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}
