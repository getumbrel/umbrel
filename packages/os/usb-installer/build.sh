#!/usr/bin/env bash
set -euo pipefail

rootfs_dir="/tmp/rootfs"
iso_image="/tmp/umbrelos-amd64-usb-installer.iso"

echo "Creating directories for ISO image..."
mkdir -p "${rootfs_dir}/boot/grub"

echo "Extracting rootfs..."
tar -xf /data/build/rootfs.tar --directory "${rootfs_dir}"

echo "Creating grub.cfg..."
cat > "${rootfs_dir}/boot/grub/grub.cfg" <<EOF
set default=0
set timeout=5

set gfxmode=auto
insmod all_video
insmod gfxterm
terminal_output gfxterm

menuentry "umbrelOS installer" {
    linux /vmlinuz root=LABEL=UMBRELINSTALLER ro quiet loglevel=0 nomodeset vga=normal fbcon=font:VGA8x16
    initrd /initrd.img
}

menuentry "umbrelOS installer (alt graphics)" {
    linux /vmlinuz root=LABEL=UMBRELINSTALLER ro quiet loglevel=0
    initrd /initrd.img
}
EOF

echo "Creating ISO image..."
grub-mkrescue -o "${iso_image}" -volid "UMBRELINSTALLER" "${rootfs_dir}" -- -hfsplus off

echo "Copying to ./build/..."
mv "${iso_image}" /data/build/

echo "Done!"