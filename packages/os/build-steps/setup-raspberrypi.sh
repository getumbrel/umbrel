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

# The Pi 4 firmware in raspi-firmware 1.20260915 can't boot from GPT USB or NVMe
# drives when autoboot.txt selects boot partition 2, which is how our A/B layout
# boots. Replace it with the fixed build from raspberrypi/firmware until a
# raspi-firmware release includes the fix.
# https://github.com/raspberrypi/firmware/issues/2047
if [[ "$(dpkg-query --show --showformat='${Version}' raspi-firmware)" != "1:1.20260915-1" ]]; then
    echo "raspi-firmware has been updated, remove the Pi 4 firmware override if it includes the fix for raspberrypi/firmware#2047" >&2
    exit 1
fi
firmware_commit="ab5c7f86283ceb58b7adb269cae1d16092a31bf6"
while read -r checksum firmware_file; do
    curl -fsSL "https://raw.githubusercontent.com/raspberrypi/firmware/${firmware_commit}/boot/${firmware_file}" -o "/tmp/${firmware_file}"
    echo "${checksum}  /tmp/${firmware_file}" | sha256sum -c -
    install -m 644 "/tmp/${firmware_file}" /usr/lib/raspi-firmware/
    install -m 644 "/tmp/${firmware_file}" /boot/firmware/
    rm "/tmp/${firmware_file}"
done <<EOF
38b179897c4514ad11bc915c3fd2d4b68c51e05df2e42240717655ab92d91aeb start4.elf
349d772e90351c4012d9b631f64ee9f0bc7587b44c8da97ef0d8994fabd0ea87 fixup4.dat
EOF


# Install boot configuration files.
install -m 644 "/build-steps/setup-raspberrypi/cmdline.txt" "/boot/firmware/"
install -m 644 "/build-steps/setup-raspberrypi/config.txt" "/boot/firmware/"
