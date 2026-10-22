// Package gdrive talks to Google Drive for publicly shared ("Anyone with the
// link") files and folders. It works without any login: either by reading the
// same public pages a browser would, or through the official Drive API when
// the user supplies a free API key.
package gdrive

import "strings"

// Google-native MIME types.
const (
	MimeFolder       = "application/vnd.google-apps.folder"
	MimeDocument     = "application/vnd.google-apps.document"
	MimeSpreadsheet  = "application/vnd.google-apps.spreadsheet"
	MimePresentation = "application/vnd.google-apps.presentation"
	MimeDrawing      = "application/vnd.google-apps.drawing"
	MimeShortcut     = "application/vnd.google-apps.shortcut"
	MimeForm         = "application/vnd.google-apps.form"
	MimeUnknownFile  = "application/octet-stream"
	googleAppsPrefix = "application/vnd.google-apps."
)

// Item is one file or folder found on Drive.
type Item struct {
	ID          string
	ResourceKey string
	Name        string
	MimeType    string
	Size        int64 // -1 when unknown (no-key mode lists no sizes)
	MD5         string
	Modified    string // RFC 3339, empty when unknown
	// NameFromResponse is set when the name could not be read up front and
	// must be taken from the download response instead.
	NameFromResponse bool
}

// IsFolder reports whether the item is a folder.
func (it *Item) IsFolder() bool { return it.MimeType == MimeFolder }

// IsGoogleNative reports whether the item is a Google Docs/Sheets/Slides/...
// file, which has no bytes of its own and must be exported.
func (it *Item) IsGoogleNative() bool {
	return strings.HasPrefix(it.MimeType, googleAppsPrefix) && !it.IsFolder()
}

// DocsFormat picks what Google Docs files are converted to.
type DocsFormat string

const (
	DocsOffice DocsFormat = "office" // .docx / .xlsx / .pptx
	DocsPDF    DocsFormat = "pdf"
)

// Export describes how a Google-native file is converted for download.
type Export struct {
	Mime    string // MIME type requested from the Drive API
	Ext     string // file extension, with the dot
	Format  string // ?format= value for docs.google.com export links
	WebPath string // docs.google.com path segment ("document", "spreadsheets", ...)
}

// ExportFor returns how to export a Google-native MIME type, or false when
// Google offers no download for it (Forms, Sites, Maps, ...).
func ExportFor(mime string, f DocsFormat) (Export, bool) {
	pdf := f == DocsPDF
	switch mime {
	case MimeDocument:
		if pdf {
			return Export{"application/pdf", ".pdf", "pdf", "document"}, true
		}
		return Export{"application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".docx", "docx", "document"}, true
	case MimeSpreadsheet:
		if pdf {
			return Export{"application/pdf", ".pdf", "pdf", "spreadsheets"}, true
		}
		return Export{"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xlsx", "xlsx", "spreadsheets"}, true
	case MimePresentation:
		if pdf {
			return Export{"application/pdf", ".pdf", "pdf", "presentation"}, true
		}
		return Export{"application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx", "pptx", "presentation"}, true
	case MimeDrawing:
		if pdf {
			return Export{"application/pdf", ".pdf", "pdf", "drawings"}, true
		}
		return Export{"image/png", ".png", "png", "drawings"}, true
	}
	return Export{}, false
}

// mimeForDocsPath maps a docs.google.com path segment to its MIME type.
func mimeForDocsPath(kind string) string {
	switch kind {
	case "document":
		return MimeDocument
	case "spreadsheets":
		return MimeSpreadsheet
	case "presentation":
		return MimePresentation
	case "drawings":
		return MimeDrawing
	case "forms":
		return MimeForm
	}
	return googleAppsPrefix + strings.TrimSuffix(kind, "s")
}
