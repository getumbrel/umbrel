#!/bin/bash
# Generates a signed Sparkle appcast from notarized Umbrel update archives.
# This script writes only to the supplied archive directory and uploads nothing.
set -euo pipefail

if [[ $# -ne 1 ]]; then
	echo "Usage: bash scripts/generate-appcast.sh <updates-directory>" >&2
	exit 1
fi

UPDATES_DIR="$1"
SPARKLE_VERSION="2.9.6"
SPARKLE_CHECKSUM="8d5fb41d960b43f4a68aa14126bf62b098544ec8d191cdcc73eb14e63a8e7606"
SPARKLE_ARCHIVE_URL="https://github.com/sparkle-project/Sparkle/releases/download/${SPARKLE_VERSION}/Sparkle-for-Swift-Package-Manager.zip"
SPARKLE_KEY_ACCOUNT="${SPARKLE_KEY_ACCOUNT:-umbrel-macos-updates}"
DOWNLOAD_URL_PREFIX="${UMBREL_UPDATE_DOWNLOAD_URL_PREFIX:-https://download.umbrel.com/macos/}"

if [[ ! -d "$UPDATES_DIR" ]]; then
	echo "Updates directory not found: $UPDATES_DIR" >&2
	exit 1
fi

UPDATES_DIR="$(cd "$UPDATES_DIR" && pwd)"
shopt -s nullglob
DMGS=("$UPDATES_DIR"/*.dmg)
shopt -u nullglob

if [[ ${#DMGS[@]} -eq 0 ]]; then
	echo "No DMG update archives found in: $UPDATES_DIR" >&2
	exit 1
fi

# Sparkle can publish a DMG directly. Require the exact artifact users receive
# to carry both its Developer ID signature and Apple's stapled notarization ticket.
for DMG in "${DMGS[@]}"; do
	/usr/bin/codesign --verify --verbose=2 "$DMG"
	/usr/bin/xcrun stapler validate "$DMG"
done

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/umbrel-sparkle.XXXXXX")"
SPARKLE_ARCHIVE="$TEMP_DIR/Sparkle.zip"

cleanup() {
	rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

/usr/bin/curl \
	--fail \
	--location \
	--silent \
	--show-error \
	--output "$SPARKLE_ARCHIVE" \
	"$SPARKLE_ARCHIVE_URL"

printf '%s  %s\n' "$SPARKLE_CHECKSUM" "$SPARKLE_ARCHIVE" \
	| /usr/bin/shasum -a 256 -c -
/usr/bin/unzip -q "$SPARKLE_ARCHIVE" -d "$TEMP_DIR"

# A Markdown file next to a DMG with the same name (Umbrel-<version>-<build>.md) holds
# that release's notes. They're embedded so the update window can show them without
# a second download.
"$TEMP_DIR/bin/generate_appcast" \
	--account "$SPARKLE_KEY_ACCOUNT" \
	--embed-release-notes \
	--download-url-prefix "$DOWNLOAD_URL_PREFIX" \
	"$UPDATES_DIR"

if [[ ! -f "$UPDATES_DIR/appcast.xml" ]]; then
	echo "Sparkle did not generate appcast.xml" >&2
	exit 1
fi

echo "Generated signed appcast: $UPDATES_DIR/appcast.xml"
echo "Upload the update artifacts before publishing appcast.xml."
