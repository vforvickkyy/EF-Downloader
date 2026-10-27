package cloud

import (
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var versionExpr = regexp.MustCompile(`^\d{1,4}\.\d{1,4}\.\d{1,4}$`)

// ErrBadUpdate means an update failed its checks and must not be installed.
var ErrBadUpdate = errors.New("the update failed its security check")

// SigningText is what an update signature covers (the service signs the same
// text, see web/lib/crypto.js).
func SigningText(u Update) string {
	return fmt.Sprintf("eastape-update-v1\n%s\n%s\n%d\n%s", u.Version, u.SHA256, u.Size, u.URL)
}

// Verify checks that the offer was signed with the key built into the app.
func (u Update) Verify() error {
	key, err := base64.StdEncoding.DecodeString(UpdateKey)
	if err != nil || len(key) != ed25519.PublicKeySize {
		return fmt.Errorf("%w: no update key in this build", ErrBadUpdate)
	}
	sig, err := base64.StdEncoding.DecodeString(u.Signature)
	if err != nil || !ed25519.Verify(ed25519.PublicKey(key), []byte(SigningText(u)), sig) {
		return fmt.Errorf("%w: bad signature", ErrBadUpdate)
	}
	if !versionExpr.MatchString(u.Version) || u.Size <= 0 || len(u.SHA256) != 64 {
		return fmt.Errorf("%w: incomplete offer", ErrBadUpdate)
	}
	if pu, err := url.Parse(u.URL); err != nil || pu.Scheme != "https" {
		return fmt.Errorf("%w: download link isn't https", ErrBadUpdate)
	}
	return nil
}

// Download saves the update's installer into dir and checks its size and
// SHA-256. progress (may be nil) receives bytes done and total.
func (u Update) Download(ctx context.Context, dir string, progress func(done, total int64)) (string, error) {
	if err := u.Verify(); err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, "EastapeDownloader-Setup-"+u.Version+".exe")
	if ok, _ := fileMatches(path, u); ok {
		if progress != nil {
			progress(u.Size, u.Size)
		}
		return path, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.URL, nil)
	if err != nil {
		return "", err
	}
	resp, err := newHTTPClient(0).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download failed (HTTP %d)", resp.StatusCode)
	}

	tmp := path + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	var done int64
	buf := make([]byte, 256<<10)
	last := time.Time{}
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			done += int64(n)
			if done > u.Size {
				f.Close()
				os.Remove(tmp)
				return "", fmt.Errorf("%w: file is larger than announced", ErrBadUpdate)
			}
			h.Write(buf[:n])
			if _, werr := f.Write(buf[:n]); werr != nil {
				f.Close()
				os.Remove(tmp)
				return "", werr
			}
			if progress != nil && time.Since(last) > 150*time.Millisecond {
				last = time.Now()
				progress(done, u.Size)
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			f.Close()
			os.Remove(tmp)
			return "", rerr
		}
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return "", err
	}
	if done != u.Size || !strings.EqualFold(hex.EncodeToString(h.Sum(nil)), u.SHA256) {
		os.Remove(tmp)
		return "", fmt.Errorf("%w: file doesn't match", ErrBadUpdate)
	}
	if progress != nil {
		progress(done, u.Size)
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return "", err
	}
	return path, nil
}

// fileMatches reports whether path already holds the update's installer.
func fileMatches(path string, u Update) (bool, error) {
	f, err := os.Open(path)
	if err != nil {
		return false, err
	}
	defer f.Close()
	if fi, err := f.Stat(); err != nil || fi.Size() != u.Size {
		return false, err
	}
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return false, err
	}
	return strings.EqualFold(hex.EncodeToString(h.Sum(nil)), u.SHA256), nil
}
