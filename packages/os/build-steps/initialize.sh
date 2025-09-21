#!/bin/bash

set -euo pipefail

rm /etc/apt/sources.list.d/debian.sources

cat >/etc/apt/sources.list <<EOF
deb http://deb.debian.org/debian bookworm main non-free-firmware
deb-src http://deb.debian.org/debian bookworm main non-free-firmware
deb http://deb.debian.org/debian-security bookworm-security main non-free-firmware
deb-src http://deb.debian.org/debian-security bookworm-security main non-free-firmware
deb http://deb.debian.org/debian bookworm-updates main non-free-firmware
deb-src http://deb.debian.org/debian bookworm-updates main non-free-firmware
EOF

apt-get update --yes

# Install systemd
#
# We do this here as the Rasperry Pi setup requires Systemd. Without it, it will not
# realize that it runs inside Docker and complain about missing mountpoints during
# the installation.
apt-get install --yes systemd-sysv