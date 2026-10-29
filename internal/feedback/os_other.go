//go:build !windows && !darwin

package feedback

import "runtime"

// OSVersion describes the operating system.
func OSVersion() string { return runtime.GOOS + "/" + runtime.GOARCH }
