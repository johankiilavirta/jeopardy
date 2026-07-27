#!/usr/bin/env bash
# Build the iOS app and install it as a Mac app (iOS-on-Mac, Apple Silicon).
# Usage: bash scripts/build-mac.sh
set -euo pipefail

WORKSPACE="ios/Jeopardy.xcworkspace"
SCHEME="Jeopardy"
CONFIG="Release"
BUILD_DIR="ios/build/MacRelease"
APP_SRC="$BUILD_DIR/Build/Products/Release-iphoneos/Jeopardy.app"
CURRENT_USER="$(id -un)"
DEST_DIR="/Users/$CURRENT_USER/Applications"
DEST="$DEST_DIR/Jeopardy.app"

echo "▸ Building $SCHEME ($CONFIG)…"
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration "$CONFIG" \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$BUILD_DIR" \
  build | xcpretty 2>/dev/null || \
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration "$CONFIG" \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$BUILD_DIR" \
  build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)"

echo "▸ Quitting Jeopardy if running…"
osascript -e 'quit app "Jeopardy"' 2>/dev/null || true
sleep 1

if [[ "$DEST" != /Users/*/Applications/Jeopardy.app ]]; then
  echo "Refusing unexpected install destination: $DEST" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
if [[ -e "$DEST" ]]; then
  BACKUP="$DEST_DIR/Jeopardy.previous-$(date +%Y%m%d-%H%M%S).app"
  echo "▸ Moving the previous app to ${BACKUP}…"
  mv "$DEST" "$BACKUP"
fi

echo "▸ Installing to ${DEST}…"
mkdir -p "$DEST/Wrapper"
cp -R "$APP_SRC" "$DEST/Wrapper/Jeopardy.app"
ln -s "Wrapper/Jeopardy.app" "$DEST/WrappedBundle"

echo "▸ Launching…"
open "$DEST"
echo "✓ Done"
