#!/usr/bin/env bash

set -euo pipefail

# Rugix Bakery builds images that differ from build to build and machine to
# machine. Replace everything that varies with values derived from the system
# name and SOURCE_DATE_EPOCH, so the same commit builds the same image and
# update bundle anywhere:
#
# - It gives every image random disk and partition GUIDs, and writes the root
#   partition's GUID into the boot partition (Grub's environment on EFI systems,
#   cmdline.txt and a U-Boot environment on Raspberry Pis).
# - FAT filesystems get time-based serial numbers, and are filled in whatever
#   order the host filesystem lists their files.
# - mkfs.ext4 marks filesystems as using signed or unsigned directory hashes
#   depending on the CPU it runs on, and records how many bytes it wrote, which
#   depends on the host filesystem. The hash flag only matters for indexed
#   directories, which mkfs.ext4 doesn't create, so it's safe to set.
#
# Usage: fix-umbrelos-reproducible.sh <system>
SYSTEM="$1"
SYSTEM_DIR="/project/build/${SYSTEM}"
IMAGE="${SYSTEM_DIR}/system.img"
FILESYSTEMS="${SYSTEM_DIR}/filesystems"

derive_uuid() {
    printf '%s' "umbrelos:${SYSTEM}:${SOURCE_DATE_EPOCH}:$1" | sha256sum \
        | sed -E 's/^(.{8})(.{4})(.{4})(.{4})(.{12}).*/\1-\2-\3-\4-\5/'
}

partition_offset() {
    local start
    start="$(sfdisk --dump "${IMAGE}" | sed -n "s|^${IMAGE}$1 : start= *\([0-9]*\),.*|\1|p")"
    echo $(( start * 512 ))
}

# Write a filesystem over its partition in the image.
write_partition() {
    dd if="${FILESYSTEMS}/partition-$1.img" of="${IMAGE}" bs=1M seek="$(partition_offset "$1")" \
        oflag=seek_bytes conv=notrunc status=none
}

# Recreate a FAT filesystem with a derived serial number, adding its files in
# sorted order with their timestamps set to SOURCE_DATE_EPOCH. The optional
# second argument is a command to run on the extracted files first.
rebuild_fat() {
    local partition="$1"
    local filesystem="${FILESYSTEMS}/partition-${partition}.img"
    local files
    files="$(mktemp -d)"
    mcopy -s -n -i "${filesystem}" '::*' "${files}"
    if [ -n "${2:-}" ]; then
        "$2" "${files}"
    fi
    find "${files}" -exec touch --no-dereference --date="@${SOURCE_DATE_EPOCH}" {} +
    local size
    size="$(stat -c %s "${filesystem}")"
    rm "${filesystem}"
    truncate -s "${size}" "${filesystem}"
    mkfs.vfat -i "$(derive_uuid "partition-${partition}-serial" | tr -d - | cut -c1-8)" "${filesystem}" > /dev/null
    (cd "${files}" && find . -mindepth 1 | LC_ALL=C sort) | while read -r path; do
        if [ -d "${files}/${path}" ]; then
            mmd -i "${filesystem}" "::${path#./}"
        else
            mcopy -m -p -i "${filesystem}" "${files}/${path}" "::${path#./}"
        fi
    done
    rm -rf "${files}"
    write_partition "${partition}"
}

# Swap the root partition's GUID in the Raspberry Pi kernel command line and in
# the U-Boot environment, which is checksummed.
patch_pi_boot_files() {
    sed -i "s/PARTUUID=${old_root_uuid}/PARTUUID=${new_root_uuid}/" "$1/cmdline.txt"
    grep -q "PARTUUID=${new_root_uuid}" "$1/cmdline.txt"
    python3 - "$1/boot.env" "PARTUUID=${old_root_uuid}" "PARTUUID=${new_root_uuid}" <<'EOF'
import sys
import zlib

path, old, new = sys.argv[1], sys.argv[2].encode(), sys.argv[3].encode()
env = bytearray(open(path, "rb").read())
assert env.count(old) == 1, "expected the root partition GUID exactly once in boot.env"
env = env.replace(old, new)
env[:4] = zlib.crc32(env[4:]).to_bytes(4, "little")
open(path, "wb").write(env)
EOF
}

# Swap the root partition's GUID in Grub's environment, a fixed-size block, in
# place rather than rebuilding the ext4 filesystem.
patch_grub_environment() {
    local filesystem="${FILESYSTEMS}/partition-$1.img"
    local offsets
    offsets="$(grep --only-matching --byte-offset --binary --text --fixed-strings "PARTUUID=${old_root_uuid}" "${filesystem}" | cut -d: -f1)"
    if [ "$(echo "${offsets}" | wc -w)" != "1" ]; then
        echo "Expected the root partition GUID exactly once in the boot filesystem, found it at: ${offsets}"
        exit 1
    fi
    for target in "${filesystem}:${offsets}" "${IMAGE}:$(( $(partition_offset "$1") + offsets ))"; do
        printf 'PARTUUID=%s' "${new_root_uuid}" \
            | dd of="${target%:*}" bs=1 seek="${target##*:}" conv=notrunc status=none
    done
}

# Mark an ext4 filesystem as using signed directory hashes and reset its count
# of bytes written, in every copy of its superblock.
normalize_ext4() {
    local commands
    commands="$(mktemp)"
    printf 'ssv kbytes_written 0\nssv flags 1\nclose -a\n' > "${commands}"
    debugfs -w -f "${commands}" "${FILESYSTEMS}/partition-$1.img" > /dev/null
    debugfs -w -f "${commands}" "${IMAGE}?offset=$(partition_offset "$1")" > /dev/null
    rm "${commands}"
}

partitions="$(sfdisk --dump "${IMAGE}" | grep -c "^${IMAGE}[0-9]")"

old_root_uuid=""
if [ "${partitions}" -ge 4 ]; then
    old_root_uuid="$(sfdisk --part-uuid "${IMAGE}" 4 | tr '[:upper:]' '[:lower:]')"
fi

echo "Setting disk and partition GUIDs..."
sfdisk --no-reread --no-tell-kernel --disk-id "${IMAGE}" "$(derive_uuid disk)"
for partition in $(seq 1 "${partitions}"); do
    sfdisk --no-reread --no-tell-kernel --part-uuid "${IMAGE}" "${partition}" "$(derive_uuid "partition-${partition}")"
done
if [ -n "${old_root_uuid}" ]; then
    new_root_uuid="$(sfdisk --part-uuid "${IMAGE}" 4 | tr '[:upper:]' '[:lower:]')"
fi

# The bundles carry the boot and system filesystems too, so fix them as well as
# the image.
for partition in $(seq 1 "${partitions}"); do
    filesystem="${FILESYSTEMS}/partition-${partition}.img"
    if [ ! -f "${filesystem}" ]; then
        continue
    fi
    if minfo -i "${filesystem}" :: > /dev/null 2>&1; then
        echo "Recreating FAT filesystem on partition ${partition}..."
        if [ -n "${old_root_uuid}" ] && mtype -i "${filesystem}" ::cmdline.txt 2> /dev/null | grep -q "PARTUUID=${old_root_uuid}"; then
            rebuild_fat "${partition}" patch_pi_boot_files
        else
            rebuild_fat "${partition}"
        fi
    elif dumpe2fs -h "${filesystem}" > /dev/null 2>&1; then
        echo "Normalizing ext4 filesystem on partition ${partition}..."
        if [ "${partition}" = 2 ] && [ -n "${old_root_uuid}" ]; then
            patch_grub_environment "${partition}"
        fi
        normalize_ext4 "${partition}"
    fi
done
