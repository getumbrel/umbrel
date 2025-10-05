#!/bin/bash

set -euo pipefail

SNAPSHOT_DATE=${1:-}

rm /etc/apt/sources.list.d/debian.sources

# All apt packages are pinned to a specific date to ensure reproducibility.
# This means building the same umbrelOS git tag always results in the same
# package versions.
# We should update this to the current date with each release to ensure we
# are always using the latest packages.
cat >/etc/apt/sources.list <<EOF
deb http://snapshot.debian.org/archive/debian/${SNAPSHOT_DATE} trixie main non-free-firmware
deb-src http://snapshot.debian.org/archive/debian/${SNAPSHOT_DATE} trixie main non-free-firmware
deb http://snapshot.debian.org/archive/debian-security/${SNAPSHOT_DATE} trixie-security main non-free-firmware
deb-src http://snapshot.debian.org/archive/debian-security/${SNAPSHOT_DATE} trixie-security main non-free-firmware
deb http://snapshot.debian.org/archive/debian/${SNAPSHOT_DATE} trixie-updates main non-free-firmware
deb-src http://snapshot.debian.org/archive/debian/${SNAPSHOT_DATE} trixie-updates main non-free-firmware
EOF

# This is also needed to avoid issues with apt refusing to install old packages from snapshot repos.
echo 'Acquire::Check-Valid-Until "false";' | tee /etc/apt/apt.conf.d/90snapshot-validuntil

apt-get update --yes

# Install systemd
#
# We do this here as the Rasperry Pi setup requires Systemd. Without it, it will not
# realize that it runs inside Docker and complain about missing mountpoints during
# the installation.
apt-get install --yes systemd-sysv