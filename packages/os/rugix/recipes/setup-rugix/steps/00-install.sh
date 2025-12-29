#!/bin/bash

set -euo pipefail

apt-get install -y fdisk parted

install -D -m 644 \
    "${RECIPE_DIR}/files/bootstrapping-${RUGIX_ARCH}.toml" \
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
    