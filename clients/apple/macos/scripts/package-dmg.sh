#!/bin/bash
# Packages a Developer ID-signed Umbrel.app for direct distribution.
# This script does not contact Apple or notarize anything.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$PACKAGE_DIR/dist"
APP="$DIST_DIR/Umbrel.app"
BACKGROUND_IMAGE="$PACKAGE_DIR/Resources/dmg-background.png"
PACKAGING_DIR="$PACKAGE_DIR/packaging"
DMG_SETTINGS="$PACKAGING_DIR/dmg-settings.py"
DMG_VALIDATOR="$PACKAGING_DIR/validate-dmg.py"
UV_BIN="$(command -v uv || true)"

if [[ ! -d "$APP" ]]; then
	echo "Build the app before packaging it: bash scripts/build-app.sh" >&2
	exit 1
fi

if [[ -z "$UV_BIN" ]]; then
	echo "uv is required for the pinned DMG packaging tools. Install it with: brew install uv" >&2
	exit 1
fi

for INSTALLER_RESOURCE in "$BACKGROUND_IMAGE" "$DMG_SETTINGS" "$DMG_VALIDATOR" "$PACKAGING_DIR/uv.lock"; do
	if [[ ! -f "$INSTALLER_RESOURCE" ]]; then
		echo "Missing DMG installer resource: $INSTALLER_RESOURCE" >&2
		exit 1
	fi
done

if ! codesign --verify --deep --strict --verbose=2 "$APP"; then
	echo "Umbrel.app does not have a valid code signature" >&2
	exit 1
fi

if ! /usr/bin/lipo "$APP/Contents/MacOS/Umbrel" -verify_arch arm64 x86_64; then
	echo "Umbrel.app must contain both arm64 and x86_64" >&2
	exit 1
fi

for RESOURCE in Assets.car AppIcon.icns default.metallib umbrel-logo.webp; do
	if [[ ! -f "$APP/Contents/Resources/$RESOURCE" ]]; then
		echo "Umbrel.app is missing packaged resource: $RESOURCE" >&2
		exit 1
	fi
done

SPARKLE_BINARY="$APP/Contents/Frameworks/Sparkle.framework/Versions/Current/Sparkle"
if [[ ! -f "$SPARKLE_BINARY" ]]; then
	echo "Umbrel.app is missing its embedded Sparkle framework" >&2
	exit 1
fi

FEED_URL="$(/usr/libexec/PlistBuddy -c 'Print :SUFeedURL' "$APP/Contents/Info.plist")"
PUBLIC_UPDATE_KEY="$(/usr/libexec/PlistBuddy -c 'Print :SUPublicEDKey' "$APP/Contents/Info.plist")"
SIGNED_FEED_REQUIRED="$(/usr/libexec/PlistBuddy -c 'Print :SURequireSignedFeed' "$APP/Contents/Info.plist")"
VERIFY_BEFORE_EXTRACTION="$(/usr/libexec/PlistBuddy -c 'Print :SUVerifyUpdateBeforeExtraction' "$APP/Contents/Info.plist")"

if [[ "$FEED_URL" != https://* || -z "$PUBLIC_UPDATE_KEY" ]]; then
	echo "Umbrel.app must use an HTTPS Sparkle feed and include its public update key" >&2
	exit 1
fi

if [[ "$SIGNED_FEED_REQUIRED" != true || "$VERIFY_BEFORE_EXTRACTION" != true ]]; then
	echo "Umbrel.app must require signed feeds and verify updates before extraction" >&2
	exit 1
fi

SIGNING_AUTHORITY="$(codesign -dvv "$APP" 2>&1 | sed -n 's/^Authority=//p' | head -1)"
if [[ "$SIGNING_AUTHORITY" != Developer\ ID\ Application:* ]]; then
	echo "Umbrel.app must be signed with a Developer ID Application certificate" >&2
	exit 1
fi

SIGNING_FLAGS="$(codesign -dvv "$APP" 2>&1 | sed -n 's/^CodeDirectory .* flags=\([^ ]*\).*/\1/p' | head -1)"
if [[ "$SIGNING_FLAGS" != *runtime* ]]; then
	echo "Umbrel.app must enable Hardened Runtime" >&2
	exit 1
fi

VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")"
BUILD_NUMBER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP/Contents/Info.plist")"
DMG="$DIST_DIR/Umbrel-$VERSION-$BUILD_NUMBER.dmg"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/umbrel-dmg.XXXXXX")"
UNSIGNED_DMG="$TEMP_DIR/Umbrel.dmg"

cleanup() {
	rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

# Finder persists a disk image's window in .DS_Store, but Finder writes that
# file asynchronously. Generate it directly so packaging works without Finder
# and cannot silently lose the branded layout.
UV_PROJECT_ENVIRONMENT="$TEMP_DIR/.venv" "$UV_BIN" run \
	--project "$PACKAGING_DIR" \
	--frozen \
	dmgbuild \
	--settings "$DMG_SETTINGS" \
	-D "app=$APP" \
	-D "background=$BACKGROUND_IMAGE" \
	-D "icon=$APP/Contents/Resources/AppIcon.icns" \
	"Umbrel" \
	"$UNSIGNED_DMG"

UV_PROJECT_ENVIRONMENT="$TEMP_DIR/.venv" "$UV_BIN" run \
	--project "$PACKAGING_DIR" \
	--frozen \
	python "$DMG_VALIDATOR" "$UNSIGNED_DMG"

rm -f "$DMG"
mv "$UNSIGNED_DMG" "$DMG"

# Sign the DMG with the certificate Xcode chose for the app. Renewed Developer ID
# certificates share a name, so select it by SHA-1.
codesign -d --extract-certificates="$TEMP_DIR/app-certificate" "$APP" 2>/dev/null
SIGNING_IDENTITY="$(shasum -a 1 "$TEMP_DIR/app-certificate0" | cut -d ' ' -f 1)"
codesign \
	--force \
	--sign "$SIGNING_IDENTITY" \
	--timestamp \
	"$DMG"
codesign --verify --verbose=2 "$DMG"
hdiutil verify "$DMG" >/dev/null

UV_PROJECT_ENVIRONMENT="$TEMP_DIR/.venv" "$UV_BIN" run \
	--project "$PACKAGING_DIR" \
	--frozen \
	python "$DMG_VALIDATOR" "$DMG"

echo "Packaged: $DMG"
echo "The DMG is signed but not notarized. Do not share it yet."
