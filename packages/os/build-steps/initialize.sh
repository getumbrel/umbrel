#!/bin/bash

set -euo pipefail


rm /etc/apt/sources.list.d/debian.sources

# All apt packages are pinned to a specific date to ensure reproducibility.
# This means building the same umbrelOS git tag always results in the same
# package versions.
# We should update this to the current date with each release to ensure we
# are always using the latest packages.
SNAPSHOT_DATE=20250907
cat >/etc/apt/sources.list <<EOF
deb http://snapshot.debian.org/archive/debian/${SNAPSHOT_DATE} bookworm main non-free-firmware
deb-src http://snapshot.debian.org/archive/debian/${SNAPSHOT_DATE} bookworm main non-free-firmware
deb http://snapshot.debian.org/archive/debian-security/${SNAPSHOT_DATE} bookworm-security main non-free-firmware
deb-src http://snapshot.debian.org/archive/debian-security/${SNAPSHOT_DATE} bookworm-security main non-free-firmware
deb http://snapshot.debian.org/archive/debian/${SNAPSHOT_DATE} bookworm-updates main non-free-firmware
deb-src http://snapshot.debian.org/archive/debian/${SNAPSHOT_DATE} bookworm-updates main non-free-firmware
EOF

apt-get update --yes

# Install systemd
#
# We do this here as the Rasperry Pi setup requires Systemd. Without it, it will not
# realize that it runs inside Docker and complain about missing mountpoints during
# the installation.
apt-get install --yes systemd-sysv