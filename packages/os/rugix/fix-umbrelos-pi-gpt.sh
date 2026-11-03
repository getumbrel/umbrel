#!/usr/bin/env bash

set -euo pipefail

# Windows rewrites the primary GPT header of any disk whose first usable LBA isn't
# 34, even when the disk is just plugged in or ejected after flashing. It points the
# header at partition entries in the 32 sectors before the first usable LBA but
# doesn't move them there. UEFI firmware notices the checksum mismatch and falls back
# to the backup GPT, but the Raspberry Pi bootloader follows the pointer, finds no
# partitions and fails to boot. sfdisk defaults the first usable LBA to 2048, so we
# set it to 34, right after the partition entries, which is what Windows expects.
# Only the GPT headers change; the partitions stay where they are, 1 MiB aligned.
IMAGE="/project/build/umbrelos-pi-tryboot/system.img"
sfdisk --dump "${IMAGE}" | sed 's/^first-lba: .*/first-lba: 34/' | sfdisk --no-reread --no-tell-kernel "${IMAGE}"
