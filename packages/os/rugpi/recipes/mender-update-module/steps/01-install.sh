#!/bin/bash

set -euo pipefail

mkdir -p /data/mender
echo "device_type=raspberrypi" >/data/mender/device_type

install -D -m 755 "${RECIPE_DIR}/files/reboot" \
    -t /usr/lib/rugpi-mender/bin

install -D -m 755 "${RECIPE_DIR}/files/rugpi-image" \
    -t /usr/share/mender/modules/v3

install -D -m 644 "${RECIPE_DIR}/files/rugpi-reboot-override.conf" \
    -t /etc/systemd/system/mender-client.service.d
