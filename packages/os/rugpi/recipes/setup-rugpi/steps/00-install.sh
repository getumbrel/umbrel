#!/bin/bash

set -euo pipefail

apt-get install -y fdisk parted

install -D -m 644 "${RECIPE_DIR}/files/state-data.toml" \
    "/etc/rugpi/state/data.toml"
