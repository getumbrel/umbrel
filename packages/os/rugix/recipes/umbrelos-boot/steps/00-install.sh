#!/bin/bash

set -euo pipefail

BOOT_DIR="${RUGIX_LAYER_DIR}/roots/boot"

mkdir -p "${BOOT_DIR}"

BOOT_TYPE="${RECIPE_PARAM_BOOT_TYPE:-grub}"

case "${BOOT_TYPE}" in
    "grub")
        echo "Copying kernel and initrd..."
        cp -L /vmlinuz "${BOOT_DIR}"
        cp -L /initrd.img "${BOOT_DIR}"
        echo "Installing second stage boot script..."
        cp "${RECIPE_DIR}/files/grub.cfg" "${BOOT_DIR}"
        ;;
    "pi")
        echo "Copying firmware files..."
        cp -rp /boot/firmware/* "${BOOT_DIR}"
        ;;
    *)
        echo "Unsupported boot type '${BOOT_TYPE}'."
        exit 1
esac
