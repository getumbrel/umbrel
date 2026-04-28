#!/bin/bash

set -euo pipefail

# Install custom Rugix system configuration for Mender-compatibility.
install -D -m 644 \
    "${RECIPE_DIR}/files/system.toml" \
    "/etc/rugix/system.toml"

# Create kernel and initrd symlinks as required by Mender's Grub configuration.
cd /boot
ln -s initrd* initrd
ln -s vmlinuz* kernel

# To enable state management, Rugix Ctrl must run as the init system prior to Systemd. As
# we cannot change the Kernel commandline parameters, we instead patch `/sbin/init`.
install -D -m 755 \
    "${RECIPE_DIR}/files/init" \
    "/sbin/init"

# Install the state migration hook.
install -D -m 755 \
    "${RECIPE_DIR}/files/migrate-state.sh" \
    "/etc/rugix/hooks/boot/post-init/10-migrate-state.sh"