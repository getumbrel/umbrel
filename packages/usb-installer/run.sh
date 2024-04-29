#!/usr/bin/env bash
set -euo pipefail

mkdir -p build
docker build -f umbrel-os.Dockerfile --platform linux/amd64 -t umbrel-os ../
docker export -o build/rootfs.tar $(docker run -d umbrel-os /bin/true)
docker build -f builder.Dockerfile -t umbrel-os:builder .
docker run -it --entrypoint /data/build.sh -v $PWD:/data --privileged umbrel-os:builder

# qemu-system-x86_64 -net nic -net user -machine accel=tcg -m 2048 -hda build/disk.img -bios OVMF.fd