//go:build !windows && !darwin

// Package power keeps the computer from going to sleep while downloads run.
// On systems other than Windows and macOS it does nothing.
package power

// Keep is a no-op here.
func Keep() {}

// Release is a no-op here.
func Release() {}
