#!/bin/bash
# Builds a real macOS app archive through Xcode.
#
# With no signing identity, exports an Apple Development-signed app for local testing.
# Set UMBREL_SIGNING_IDENTITY to export a Developer ID-signed app for distribution.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MACOS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(/usr/bin/git -C "$MACOS_DIR" rev-parse --show-toplevel)"
DIST_DIR="$MACOS_DIR/dist"
APP="$DIST_DIR/Umbrel.app"
BUILD_DIR="$MACOS_DIR/.build/xcode"
ARCHIVE_PATH="$BUILD_DIR/Umbrel.xcarchive"
EXPORT_DIR="$BUILD_DIR/export"
EXPORT_OPTIONS="$BUILD_DIR/ExportOptions.plist"
SIGNING_IDENTITY="${UMBREL_SIGNING_IDENTITY:-}"
TEAM_ID="${UMBREL_TEAM_ID:-JABS8D63XG}"
XCODEGEN_BIN="$(command -v xcodegen || true)"
SYSTEM_TOOL_PATH="/usr/bin:/bin:/usr/sbin:/sbin"

if [[ -z "$XCODEGEN_BIN" ]]; then
	echo "xcodegen is required. Install it with: brew install xcodegen" >&2
	exit 1
fi

if [[ -n "$SIGNING_IDENTITY" ]]; then
	WORKTREE_STATUS="$(/usr/bin/git -C "$REPO_ROOT" status --porcelain)"
	if [[ -n "$WORKTREE_STATUS" ]]; then
		echo "Refusing to create a distribution build from a dirty worktree." >&2
		exit 1
	fi
fi

cd "$MACOS_DIR"
"$XCODEGEN_BIN" generate

rm -rf "$BUILD_DIR" "$APP"
mkdir -p "$BUILD_DIR" "$DIST_DIR"

ARCHIVE_ARGS=(
	-project "$MACOS_DIR/Umbrel.xcodeproj"
	-scheme Umbrel
	-configuration Release
	-destination generic/platform=macOS
	-archivePath "$ARCHIVE_PATH"
	ARCHS="arm64 x86_64"
	ONLY_ACTIVE_ARCH=NO
)

if [[ -z "$SIGNING_IDENTITY" ]]; then
	echo "Archiving Umbrel for local testing..."
	/usr/bin/env PATH="$SYSTEM_TOOL_PATH" /usr/bin/xcodebuild \
		"${ARCHIVE_ARGS[@]}" \
		DEVELOPMENT_TEAM="$TEAM_ID" \
		-allowProvisioningUpdates \
		-allowProvisioningDeviceRegistration \
		archive

	/usr/bin/ditto "$ARCHIVE_PATH/Products/Applications/Umbrel.app" "$APP"
else
	echo "Archiving Umbrel for Developer ID distribution..."
	/usr/bin/env PATH="$SYSTEM_TOOL_PATH" /usr/bin/xcodebuild \
		"${ARCHIVE_ARGS[@]}" \
		DEVELOPMENT_TEAM="$TEAM_ID" \
		-allowProvisioningUpdates \
		archive

	/usr/bin/plutil -create xml1 "$EXPORT_OPTIONS"
	/usr/bin/plutil -insert destination -string export "$EXPORT_OPTIONS"
	/usr/bin/plutil -insert method -string developer-id "$EXPORT_OPTIONS"
	/usr/bin/plutil -insert signingStyle -string automatic "$EXPORT_OPTIONS"
	/usr/bin/plutil -insert signingCertificate -string "$SIGNING_IDENTITY" "$EXPORT_OPTIONS"
	/usr/bin/plutil -insert teamID -string "$TEAM_ID" "$EXPORT_OPTIONS"

	/usr/bin/env PATH="$SYSTEM_TOOL_PATH" /usr/bin/xcodebuild \
		-exportArchive \
		-archivePath "$ARCHIVE_PATH" \
		-exportPath "$EXPORT_DIR" \
		-exportOptionsPlist "$EXPORT_OPTIONS" \
		-allowProvisioningUpdates

	/usr/bin/ditto "$EXPORT_DIR/Umbrel.app" "$APP"
fi

EXPECTED_APP_IDENTIFIER="${TEAM_ID}.com.umbrel.mac"
if [[ ! -f "$APP/Contents/embedded.provisionprofile" ]]; then
	echo "Umbrel.app is missing its embedded provisioning profile" >&2
	exit 1
fi

SIGNED_APP_IDENTIFIER="$(
	/usr/bin/codesign -d --entitlements :- "$APP" 2>/dev/null \
		| /usr/bin/plutil -extract 'com\.apple\.application-identifier' raw -o - -
)"
SIGNED_KEYCHAIN_GROUP="$(
	/usr/bin/codesign -d --entitlements :- "$APP" 2>/dev/null \
		| /usr/bin/plutil -extract keychain-access-groups.0 raw -o - -
)"
if [[ "$SIGNED_APP_IDENTIFIER" != "$EXPECTED_APP_IDENTIFIER" \
	|| "$SIGNED_KEYCHAIN_GROUP" != "$EXPECTED_APP_IDENTIFIER" ]]; then
	echo "Umbrel.app is missing its private Data Protection Keychain identity" >&2
	exit 1
fi

# Newer lipo accepts only one architecture per -verify_arch.
if ! /usr/bin/lipo "$APP/Contents/MacOS/Umbrel" -verify_arch arm64 \
	|| ! /usr/bin/lipo "$APP/Contents/MacOS/Umbrel" -verify_arch x86_64; then
	echo "Umbrel.app is not a universal arm64/x86_64 build" >&2
	exit 1
fi

/usr/bin/codesign --verify --deep --strict --verbose=2 "$APP"

VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")"
BUILD_NUMBER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP/Contents/Info.plist")"

echo "Built: $APP"
echo "Version: $VERSION ($BUILD_NUMBER)"
