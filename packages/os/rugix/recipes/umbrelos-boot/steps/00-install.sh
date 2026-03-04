#!/bin/bash

set -euo pipefail

BOOT_DIR="${RUGIX_LAYER_DIR}/roots/boot"

mkdir -p "${BOOT_DIR}"

case "${RUGIX_ARCH}" in
    "amd64")
        echo "Copying kernel and initrd..."
        cp -L /vmlinuz "${BOOT_DIR}"
        cp -L /initrd.img "${BOOT_DIR}"
        echo "Installing second stage boot script..."
        cp "${RECIPE_DIR}/files/grub.cfg" "${BOOT_DIR}"
        ;;
    "arm64")
        echo "Copying firmware files..."
        cp -rp /boot/firmware/* "${BOOT_DIR}"
        ;;
    *)
        echo "Unsupported architecture '${RUGIX_ARCH}'."
        exit 1
esac
