# Shared by build-windows.sh and build-macos.sh (sourced, not run): reads the
# configuration and sets VERSION and LDFLAGS.
#
# Configuration comes from the environment, or from these files at the
# project root (the environment wins); both are kept out of git:
#   cloud.env  EASTAPE_APP_KEY (required), EASTAPE_API_URL, EASTAPE_UPDATE_KEY
#              (both have defaults in internal/cloud). See web/README.md.
#   relay.env  EASTAPE_RELAY_URL, EASTAPE_RELAY_TOKEN: the email relay for
#              install notices and support messages (optional).
#              See server/apps-script/README.md.

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

VERSION="${VERSION_ARG:-$(sed -n 's/.*"productVersion": *"\([^"]*\)".*/\1/p' wails.json)}"
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
if [[ -n "$EASTAPE_API_URL" ]]; then
  LDFLAGS+=" -X eastape/internal/cloud.APIURL=$EASTAPE_API_URL"
fi
if [[ -n "$EASTAPE_UPDATE_KEY" ]]; then
  LDFLAGS+=" -X eastape/internal/cloud.UpdateKey=$EASTAPE_UPDATE_KEY"
fi
