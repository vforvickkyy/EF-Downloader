//go:build !windows

package main

import "errors"

// startDetached is only needed for Windows updates.
func startDetached(string, ...string) error {
	return errors.New("updates are installed on Windows only")
}
