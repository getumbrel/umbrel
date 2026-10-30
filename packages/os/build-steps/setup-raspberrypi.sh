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

# Only take the boot and hardware support packages from the Raspberry Pi repo:
# the kernel, boot firmware, Wi-Fi firmware, initramfs-tools (patched to build
# an initramfs for every Pi kernel flavour), and wpasupplicant (patched to
# report the Pi Wi-Fi's WPA3 support to NetworkManager). Everything else comes
# from the Debian snapshot like on other platforms. Otherwise the Raspberry Pi
# repo's rebuilds of Debian packages (glibc, ffmpeg, mesa, NetworkManager...)
# silently replace Debian's in every later build step, unpinned by the snapshot
# date. The pin persists in the image, so later build steps follow it too.
install -m 644 "/build-steps/setup-raspberrypi/raspberrypi.pref" "/etc/apt/preferences.d/"

apt-get update -y


# Install kernel and firmware for Pi 4 and 5.
apt-get install -y \
    initramfs-tools \
    raspi-firmware \
    firmware-brcm80211 \
    linux-image-rpi-v8 \
    linux-image-rpi-2712


# Install boot configuration files.
install -m 644 "/build-steps/setup-raspberrypi/cmdline.txt" "/boot/firmware/"
install -m 644 "/build-steps/setup-raspberrypi/config.txt" "/boot/firmware/"
