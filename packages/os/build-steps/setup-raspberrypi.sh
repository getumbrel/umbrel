#!/bin/bash

set -euo pipefail

# Remove any existing firmware and kernels.
rm -rf /boot/firmware
mkdir -p /boot/firmware

# Install the kernel, firmware and other boot and hardware support packages from
# the Raspberry Pi repo. Everything else comes from the Debian snapshot like on
# other platforms.
#
# The Raspberry Pi repo has no snapshots and its index only lists the latest
# version of each package, so to keep the build reproducible, rather than adding
# it to apt, install the exact packages listed in packages.sha256 from its pool,
# checked against their checksums. update-raspberrypi-packages.sh updates them.
apt-get install -y curl ca-certificates
mkdir -p /tmp/raspberrypi
while read -r checksum package_path; do
    package_file="$(basename "${package_path}")"
    curl -fsSL "https://archive.raspberrypi.com/debian/${package_path}" -o "/tmp/raspberrypi/${package_file}"
    echo "${checksum}  /tmp/raspberrypi/${package_file}" | sha256sum -c -
done < /build-steps/setup-raspberrypi/packages.sha256
apt-get install -y /tmp/raspberrypi/*.deb
rm -rf /tmp/raspberrypi


# Install boot configuration files.
install -m 644 "/build-steps/setup-raspberrypi/cmdline.txt" "/boot/firmware/"
install -m 644 "/build-steps/setup-raspberrypi/config.txt" "/boot/firmware/"
