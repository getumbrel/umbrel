#!/usr/bin/env bash
set -euo pipefail

mkdir -p build
docker build -f usb-installer.Dockerfile --platform linux/amd64 -t usb-installer ../
docker export -o build/rootfs.tar $(docker run -d usb-installer /bin/true)
docker build -f builder.Dockerfile --platform linux/amd64 -t usb-installer:builder .
docker run --entrypoint /data/build.sh -v $PWD:/data --privileged --platform linux/amd64 usb-installer:builder

# Test CD-ROM boot (used by VMs)
# qemu-system-x86_64 -net nic -net user -machine accel=tcg -m 2048 -bios ~/Downloads/OVMF.bin -cdrom umbrelos-amd64-usb-installer.iso

# Test USB boot (used by physical machines)
# qemu-system-x86_64 -net nic -net user -machine accel=tcg -m 2048 -bios ~/Downloads/OVMF.bin -drive if=none,id=stick,format=raw,file=umbrelos-amd64-usb-installer.iso -device nec-usb-xhci,id=xhci -device usb-storage,bus=xhci.0,drive=stick