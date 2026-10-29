package main

import "os/exec"

func openPath(p string) { _ = exec.Command("/usr/bin/open", p).Start() }

// revealPath shows the file selected in a Finder window.
func revealPath(p string) { _ = exec.Command("/usr/bin/open", "-R", p).Start() }
