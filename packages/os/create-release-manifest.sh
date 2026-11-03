#!/usr/bin/env bash
set -euo pipefail

# Write the manifest and release notes for the files in a release directory:
#
#   ./create-release-manifest.sh release
#
# manifest.txt is the release's record of what it contains, which never changes. It has umbreld's version
# and versionName, which is what the release calls itself once it's installed, is dated by the commit it
# was built from, like the reproducible build, names that commit, or unknown outside a Git checkout, so
# anyone can rebuild the release from it, and pins every file by its SHA-256, and each Rugix update bundle also by the bundle
# hash build.sh recorded, which devices pass to `rugix-ctrl update install --bundle-hash`, and by the
# boot flow and architecture of the devices that install it. A release's update.sh, copied in from
# packages/os/update.sh if there is one, is its update script, which devices run to install the
# release. A release built by CI also pins its Docker image, from DOCKER_IMAGE, by its index digest.
# It's in schema 1, which packages/umbreld/source/modules/update/release-signing.ts describes. CI
# timestamps it with OpenTimestamps.
#
# release-notes.md is a copy of release-notes/<version>.md, which a release tagged with its version
# must have. Release signers sign both files with ./scripts/release-signing sign, which saves their
# signatures to manifest.txt.sig and release-notes.md.sig.
#
# Check downloaded files against the manifest with ./scripts/release-signing verify <release> --files
# <directory>, or without the tools:
#
#   awk '$1 == "File:" {print substr($3, 8) "  " $2}' manifest.txt | shasum -a 256 --check --ignore-missing

release_directory="$(cd "${1:?Usage: $0 <release directory>}" && pwd)"
manifest="${release_directory}/manifest.txt"

cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
shopt -s nullglob
# Files are listed in byte order, whatever the machine's language, so the same release always gives the
# same manifest, and devices, which install the first bundle for them, the same bundle
export LC_ALL=C

build_directory="${BUILD_DIRECTORY:-build}"
release_notes_directory="${RELEASE_NOTES_DIRECTORY:-release-notes}"

# The Rugix boot flow and Debian architecture of the devices that install each update bundle. Devices
# install the first bundle in the manifest for theirs, so a bundle for only some of them, like one kind
# of hardware, has to be listed after the bundle the rest install.
bundle_devices() {
    case "$1" in
        # Natively flashed amd64 devices
        umbrelos-amd64.update) echo "boot-flow:grub arch:amd64" ;;
        # amd64 devices first flashed with Mender and since migrated to Rugix, which keep Mender's
        # partition layout and boot flow
        umbrelos-amd64-legacy.update) echo "boot-flow:mender-grub arch:amd64" ;;
        umbrelos-pi.update) echo "boot-flow:rpi-tryboot arch:arm64" ;;
    esac
}

version="$(jq --exit-status --raw-output .version ../umbreld/package.json)"
name="$(jq --exit-status --raw-output .versionName ../umbreld/package.json)"
# Devices compare the manifest's version, which is umbreld's, with their own, so a release tagged with a
# version has to be that version
if [[ "${RELEASE_TAG:-}" =~ ^[0-9]+\.[0-9]+\.[0-9]+ && "${RELEASE_TAG}" != "${version}" ]]; then
    echo "The ${RELEASE_TAG} tag doesn't match umbreld's version ${version}" >&2
    exit 1
fi
# The commit's time, which SOURCE_DATE_EPOCH gives for a checkout without its history, like build.sh
source_date_epoch="${SOURCE_DATE_EPOCH:-$(git log -1 --format=%ct 2>/dev/null || date +%s)}"
commit="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
date="$(date -u -d "@${source_date_epoch}" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -r "${source_date_epoch}" +%Y-%m-%dT%H:%M:%SZ)"
release_notes="${release_notes_directory}/${version}.md"
if [[ "${RELEASE_TAG:-}" == "${version}" && ! -f "${release_notes}" ]]; then
    echo "Release notes for ${version} are missing from packages/os/${release_notes}" >&2
    exit 1
fi
if [[ ! "${name}" =~ ^[^[:space:]] ]]; then
    echo "umbreld's versionName isn't a name devices can show: ${name}" >&2
    exit 1
fi
# The image index's digest, like ghcr.io/getumbrel/umbrelos@sha256:<hex>, covers every platform's image
docker_image="${DOCKER_IMAGE:-}"
if [[ -n "${RELEASE_TAG:-}" && -z "${docker_image}" ]]; then
    echo "DOCKER_IMAGE is missing, which a release built by CI pins" >&2
    exit 1
fi
if [[ -n "${docker_image}" && ! "${docker_image}" =~ ^[a-z0-9.-]+(/[a-z0-9._-]+)+@sha256:[0-9a-f]{64}$ ]]; then
    echo "DOCKER_IMAGE has to be an image by its digest, like ghcr.io/getumbrel/umbrelos@sha256:<hex>: ${docker_image}" >&2
    exit 1
fi

{
    echo "--- umbrelOS Manifest ---"
    echo "Schema: 1"
    echo "Version: ${version}"
    echo "Name: ${name}"
    echo "Date: ${date}"
    echo "Commit: ${commit}"
    if [[ -n "${docker_image}" ]]; then
        echo "Docker-Image: ${docker_image}"
    fi
    for file in "${release_directory}"/*; do
        file_name="$(basename "${file}")"
        # The release's own files, which are signed separately, so its release notes can change
        if [[ ! -f "${file}" || "${file_name}" == manifest.txt* || "${file_name}" == release-notes.md* ]]; then
            continue
        fi
        if [[ ! "${file_name}" =~ ^[A-Za-z0-9._+-]+$ ]]; then
            echo "Release file names can only contain letters, numbers and ._+-: ${file_name}" >&2
            exit 1
        fi

        line="File: ${file_name} sha256:$(shasum --algorithm 256 "${file}" | cut -d ' ' -f 1)"
        if [[ -f "${build_directory}/${file_name}.hash" ]]; then
            bundle_hash="$(cat "${build_directory}/${file_name}.hash")"
            if [[ ! "${bundle_hash}" =~ ^[a-z0-9-]+:[0-9a-f]+$ ]]; then
                echo "Invalid bundle hash in ${build_directory}/${file_name}.hash" >&2
                exit 1
            fi
            line="${line} bundle:${bundle_hash}"
            devices="$(bundle_devices "${file_name}")"
            if [[ -z "${devices}" ]]; then
                echo "No devices install ${file_name}: add its boot flow and architecture to bundle_devices" >&2
                exit 1
            fi
            line="${line} ${devices}"
        elif [[ "${file_name}" == *.update && "${file_name}" != *-legacy-migration.update ]]; then
            # Devices can't install a bundle the manifest doesn't pin a bundle hash for. Only the legacy
            # update script installs Mender's migration bundles, which build.sh doesn't hash.
            echo "No bundle hash for ${file_name} in ${build_directory}/" >&2
            exit 1
        fi
        if [[ "${file_name}" == update.sh ]]; then
            line="${line} type:update-script"
        fi
        echo "${line}"
    done
} > "${manifest}.partial"

# A release devices can't update to is a mistake
if ! grep --quiet ' bundle:.* boot-flow:' "${manifest}.partial"; then
    echo "No update bundles found in ${release_directory}/" >&2
    exit 1
fi
mv "${manifest}.partial" "${manifest}"

# A test build without release notes has empty ones
if [[ -f "${release_notes}" ]]; then
    cp "${release_notes}" "${release_directory}/release-notes.md"
else
    : > "${release_directory}/release-notes.md"
fi
