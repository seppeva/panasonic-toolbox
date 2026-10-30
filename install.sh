#!/bin/bash
# Panasonic Scene — installatie op macOS
#   curl -fsSL https://seppeva.github.io/panasonicscene/install.sh | bash
# Downloadt de laatste release van GitHub, controleert de SHA-256-checksum en installeert de app.
set -euo pipefail
REPO="seppeva/panasonicscene"
APP="Panasonic Scene.app"
# Apple-chip (M1/M2/M3/M4)? sysctl werkt ook als Terminal via Rosetta draait (uname zegt dan x86_64).
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then
  ASSET="PanasonicScene-macOS-AppleSilicon.zip"
else
  ASSET="PanasonicScene-macOS-Intel.zip"
fi
URL="https://github.com/$REPO/releases/latest/download/$ASSET"
SUMS="https://github.com/$REPO/releases/latest/download/SHA256SUMS.txt"
DEST="/Applications"
[ -w "$DEST" ] || DEST="$HOME/Applications"
mkdir -p "$DEST"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "→ Downloaden: $ASSET"
curl -fL --progress-bar "$URL" -o "$TMP/$ASSET"
echo "→ Checksum controleren"
curl -fsSL "$SUMS" -o "$TMP/SHA256SUMS.txt"
EXPECTED="$(grep " $ASSET\$" "$TMP/SHA256SUMS.txt" | awk '{print $1}')"
ACTUAL="$(shasum -a 256 "$TMP/$ASSET" | awk '{print $1}')"
if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "✖ Checksum klopt niet. Installatie afgebroken." >&2
  exit 1
fi
echo "→ Uitpakken"
ditto -x -k "$TMP/$ASSET" "$TMP"
pkill -f "$APP/Contents/MacOS/" 2>/dev/null || true
rm -rf "$DEST/$APP"
mv "$TMP/$APP" "$DEST/"
xattr -dr com.apple.quarantine "$DEST/$APP" 2>/dev/null || true
echo "✔ Geïnstalleerd in $DEST/$APP"
open "$DEST/$APP"
