#!/usr/bin/env bash
# Build the iOS app and install it as a Mac app (iOS-on-Mac, Apple Silicon).
# Usage: bash scripts/build-mac.sh
set -euo pipefail

WORKSPACE="ios/Jeopardy.xcworkspace"
SCHEME="Jeopardy"
CONFIG="ClaudeRelease"
BUILD_DIR="ios/build/ClaudeRelease"
APP_SRC="$BUILD_DIR/Build/Products/Release-iphoneos/Jeopardy.app"
DEST="$HOME/Applications/Jeopardy.app"

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

echo "▸ Installing to ~/Applications/Jeopardy.app…"
rm -rf "$DEST"
mkdir -p "$DEST/Wrapper"
cp -R "$APP_SRC" "$DEST/Wrapper/Jeopardy.app"
ln -s "Wrapper/Jeopardy.app" "$DEST/WrappedBundle"

echo "▸ Launching…"
open "$DEST"
echo "✓ Done"
