#!/bin/bash
# Panasonic Scene installer for macOS
#   curl -fsSL https://seppeva.github.io/panasonicscene/install.sh | bash
# Downloads the latest release from GitHub, checks the SHA-256 checksum and installs the app.
set -euo pipefail
REPO="seppeva/panasonicscene"
APP="Panasonic Scene.app"
# Apple silicon (M1/M2/M3/M4)? sysctl also works when Terminal runs under Rosetta (uname then says x86_64).
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

echo "→ Downloading $ASSET"
curl -fL --progress-bar "$URL" -o "$TMP/$ASSET"
echo "→ Checking checksum"
curl -fsSL "$SUMS" -o "$TMP/SHA256SUMS.txt"
EXPECTED="$(grep " $ASSET\$" "$TMP/SHA256SUMS.txt" | awk '{print $1}')"
ACTUAL="$(shasum -a 256 "$TMP/$ASSET" | awk '{print $1}')"
if [ -z "$EXPECTED" ] || [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "✖ Checksum does not match. Installation cancelled." >&2
  exit 1
fi
echo "→ Unpacking"
ditto -x -k "$TMP/$ASSET" "$TMP"
pkill -f "$APP/Contents/MacOS/" 2>/dev/null || true
rm -rf "$DEST/$APP"
mv "$TMP/$APP" "$DEST/"
xattr -dr com.apple.quarantine "$DEST/$APP" 2>/dev/null || true
echo "✔ Installed in $DEST/$APP"
open "$DEST/$APP"
