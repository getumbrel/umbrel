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
deb http://deb.debian.org/debian bookworm-backports main
EOF

apt-get update --yes

# Install systemd
#
# We do this here as the Rasperry Pi setup requires Systemd. Without it, it will not
# realize that it runs inside Docker and complain about missing mountpoints during
# the installation.
apt-get install --yes systemd-sysv

# Install newer kernel and headers
apt-get install --yes -t bookworm-backports linux-image-amd64 linux-headers-amd64

# Install the following packages to support LVM
apt-get install --yes lvm2

# Install additional packages you want to install automatically after every version upgrade
apt-get install --yes powertop

# Install additional drivers from linux-firmware if needed
# The followig drivers are needed for the Intel AX201 WiFi & bluetooth
wget -P /lib/firmware/ https://gitlab.com/kernel-firmware/linux-firmware/-/raw/788aadc8f73d93908cf8545b2fc770fb6580a3f2/iwlwifi-so-a0-hr-b0-89.ucode
wget -P /lib/firmware/intel/ https://gitlab.com/kernel-firmware/linux-firmware/-/raw/788aadc8f73d93908cf8545b2fc770fb6580a3f2/intel/ibt-0040-1050.sfi

# Uncomment the following to allow access to emergency mode if the system fails to boot
# Right after new image deployment. Should only be used for debugging.
# echo "root:Atemporary.Passw0rd" | chpasswd
