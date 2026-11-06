#!/usr/bin/env bash
set -euo pipefail

mkdir -p build
docker build -f usb-installer.Dockerfile --platform linux/amd64 -t usb-installer ../
docker export -o build/rootfs.tar $(docker run -d usb-installer /bin/true)
docker build -f builder.Dockerfile -t usb-installer:builder .
docker run -it --entrypoint /data/build.sh -v $PWD:/data --privileged usb-installer:builder

# qemu-system-x86_64 -net nic -net user -machine accel=tcg -m 2048 -hda build/umbrelos-amd64-usb-installer.img -bios OVMF.fd