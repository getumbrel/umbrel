#!/usr/bin/env bash

set -euo pipefail

LAST_USED_SECTOR=$(sfdisk -l /data/build/umbrelos-pi-mbr/system.img -o end | tail -n1)
TARGET_SIZE=$(( (LAST_USED_SECTOR + 1) * 512 ))
truncate -s ${TARGET_SIZE} "/data/build/umbrelos-pi-mbr/system.img"