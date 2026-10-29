//go:build !windows && !darwin

package main

import "os"

// fatalDialog prints the message outside Windows.
func fatalDialog(title, message string) { os.Stderr.WriteString(title + ": " + message + "\n") }
