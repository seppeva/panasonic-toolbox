#!/bin/bash
# Panasonic Scene — installatie op macOS
#   curl -fsSL https://seppevanaken.be/panasonicscene/install.sh | bash
set -euo pipefail
REPO="seppeva/panasonicscene"
APP="Panasonic Scene.app"
case "$(uname -m)" in
  arm64) ASSET="PanasonicScene-macOS-AppleSilicon.zip" ;;
  *)     ASSET="PanasonicScene-macOS-Intel.zip" ;;
esac
URL="https://github.com/$REPO/releases/latest/download/$ASSET"
DEST="/Applications"
[ -w "$DEST" ] || DEST="$HOME/Applications"
mkdir -p "$DEST"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "→ Downloaden: $ASSET"
curl -fL --progress-bar "$URL" -o "$TMP/app.zip"
echo "→ Uitpakken"
ditto -x -k "$TMP/app.zip" "$TMP"
pkill -f "$APP/Contents/MacOS/" 2>/dev/null || true
rm -rf "$DEST/$APP"
mv "$TMP/$APP" "$DEST/"
xattr -dr com.apple.quarantine "$DEST/$APP" 2>/dev/null || true
echo "✔ Geïnstalleerd in $DEST/$APP"
open "$DEST/$APP"
