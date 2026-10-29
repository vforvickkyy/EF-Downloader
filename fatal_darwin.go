package main

import (
	"os"
	"os/exec"
	"strings"
)

// fatalDialog shows a plain alert, for errors that happen before the window
// exists.
func fatalDialog(title, message string) {
	quote := func(s string) string {
		return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s) + `"`
	}
	script := "display alert " + quote(title) + " message " + quote(message) + " as critical"
	if exec.Command("/usr/bin/osascript", "-e", script).Run() != nil {
		os.Stderr.WriteString(title + ": " + message + "\n")
	}
}
