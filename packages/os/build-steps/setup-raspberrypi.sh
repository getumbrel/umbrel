#!/bin/bash

set -euo pipefail

# Install GPG (required for dearmoring the key).
apt-get install -y gpg


# Remove any existing firmware and kernels.
rm -rf /boot/firmware
mkdir -p /boot/firmware

# Configure APT with Raspberry Pi sources.
install -m 644 "/build-steps/setup-raspberrypi/raspberrypi.list" "/etc/apt/sources.list.d/"
sed -i "s/RELEASE/trixie/g" "/etc/apt/sources.list.d/raspberrypi.list"

gpg --dearmor \
    < "/build-steps/setup-raspberrypi/raspberrypi.gpg.key" \
    > "/etc/apt/trusted.gpg.d/raspberrypi-archive-stable.gpg"

chmod 644 "/etc/apt/trusted.gpg.d/raspberrypi-archive-stable.gpg"

apt-get update -y
apt-get install -y raspberrypi-archive-keyring


# Install kernel and firmware for Pi 4 and 5.
apt-get install -y \
    initramfs-tools \
    e2fsprogs \
    raspi-firmware \
    firmware-brcm80211 \
    linux-image-rpi-v8 \
    linux-headers-rpi-v8 \
    linux-image-rpi-2712 \
    linux-headers-rpi-2712


# Install boot configuration files.
install -m 644 "/build-steps/setup-raspberrypi/cmdline.txt" "/boot/firmware/"
install -m 644 "/build-steps/setup-raspberrypi/config.txt" "/boot/firmware/"

# XXX: Currently Rugpi expects the files for the boot partition to be directly in
# `/boot` as this was the case before Debian Bookworm. Changing this is a breaking
# change of Rugpi. We may do this with the next major release. If that happens, the
# following two lines can/must be removed.
mv /boot/firmware/* /boot
rm -rf /boot/firmware
