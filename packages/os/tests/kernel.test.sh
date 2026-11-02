#!/bin/bash
# Run inside the generic umbrelos-base image; never load modules or use uname
# (a build container shares the builder's kernel, not the image's kernel).
set -euo pipefail

minimum_version=6.12.113-1
arch=$(dpkg --print-architecture)

for package in "linux-image-${arch}" "linux-headers-${arch}"; do
    version=$(dpkg-query -W -f='${Version}' "${package}")
    echo "${package}: ${version} (minimum ${minimum_version})"
    dpkg --compare-versions "${version}" ge "${minimum_version}"
done

# Check the actual image and headers, not only the meta-package version. Reject
# any leftover vulnerable kernel that the boot recipe could accidentally select.
for image in /boot/vmlinuz-*; do
    kernel=${image##*/vmlinuz-}
    version=$(dpkg-query -W -f='${Version}' "linux-image-${kernel}")
    dpkg --compare-versions "${version}" ge "${minimum_version}"
    test -s "${image}"
    test -s "/boot/initrd.img-${kernel}"
    test "$(readlink -f /vmlinuz)" = "${image}"
    test "$(readlink -f /initrd.img)" = "/boot/initrd.img-${kernel}"
    test -e "/lib/modules/${kernel}/build/Makefile"
    test "$(dpkg-query -W -f='${Version}' "linux-headers-${kernel}")" = "${version}"
    modinfo -k "${kernel}" zfs >/dev/null
    dkms status -k "${kernel}" | grep -E '^zfs/.*: installed$'
    if dpkg-query -W -f='${Status}' nvidia-open-kernel-dkms 2>/dev/null | grep -qx 'install ok installed'; then
        modinfo -k "${kernel}" nvidia-current-open >/dev/null
        dkms status -k "${kernel}" | grep -E '^nvidia-current-open/.*: installed$'
        echo "PASS: ${kernel}: NVIDIA open module installed"
    fi
    echo "PASS: ${kernel}: signed image, matching headers, initramfs and ZFS module"
done

test -z "$(dpkg --audit)"
echo 'PASS: no vulnerable generic kernel or incomplete packages'
