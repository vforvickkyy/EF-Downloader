// Package install records the installation in the registry, so the app
// knows its install ID and whether the installer already reported it.
package install

import (
	"golang.org/x/sys/windows/registry"
)

const keyPath = `Software\Eastape Tech\Eastape Downloader`

// Info is what the installer recorded.
type Info struct {
	ID       string
	Version  string
	PingSent bool
}

// Read returns the recorded installation, or a zero Info for a portable copy.
func Read() Info {
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, keyPath, registry.QUERY_VALUE|registry.WOW64_64KEY)
	if err != nil {
		return Info{}
	}
	defer k.Close()
	var info Info
	info.ID, _, _ = k.GetStringValue("InstallId")
	info.Version, _, _ = k.GetStringValue("Version")
	sent, _, _ := k.GetIntegerValue("PingSent")
	info.PingSent = sent == 1
	return info
}

// Write records the installation. It needs administrator rights, which the
// installer has.
func Write(info Info) error {
	k, _, err := registry.CreateKey(registry.LOCAL_MACHINE, keyPath, registry.SET_VALUE|registry.WOW64_64KEY)
	if err != nil {
		return err
	}
	defer k.Close()
	if err := k.SetStringValue("InstallId", info.ID); err != nil {
		return err
	}
	if err := k.SetStringValue("Version", info.Version); err != nil {
		return err
	}
	sent := uint32(0)
	if info.PingSent {
		sent = 1
	}
	return k.SetDWordValue("PingSent", sent)
}
