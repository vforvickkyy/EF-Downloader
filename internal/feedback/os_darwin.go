package feedback

import (
	"os/exec"
	"runtime"
	"strings"
	"sync"
)

var (
	osOnce sync.Once
	osName string
)

// OSVersion describes the macOS version, e.g. "macOS 15.1 (Apple silicon)".
func OSVersion() string {
	osOnce.Do(func() {
		chip := "Intel"
		if runtime.GOARCH == "arm64" {
			chip = "Apple silicon"
		}
		out, _ := exec.Command("/usr/bin/sw_vers", "-productVersion").Output()
		if v := strings.TrimSpace(string(out)); v != "" {
			osName = "macOS " + v + " (" + chip + ")"
		} else {
			osName = "macOS (" + chip + ")"
		}
	})
	return osName
}
