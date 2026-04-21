#!/bin/bash

set -euo pipefail

apt-get install -y fdisk parted

# Select bootstrapping config based on boot type
BOOT_TYPE="${RECIPE_PARAM_BOOT_TYPE:-grub}"
if [[ "$BOOT_TYPE" == "pi" ]]; then
    BOOTSTRAPPING_FILE="bootstrapping-pi.toml"
else
    BOOTSTRAPPING_FILE="bootstrapping.toml"
fi

install -D -m 644 \
    "${RECIPE_DIR}/files/${BOOTSTRAPPING_FILE}" \
    "/etc/rugix/bootstrapping.toml"

install -D -m 644 \
    "${RECIPE_DIR}/files/state-data.toml" \
    "/etc/rugix/state/data.toml"

install -D -m 644 \
    "${RECIPE_DIR}/files/system.toml" \
    "/etc/rugix/system.toml"

# Install the factory reset hook.
install -D -m 755 \
    "${RECIPE_DIR}/files/hooks/state-reset/prepare.sh" \
    "/etc/rugix/hooks/state-reset/prepare/10-umbrel.sh"
    