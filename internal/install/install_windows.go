// Package install records the installation in the registry, so the app
// knows its install ID, where it is installed and whether the installer
// already reported it.
package install

import (
	"golang.org/x/sys/windows/registry"
)

const keyPath = `Software\Eastape Tech\Eastape Downloader`

// Info is what the installer recorded.
type Info struct {
	ID       string
	Version  string
	Dir      string // install folder (1.2 and later)
	PingSent bool
	PerUser  bool // installed for the current user (1.2 and later), not for all users (1.1)
}

// Read returns the recorded installation: the per-user one first, then a
// version 1.1 installation for all users. A portable copy gets a zero Info.
func Read() Info {
	if info, ok := read(registry.CURRENT_USER, 0); ok {
		info.PerUser = true
		return info
	}
	if info, ok := read(registry.LOCAL_MACHINE, registry.WOW64_64KEY); ok {
		return info
	}
	return Info{}
}

func read(root registry.Key, view uint32) (Info, bool) {
	k, err := registry.OpenKey(root, keyPath, registry.QUERY_VALUE|view)
	if err != nil {
		return Info{}, false
	}
	defer k.Close()
	var info Info
	info.ID, _, _ = k.GetStringValue("InstallId")
	info.Version, _, _ = k.GetStringValue("Version")
	info.Dir, _, _ = k.GetStringValue("InstallDir")
	sent, _, _ := k.GetIntegerValue("PingSent")
	info.PingSent = sent == 1
	return info, info.ID != ""
}

// Write records the installation for the current user.
func Write(info Info) error {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, keyPath, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	for name, v := range map[string]string{"InstallId": info.ID, "Version": info.Version, "InstallDir": info.Dir} {
		if err := k.SetStringValue(name, v); err != nil {
			return err
		}
	}
	sent := uint32(0)
	if info.PingSent {
		sent = 1
	}
	return k.SetDWordValue("PingSent", sent)
}
