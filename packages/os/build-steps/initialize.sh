#!/bin/bash

set -euo pipefail

APT_SNAPSHOT_DATE=${1:-}

# Disable the resume from SWAP functionality. This takes significant time during the boot
# process, as it tries to resume using a swap device which never shows up.
mkdir -p /etc/initramfs-tools/conf.d/
echo "RESUME=none" >/etc/initramfs-tools/conf.d/resume

rm /etc/apt/sources.list.d/debian.sources

# All apt packages are pinned to a specific apt snapshot date to ensure reproducibility.
# This means building the same umbrelOS git tag always results in the same
# package versions.
# We should update this to the current date with each release to ensure we
# are always using the latest packages.
cat >/etc/apt/sources.list <<EOF
deb http://snapshot.debian.org/archive/debian/${APT_SNAPSHOT_DATE} trixie main contrib non-free non-free-firmware
deb-src http://snapshot.debian.org/archive/debian/${APT_SNAPSHOT_DATE} trixie main contrib non-free non-free-firmware
deb http://snapshot.debian.org/archive/debian-security/${APT_SNAPSHOT_DATE} trixie-security main contrib non-free non-free-firmware
deb-src http://snapshot.debian.org/archive/debian-security/${APT_SNAPSHOT_DATE} trixie-security main contrib non-free non-free-firmware
deb http://snapshot.debian.org/archive/debian/${APT_SNAPSHOT_DATE} trixie-updates main contrib non-free non-free-firmware
deb-src http://snapshot.debian.org/archive/debian/${APT_SNAPSHOT_DATE} trixie-updates main contrib non-free non-free-firmware
EOF

# This is also needed to avoid issues with apt refusing to install old packages from snapshot repos.
echo 'Acquire::Check-Valid-Until "false";' | tee /etc/apt/apt.conf.d/90snapshot-validuntil

# snapshot.debian.org regularly answers 503 or 504 for minutes at a time, and a
# build fetches over a thousand packages. apt retries those errors 3 times over
# about 7 seconds by default. Retry 10 times instead, which backs off up to
# 30 seconds between attempts and keeps trying each file for about 3 minutes.
echo 'Acquire::Retries "10";' | tee /etc/apt/apt.conf.d/90snapshot-retries

apt-get update --yes

# Upgrade the packages that come with the Debian base image to the versions in
# the apt snapshot. Packages we install come from the snapshot, but without this
# the base image's own packages keep the versions from the image's date and
# miss any security updates released after it.
apt-get upgrade --yes

# Install systemd
#
# We do this here as the Rasperry Pi setup requires Systemd. Without it, it will not
# realize that it runs inside Docker and complain about missing mountpoints during
# the installation.
apt-get install --yes systemd-sysv
