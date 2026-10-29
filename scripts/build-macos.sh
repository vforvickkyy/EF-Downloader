#!/usr/bin/env bash
# Builds "build/bin/Eastape Downloader.app" (for Apple silicon and Intel) and
# build/bin/EastapeDownloader-<version>-mac.dmg.
#
# Runs on a Mac: needs Go, the Wails CLI and Xcode's command line tools.
#
# Configuration: see scripts/build-config.sh. Signing is optional:
#   MAC_SIGN_IDENTITY   a "Developer ID Application: …" certificate in the
#                       keychain. Without it the app is signed ad hoc, and
#                       macOS asks people to approve it the first time they
#                       open it (System Settings > Privacy & Security).
#   APPLE_ID, APPLE_APP_PASSWORD
#                       with MAC_SIGN_IDENTITY: notarize the disk image with
#                       Apple (APPLE_APP_PASSWORD is an app-specific password).
#                       APPLE_TEAM_ID defaults to the one in the certificate
#                       name.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname)" != Darwin ]]; then
  echo "build-macos.sh runs on a Mac." >&2
  exit 1
fi

VERSION_ARG="${1:-}"
source scripts/build-config.sh
wails build -platform darwin/universal -trimpath -skipbindings -clean -ldflags "$LDFLAGS"

APP="build/bin/Eastape Downloader.app"
DMG="build/bin/EastapeDownloader-$VERSION-mac.dmg"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The Mac icon has the standard padding and shadow (scripts/make-icons.py).
ICONSET="$WORK/icon.iconset"
mkdir "$ICONSET"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" build/darwin/icon.png --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  sips -z $((size * 2)) $((size * 2)) build/darwin/icon.png --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/iconfile.icns"

if [[ -n "${MAC_SIGN_IDENTITY:-}" ]]; then
  codesign --force --options runtime --timestamp --sign "$MAC_SIGN_IDENTITY" "$APP"
else
  codesign --force --sign - "$APP"
fi
codesign --verify --strict --verbose=2 "$APP"

# The disk image: the app next to a shortcut to Applications.
mkdir "$WORK/dmg"
cp -R "$APP" "$WORK/dmg/"
ln -s /Applications "$WORK/dmg/Applications"
for attempt in 1 2 3; do
  # hdiutil sometimes reports "Resource busy" right after a build.
  hdiutil create -volname "Eastape Downloader" -srcfolder "$WORK/dmg" -ov -format UDZO "$DMG" && break
  [[ $attempt == 3 ]] && exit 1
  sleep 5
done

if [[ -n "${MAC_SIGN_IDENTITY:-}" ]]; then
  codesign --force --timestamp --sign "$MAC_SIGN_IDENTITY" "$DMG"
  # "Developer ID Application: Name (TEAMID)" carries the Team ID.
  APPLE_TEAM_ID="${APPLE_TEAM_ID:-$(sed -n 's/.*(\([A-Z0-9]\{10\}\))$/\1/p' <<<"$MAC_SIGN_IDENTITY")}"
  if [[ -n "${APPLE_ID:-}" && -n "$APPLE_TEAM_ID" && -n "${APPLE_APP_PASSWORD:-}" ]]; then
    echo "Sending the disk image to Apple for notarization (usually a few minutes)..."
    RESULT="$(xcrun notarytool submit "$DMG" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" \
      --password "$APPLE_APP_PASSWORD" --wait --output-format json)" || true
    echo "$RESULT"
    STATUS="$(plutil -extract status raw -o - - <<<"$RESULT" 2>/dev/null || true)"
    if [[ "$STATUS" != Accepted ]]; then
      # Apple's log says exactly what it rejected.
      ID="$(plutil -extract id raw -o - - <<<"$RESULT" 2>/dev/null || true)"
      [[ -n "$ID" ]] && xcrun notarytool log "$ID" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_PASSWORD"
      echo "Notarization failed: ${STATUS:-no result}" >&2
      exit 1
    fi
    xcrun stapler staple "$DMG"
  else
    echo "Note: signed but not notarized (set APPLE_ID and APPLE_APP_PASSWORD to notarize)." >&2
  fi
fi

ls -la build/bin
