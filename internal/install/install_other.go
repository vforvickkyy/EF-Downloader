//go:build !windows

// Package install records the installation in the registry. Outside Windows
// every copy counts as portable.
package install

// Info is what the installer recorded.
type Info struct {
	ID       string
	Version  string
	PingSent bool
}

// Read returns a zero Info: there is no installer outside Windows.
func Read() Info { return Info{} }

// Write does nothing outside Windows.
func Write(Info) error { return nil }
