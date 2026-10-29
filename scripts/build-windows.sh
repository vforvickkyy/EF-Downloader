#!/usr/bin/env bash
# Builds build/bin/EastapeDownloader.exe (portable) and
# build/bin/EastapeDownloader-Setup-<version>.exe (installer).
#
# Needs Go, the Wails CLI and NSIS (makensis). Works on Linux, macOS and
# Windows (Git Bash).
#
# Configuration comes from the environment, or from these files at the
# project root (the environment wins); both are kept out of git:
#   cloud.env  EASTAPE_APP_KEY (required), EASTAPE_API_URL, EASTAPE_UPDATE_KEY
#              (both have defaults in internal/cloud). See web/README.md.
#   relay.env  EASTAPE_RELAY_URL, EASTAPE_RELAY_TOKEN: the email relay for
#              install notices and support messages (optional).
#              See server/apps-script/README.md.
set -euo pipefail
cd "$(dirname "$0")/.."

for file in cloud.env relay.env; do
  [[ -f "$file" ]] || continue
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^EASTAPE_(RELAY_URL|RELAY_TOKEN|API_URL|APP_KEY|UPDATE_KEY)$ ]] || continue
    if [[ -z "${!key:-}" ]]; then export "$key=${value%$'\r'}"; fi
  done < "$file"
done
EASTAPE_RELAY_URL="${EASTAPE_RELAY_URL:-}"
EASTAPE_RELAY_TOKEN="${EASTAPE_RELAY_TOKEN:-}"
EASTAPE_API_URL="${EASTAPE_API_URL:-}"
EASTAPE_APP_KEY="${EASTAPE_APP_KEY:-}"
EASTAPE_UPDATE_KEY="${EASTAPE_UPDATE_KEY:-}"

VERSION="${1:-$(sed -n 's/.*"productVersion": *"\([^"]*\)".*/\1/p' wails.json)}"
echo "Building Eastape Downloader $VERSION"
if [[ -z "$EASTAPE_APP_KEY" ]]; then
  echo "WARNING: no EASTAPE_APP_KEY. This build can't send usage stats, support" >&2
  echo "         messages or check for updates." >&2
fi
if [[ -z "$EASTAPE_RELAY_URL" || -z "$EASTAPE_RELAY_TOKEN" ]]; then
  echo "Note: no email relay configured; install notices and support messages go" >&2
  echo "      to the dashboard only." >&2
fi

LDFLAGS="-s -w -X main.version=$VERSION"
LDFLAGS+=" -X eastape/internal/feedback.RelayURL=$EASTAPE_RELAY_URL"
LDFLAGS+=" -X eastape/internal/feedback.RelayToken=$EASTAPE_RELAY_TOKEN"
LDFLAGS+=" -X eastape/internal/cloud.AppKey=$EASTAPE_APP_KEY"
[[ -n "$EASTAPE_API_URL" ]] && LDFLAGS+=" -X eastape/internal/cloud.APIURL=$EASTAPE_API_URL"
[[ -n "$EASTAPE_UPDATE_KEY" ]] && LDFLAGS+=" -X eastape/internal/cloud.UpdateKey=$EASTAPE_UPDATE_KEY"
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

NSIS_ARGS=(-V2 "-DVERSION=$VERSION" "-DAPP_EXE_SRC=$PWD/build/bin/EastapeDownloader.exe"
  "-DWEBVIEW2_BOOTSTRAPPER=$BOOTSTRAPPER" "-DOUT_DIR=$PWD/build/bin" "-DLICENSE_FILE=$LICENSE_TXT")
if [[ -n "${SIGN_CMD:-}" ]]; then
  NSIS_ARGS+=("-DSIGN_CMD=$SIGN_CMD")
fi
(cd build/windows/installer && makensis "${NSIS_ARGS[@]}" eastape.nsi)

ls -la build/bin
