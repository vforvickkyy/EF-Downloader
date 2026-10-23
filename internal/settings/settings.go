// Package settings stores the user's preferences in
// %APPDATA%\EastapeDownloader\settings.json.
package settings

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// Settings are the user's preferences.
type Settings struct {
	DownloadDir  string   `json:"downloadDir"`
	SpeedLimitKB int64    `json:"speedLimitKB"` // KB/s; 0 = unlimited
	Parallel     int      `json:"parallel"`
	APIKey       string   `json:"apiKey"`
	Theme        string   `json:"theme"` // dark, light, system
	Overwrite    bool     `json:"overwrite"`
	DocsFormat   string   `json:"docsFormat"` // office, pdf
	PreventSleep bool     `json:"preventSleep"`
	OpenWhenDone bool     `json:"openWhenDone"`
	Retries      int      `json:"retries"`
	RecentLinks  []string `json:"recentLinks"`

	// Registration and installation reporting; changed only through
	// App.Register and the startup check, never by the settings screen.
	UserName     string `json:"userName"`
	UserEmail    string `json:"userEmail"`
	RegisteredAt string `json:"registeredAt"`
	InstallID    string `json:"installId"`
	ReportedID   string `json:"reportedId"` // install ID whose installation notice was queued
}

// KeepIdentity copies the registration and installation fields from cur, so
// saving settings from the UI can't change them.
func (s Settings) KeepIdentity(cur Settings) Settings {
	s.RecentLinks = cur.RecentLinks
	s.UserName, s.UserEmail, s.RegisteredAt = cur.UserName, cur.UserEmail, cur.RegisteredAt
	s.InstallID, s.ReportedID = cur.InstallID, cur.ReportedID
	return s
}

// Defaults returns first-run settings.
func Defaults() Settings {
	dir := "."
	if home, err := os.UserHomeDir(); err == nil {
		dir = filepath.Join(home, "Downloads", "Eastape")
	}
	return Settings{
		DownloadDir:  dir,
		Parallel:     3,
		Theme:        "dark",
		DocsFormat:   "office",
		PreventSleep: true,
		Retries:      3,
	}
}

func path() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "EastapeDownloader", "settings.json"), nil
}

// Load reads saved settings, falling back to defaults for anything missing.
func Load() Settings {
	s := Defaults()
	p, err := path()
	if err != nil {
		return s
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return s
	}
	_ = json.Unmarshal(b, &s)
	return s.Normalize()
}

// Normalize clamps values into their valid ranges.
func (s Settings) Normalize() Settings {
	d := Defaults()
	if strings.TrimSpace(s.DownloadDir) == "" {
		s.DownloadDir = d.DownloadDir
	}
	if s.Parallel < 1 {
		s.Parallel = 1
	}
	if s.Parallel > 8 {
		s.Parallel = 8
	}
	if s.SpeedLimitKB < 0 {
		s.SpeedLimitKB = 0
	}
	if s.Theme != "light" && s.Theme != "system" {
		s.Theme = "dark"
	}
	if s.DocsFormat != "pdf" {
		s.DocsFormat = "office"
	}
	if s.Retries < 0 || s.Retries > 10 {
		s.Retries = d.Retries
	}
	s.APIKey = strings.TrimSpace(s.APIKey)
	if len(s.RecentLinks) > 8 {
		s.RecentLinks = s.RecentLinks[:8]
	}
	return s
}

// Save writes the settings.
func Save(s Settings) error {
	p, err := path()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

// AddRecent puts link at the front of the recent links list.
func (s *Settings) AddRecent(link string) {
	link = strings.TrimSpace(link)
	if link == "" {
		return
	}
	out := []string{link}
	for _, l := range s.RecentLinks {
		if l != link && len(out) < 8 {
			out = append(out, l)
		}
	}
	s.RecentLinks = out
}
