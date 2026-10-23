package gdrive

import (
	"context"
	"errors"
	"fmt"
)

// ErrKind classifies Drive failures so the downloader knows whether retrying
// can help.
type ErrKind int

const (
	ErrTransient       ErrKind = iota // network hiccup, 5xx, 429: retry
	ErrQuota                          // Google's per-file 24h download quota
	ErrNotFound                       // deleted or wrong ID
	ErrNoAccess                       // not shared as "Anyone with the link"
	ErrNotDownloadable                // Forms, Sites, ... have no download
	ErrBadKey                         // API key rejected or Drive API disabled
	ErrRange                          // server refused the resume offset
	ErrParse                          // a page Google returned was not understood
)

// Error is a classified Drive error with a message fit for the UI.
type Error struct {
	Kind   ErrKind
	Status int
	Msg    string
}

func (e *Error) Error() string { return e.Msg }

func newErr(kind ErrKind, status int, format string, args ...any) *Error {
	return &Error{Kind: kind, Status: status, Msg: fmt.Sprintf(format, args...)}
}

// KindOf returns the kind of err, treating unclassified errors (network
// failures, truncated bodies) as transient.
func KindOf(err error) ErrKind {
	var e *Error
	if errors.As(err, &e) {
		return e.Kind
	}
	return ErrTransient
}

// Retryable reports whether trying again may succeed.
func Retryable(err error) bool {
	if err == nil || errors.Is(err, context.Canceled) {
		return false
	}
	switch KindOf(err) {
	case ErrTransient, ErrParse:
		return true
	}
	return false
}

var (
	errNoAccess = func(status int) *Error {
		return newErr(ErrNoAccess, status, "Not shared publicly. Set sharing to \"Anyone with the link\".")
	}
	errNotFound = func(status int) *Error {
		return newErr(ErrNotFound, status, "Not found. It may have been deleted, or the link is wrong.")
	}
	errQuota = func(status int) *Error {
		return newErr(ErrQuota, status, "Google's download limit for this file was reached (too many downloads in 24 h). Try again later.")
	}
)

func statusErr(status int) *Error {
	switch {
	case status == 401 || status == 403:
		return errNoAccess(status)
	case status == 404:
		return errNotFound(status)
	case status == 416:
		return newErr(ErrRange, status, "Couldn't continue the earlier download")
	case status == 429:
		return newErr(ErrTransient, status, "Google Drive is busy right now")
	case status >= 500:
		return newErr(ErrTransient, status, "Google Drive had a temporary problem")
	}
	return newErr(ErrTransient, status, "Google Drive sent an unexpected answer")
}
