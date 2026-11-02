#!/bin/bash
# Image-build-only: run before the existing NVIDIA apt-get install, never on a
# running appliance. Caller supplies the vendored Debian patch as argument 1.
set -euo pipefail

[[ $# == 1 && $(id -u) == 0 && $(dpkg --print-architecture) == amd64 ]] || {
    echo 'Usage (root, amd64 image build only): patch-nvidia-kernel.sh PATCH' >&2
    exit 1
}
patch_file=$(readlink -f "$1")
test -s "${patch_file}"
command -v patch >/dev/null
package=nvidia-open-kernel-dkms
version=550.163.01-2
source_dir=/usr/src/nvidia-current-open-550.163.01

# Refuse a different snapshot or an already unpacked/configured driver. Do not
# allow apt to replace a patched tree with another version during configuration.
candidate=$(apt-cache policy "${package}" | awk '/Candidate:/ {print $2}')
[[ ${candidate} == "${version}" ]]
status=$(dpkg-query -W -f='${db:Status-Status}' "${package}" 2>/dev/null || true)
[[ -z ${status} || ${status} == not-installed ]]
test ! -e "${source_dir}"
printf '%s  %s\n' \
    0b296d1e884cfe9c2643f98acbda80b3daf60e32de771b43fd2404d3ced4691b \
    "${patch_file}" | sha256sum -c -

# Satisfy Depends and Pre-Depends before unpacking so the caller's normal apt
# install can configure the package without --fix-broken or re-unpacking it.
# No recommends: the support package must not pull in the DKMS driver early.
apt-get install --yes --no-install-recommends \
    nvidia-installer-cleanup firmware-nvidia-gsp=${version} \
    nvidia-open-kernel-support=${version} dkms

work=$(mktemp -d)
trap 'rm -rf "${work}"' EXIT
cd "${work}"
# Download through the existing authenticated snapshot indices. Unpack only:
# DKMS postinst must not run until after the source has been patched.
apt-get download "${package}=${version}"
deb=${package}_${version}_amd64.deb
[[ $(dpkg-deb -f "${deb}" Package) == "${package}" ]]
[[ $(dpkg-deb -f "${deb}" Version) == "${version}" ]]
dpkg --unpack "${deb}"
[[ $(dpkg-query -W -f='${Version}' "${package}") == "${version}" ]]
[[ $(dpkg-query -W -f='${db:Status-Status}' "${package}") == unpacked ]]
patch --directory="${source_dir}" --batch --forward --fuzz=0 --dry-run -p1 < "${patch_file}"
patch --directory="${source_dir}" --batch --forward --fuzz=0 -p1 < "${patch_file}"
patch --directory="${source_dir}" --batch --reverse --fuzz=0 --dry-run -p1 < "${patch_file}"
# Leave configuration to the caller's existing NVIDIA install (same RUN layer).
# No repository changes, userspace upgrades, module loading or live DKMS work.
