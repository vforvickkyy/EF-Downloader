package main

import (
	"strings"
	"testing"
)

func TestSetupIsRequired(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("HOME", t.TempDir())
	a := NewApp()

	link := "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345"
	if _, err := a.Scan(link); err == nil || !strings.Contains(err.Error(), "finish setting up") {
		t.Fatalf("scan before registering: %v", err)
	}
	if err := a.Start(nil); err == nil || !strings.Contains(err.Error(), "finish setting up") {
		t.Fatalf("start before registering: %v", err)
	}

	if _, err := a.Register("A", "asha@example.com"); err == nil {
		t.Fatal("a one-letter name was accepted")
	}
	if _, err := a.Register("Asha Verma", "not-an-email"); err == nil {
		t.Fatal("a bad email was accepted")
	}
	s, err := a.Register("Asha Verma", "asha@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if s.RegisteredAt == "" || s.TermsAccepted != termsVersion {
		t.Fatalf("registering didn't record the terms: %+v", s)
	}
	if err := a.requireSetup(); err != nil {
		t.Fatalf("still blocked after registering: %v", err)
	}

	// The settings screen can't change identity or terms.
	edited := a.GetSettings()
	edited.TermsAccepted, edited.UserEmail = "", "other@example.com"
	saved, err := a.SaveSettings(edited)
	if err != nil {
		t.Fatal(err)
	}
	if saved.TermsAccepted != termsVersion || saved.UserEmail != "asha@example.com" {
		t.Fatalf("settings screen changed protected fields: %+v", saved)
	}

	// After the terms change, the app is blocked until they're accepted.
	a.mu.Lock()
	a.settings.TermsAccepted = "2000-01-01"
	a.mu.Unlock()
	if err := a.requireSetup(); err == nil {
		t.Fatal("old terms weren't caught")
	}
	if _, err := a.AcceptTerms(); err != nil {
		t.Fatal(err)
	}
	if err := a.requireSetup(); err != nil {
		t.Fatalf("still blocked after accepting: %v", err)
	}
}
