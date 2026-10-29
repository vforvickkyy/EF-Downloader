#!/usr/bin/env bash
# Builds build/bin/EastapeDownloader.exe (portable) and
# build/bin/EastapeDownloader-Setup-<version>.exe (installer).
#
# Needs Go, the Wails CLI and NSIS (makensis). Works on Linux, macOS and
# Windows (Git Bash).
#
# Configuration: see scripts/build-config.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION_ARG="${1:-}"
source scripts/build-config.sh
wails build -platform windows/amd64 -trimpath -skipbindings -clean -ldflags "$LDFLAGS"

# Sign the app itself before it goes into the installer (the installer and
# uninstaller are signed by makensis, below).
if [[ -n "${SIGN_CMD:-}" ]]; then
  "$SIGN_CMD" "$PWD/build/bin/EastapeDownloader.exe"
fi

# The installer's "Terms and Conditions" page: the same documents the app
# shows, as plain text.
LICENSE_TXT="$PWD/build/windows/installer/license.txt"
for doc in terms privacy disclaimer; do
  sed -e 's/^#\{1,3\} //' -e 's/\*\*//g' "frontend/src/legal/$doc.md"
  printf '\n\n'
done > "$LICENSE_TXT"

WAILS_DIR="$(go list -m -f '{{.Dir}}' github.com/wailsapp/wails/v2)"
BOOTSTRAPPER="$WAILS_DIR/internal/webview2runtime/MicrosoftEdgeWebview2Setup.exe"

# On Windows, makensis needs plain Windows paths: Git Bash gives /d/... paths,
# and the Go module path would end up with mixed slashes.
nsis_path() {
  if command -v cygpath >/dev/null; then cygpath -w "$1"; else printf '%s' "$1"; fi
}

NSIS_ARGS=(-V2 "-DVERSION=$VERSION" "-DAPP_EXE_SRC=$(nsis_path "$PWD/build/bin/EastapeDownloader.exe")"
  "-DWEBVIEW2_BOOTSTRAPPER=$(nsis_path "$BOOTSTRAPPER")" "-DOUT_DIR=$(nsis_path "$PWD/build/bin")"
  "-DLICENSE_FILE=$(nsis_path "$LICENSE_TXT")")
if [[ -n "${SIGN_CMD:-}" ]]; then
  NSIS_ARGS+=("-DSIGN_CMD=$SIGN_CMD")
fi
(cd build/windows/installer && makensis "${NSIS_ARGS[@]}" eastape.nsi)

ls -la build/bin
