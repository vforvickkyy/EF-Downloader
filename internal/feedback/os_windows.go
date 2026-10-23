package feedback

import (
	"fmt"

	"golang.org/x/sys/windows"
)

// OSVersion describes the Windows version, e.g. "Windows 11 (build 22631)".
func OSVersion() string {
	v := windows.RtlGetVersion()
	name := "Windows 10"
	switch {
	case v.MajorVersion == 10 && v.BuildNumber >= 22000:
		name = "Windows 11"
	case v.MajorVersion < 10:
		name = fmt.Sprintf("Windows %d.%d", v.MajorVersion, v.MinorVersion)
	}
	return fmt.Sprintf("%s (build %d)", name, v.BuildNumber)
}
