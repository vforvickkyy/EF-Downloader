//go:build !windows

// Package power keeps Windows from going to sleep while downloads run. On
// other systems it does nothing.
package power

// Keep is a no-op outside Windows.
func Keep() {}

// Release is a no-op outside Windows.
func Release() {}
