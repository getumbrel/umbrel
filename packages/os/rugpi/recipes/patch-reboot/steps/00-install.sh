#!/bin/bash

set -euo pipefail

install -D -m 755 "${RECIPE_DIR}/files/reboot" \
    -t /usr/sbin
