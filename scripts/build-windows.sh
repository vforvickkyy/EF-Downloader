#!/usr/bin/env bash
# Builds build/bin/EastapeDownloader.exe (portable) and
# build/bin/EastapeDownloader-Setup-<version>.exe (installer).
#
# Needs Go, the Wails CLI and NSIS (makensis). Works on Linux, macOS and
# Windows (Git Bash).
#
# The feedback relay (install notices, registration, support form) comes from
# EASTAPE_RELAY_URL / EASTAPE_RELAY_TOKEN, or from relay.env at the project
# root. See server/apps-script/README.md.
set -euo pipefail
cd "$(dirname "$0")/.."

# Values already in the environment win over relay.env.
if [[ -f relay.env ]]; then
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^EASTAPE_RELAY_(URL|TOKEN)$ ]] || continue
    if [[ -z "${!key:-}" ]]; then export "$key=${value%$'\r'}"; fi
  done < relay.env
fi
EASTAPE_RELAY_URL="${EASTAPE_RELAY_URL:-}"
EASTAPE_RELAY_TOKEN="${EASTAPE_RELAY_TOKEN:-}"

VERSION="${1:-$(sed -n 's/.*"productVersion": *"\([^"]*\)".*/\1/p' wails.json)}"
echo "Building Eastape Downloader $VERSION"
if [[ -z "$EASTAPE_RELAY_URL" || -z "$EASTAPE_RELAY_TOKEN" ]]; then
  echo "WARNING: no feedback relay configured. Install notices, registrations and" >&2
  echo "         support messages from this build will never be delivered." >&2
fi

LDFLAGS="-s -w -X main.version=$VERSION"
LDFLAGS+=" -X eastape/internal/feedback.RelayURL=$EASTAPE_RELAY_URL"
LDFLAGS+=" -X eastape/internal/feedback.RelayToken=$EASTAPE_RELAY_TOKEN"
wails build -platform windows/amd64 -trimpath -skipbindings -clean -ldflags "$LDFLAGS"

# The installer's "Terms and Conditions" page: the same documents the app
# shows, as plain text.
LICENSE_TXT="$PWD/build/windows/installer/license.txt"
for doc in terms privacy disclaimer; do
  sed -e 's/^#\{1,3\} //' -e 's/\*\*//g' "frontend/src/legal/$doc.md"
  printf '\n\n'
done > "$LICENSE_TXT"

WAILS_DIR="$(go list -m -f '{{.Dir}}' github.com/wailsapp/wails/v2)"
BOOTSTRAPPER="$WAILS_DIR/internal/webview2runtime/MicrosoftEdgeWebview2Setup.exe"

NSIS_ARGS=(-V2 "-DVERSION=$VERSION" "-DAPP_EXE_SRC=$PWD/build/bin/EastapeDownloader.exe"
  "-DWEBVIEW2_BOOTSTRAPPER=$BOOTSTRAPPER" "-DOUT_DIR=$PWD/build/bin" "-DLICENSE_FILE=$LICENSE_TXT")
if [[ -n "${SIGN_CMD:-}" ]]; then
  NSIS_ARGS+=("-DSIGN_CMD=$SIGN_CMD")
fi
(cd build/windows/installer && makensis "${NSIS_ARGS[@]}" eastape.nsi)

ls -la build/bin
