#!/usr/bin/env bash

set -euo pipefail

# Update the Raspberry Pi packages the Pi image installs
# (build-steps/setup-raspberrypi/packages.sha256) to the latest versions in the
# Raspberry Pi repo.
#
# The repo has no snapshots and its index only lists the latest version of each
# package, so to keep the build reproducible, it installs the exact packages
# listed in the manifest instead of adding the repo to apt. This resolves the packages against the
# repo the same way apt would, with raspberrypi.pref limiting which ones come
# from it, and records the pool path and checksum of each from the repo's
# signed index.

# Allow running from anywhere
cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"

debian_version="$(sed -n 's/^ARG DEBIAN_VERSION=//p' umbrelos.Dockerfile)"
debian_image_snapshot_date="$(sed -n 's/^ARG DEBIAN_IMAGE_SNAPSHOT_DATE=//p' umbrelos.Dockerfile)"
debian_image="debian:${debian_version}-${debian_image_snapshot_date}"
apt_snapshot_date="$(sed -n 's/^ARG APT_SNAPSHOT_DATE=//p' umbrelos.Dockerfile)"

docker run --rm --platform linux/arm64 \
    --env DEBIAN_FRONTEND=noninteractive \
    --volume "$(pwd)/build-steps:/build-steps:ro" \
    "${debian_image}" \
    bash -c '
        set -euo pipefail
        /build-steps/initialize.sh "$1" > /dev/null
        apt-get install --yes gpg > /dev/null
        sed "s/RELEASE/trixie/g" /build-steps/setup-raspberrypi/raspberrypi.list > /etc/apt/sources.list.d/raspberrypi.list
        gpg --dearmor < /build-steps/setup-raspberrypi/raspberrypi.gpg.key > /etc/apt/trusted.gpg.d/raspberrypi.gpg
        cp /build-steps/setup-raspberrypi/raspberrypi.pref /etc/apt/preferences.d/
        apt-get update --yes > /dev/null
        apt-get install --simulate \
            initramfs-tools \
            raspi-firmware \
            firmware-brcm80211 \
            linux-image-rpi-v8 \
            linux-image-rpi-2712 \
            linux-libc-dev \
            wpasupplicant \
            | sed -n "s/^Inst \([^ ]*\) (\([^ ]*\) Raspberry Pi Foundation:.*/\1=\2/p" \
            | while read -r package; do
                apt-cache show --no-all-versions "${package}" \
                    | awk "/^Filename:/ { filename = \$2 } /^SHA256:/ { sha256 = \$2 } END { print sha256 \"  \" filename }"
            done \
            | sort -k 2
    ' bash "${apt_snapshot_date}" > build-steps/setup-raspberrypi/packages.sha256

cat build-steps/setup-raspberrypi/packages.sha256
