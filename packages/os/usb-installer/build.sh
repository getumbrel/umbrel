#!/usr/bin/env bash
set -euo pipefail

# Pin the Nix Docker image.
NIX_IMAGE="nixos/nix@sha256:bf1d938835ab96312f098fa6c2e9cab367728e0aad0646ee3e02a787c80d8fb8" # 2.34.7

# Allow running from anywhere
cd "$(dirname $(readlink -f "${BASH_SOURCE[0]}"))"

# Date the final ISO's files by the commit time, so building the same commit
# produces the same ISO. Like ../build.sh, SOURCE_DATE_EPOCH overrides it for
# building without a Git checkout.
source_date_epoch="${SOURCE_DATE_EPOCH:-$(git log -1 --format=%ct 2>/dev/null || date +%s)}"

# Run a command inside the pinned Nix container. The repo's packages/os
# directory is mounted at /data and the Nix store is kept in a named volume
# so consecutive runs (e.g. base build then image injection) are fast.
#
# --privileged lets Nix sandbox its builds (see below).
nix_container() {
    docker run --rm --platform linux/amd64 \
        --privileged \
        --env SOURCE_DATE_EPOCH="${source_date_epoch}" \
        --volume umbrelos-usb-installer-nix:/nix \
        --volume "$(readlink -f ..)":/data \
        --workdir /data/usb-installer \
        "${NIX_IMAGE}" \
        bash -c "$1"
}

# filter-syscalls is disabled so builds also work under QEMU/Rosetta emulation
# (e.g. building the amd64 ISO on an Apple Silicon machine).
#
# The sandbox is enabled (the Nix image disables it) because unsandboxed builds
# run in randomly named directories, and some record that path in their output:
# systemd-hwdb writes its source files' paths into hwdb.bin, so the ISO would
# differ on every build.
nix="nix --extra-experimental-features 'nix-command flakes' --option filter-syscalls false --option sandbox true --print-build-logs"

# Build the installer ISO without an umbrelOS image. This is the slow part of
# the build and doesn't depend on the umbrelOS image, so CI can run it
# concurrently with the umbrelOS image build.
build_base() {
    echo "Building base USB installer ISO..."
    mkdir -p ../build
    nix_container "
        ${nix} build path:.#iso -o /tmp/result &&
        cp -fL /tmp/result/iso/umbrelos-amd64-usb-installer.iso /data/build/umbrelos-amd64-usb-installer-base.iso
    "
}

# Graft build/umbrelos-amd64.img.xz into the base ISO to produce the final
# installer ISO. This is fast so the umbrelOS image can be dropped in as the
# last step of the build.
inject_image() {
    echo "Injecting umbrelOS image into USB installer ISO..."
    rm -f ../build/umbrelos-amd64-usb-installer.iso
    nix_container "
        ${nix} build path:.#inject-umbrelos-image -o /tmp/inject &&
        /tmp/inject/bin/inject-umbrelos-image \
            /data/build/umbrelos-amd64-usb-installer-base.iso \
            /data/build/umbrelos-amd64.img.xz \
            /data/build/umbrelos-amd64-usb-installer.iso
    "
}

command="${1:-all}"
case "${command}" in
    base) build_base ;;
    inject) inject_image ;;
    all) build_base && inject_image ;;
    *) echo "Usage: $0 [base|inject|all]" && exit 1 ;;
esac

# Test CD-ROM boot (used by VMs)
# qemu-system-x86_64 -net nic -net user -machine accel=tcg -m 2048 -bios ~/Downloads/OVMF.bin -cdrom ../build/umbrelos-amd64-usb-installer.iso

# Test USB boot (used by physical machines)
# qemu-system-x86_64 -net nic -net user -machine accel=tcg -m 2048 -bios ~/Downloads/OVMF.bin -drive if=none,id=stick,format=raw,file=../build/umbrelos-amd64-usb-installer.iso -device nec-usb-xhci,id=xhci -device usb-storage,bus=xhci.0,drive=stick
