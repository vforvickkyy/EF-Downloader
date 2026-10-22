package gdrive

import (
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

var (
	invalidNameChars = regexp.MustCompile(`[<>:"/\\|?*\x00-\x1f]`)
	reservedNames    = regexp.MustCompile(`^(?i)(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[0-9¹²³]|LPT[0-9¹²³])$`)
)

// maxNameBytes keeps single path components well under the 255-character
// limit of NTFS so the extension and " (2)" suffixes still fit.
const maxNameBytes = 200

// SanitizeName turns a Drive name into a name Windows accepts. Drive allows
// characters such as ':' and '?' and names ending in a dot; Windows does not.
func SanitizeName(name string) string {
	name = strings.ToValidUTF8(name, "_")
	name = invalidNameChars.ReplaceAllString(name, "_")
	name = strings.TrimSpace(name)
	name = strings.TrimRight(name, ". ")
	if name == "" {
		return "_"
	}
	stem := name
	if i := strings.IndexByte(stem, '.'); i >= 0 {
		stem = stem[:i]
	}
	if reservedNames.MatchString(strings.TrimRight(stem, " ")) {
		name = "_" + name
	}
	if len(name) > maxNameBytes {
		ext := filepath.Ext(name)
		if len(ext) > 20 || len(ext) >= maxNameBytes {
			ext = ""
		}
		base := name[:maxNameBytes-len(ext)]
		for !utf8.ValidString(base) {
			base = base[:len(base)-1]
		}
		name = strings.TrimRight(base, ". ") + ext
	}
	return name
}

// WithExt appends ext unless name already ends with it (case-insensitive).
func WithExt(name, ext string) string {
	if ext == "" || strings.HasSuffix(strings.ToLower(name), strings.ToLower(ext)) {
		return name
	}
	return name + ext
}

// NameDeduper hands out unique names within one folder. Drive lets several
// files share a name; Windows compares names case-insensitively.
type NameDeduper struct{ used map[string]bool }

// Unique returns name, or "name (2).ext", "name (3).ext", ... if it is taken.
func (d *NameDeduper) Unique(name string, isFolder bool) string {
	if d.used == nil {
		d.used = map[string]bool{}
	}
	key := strings.ToLower(name)
	if !d.used[key] {
		d.used[key] = true
		return name
	}
	stem, ext := name, ""
	if !isFolder {
		ext = filepath.Ext(name)
		stem = strings.TrimSuffix(name, ext)
	}
	for n := 2; ; n++ {
		cand := stem + " (" + strconv.Itoa(n) + ")" + ext
		if k := strings.ToLower(cand); !d.used[k] {
			d.used[k] = true
			return cand
		}
	}
}
