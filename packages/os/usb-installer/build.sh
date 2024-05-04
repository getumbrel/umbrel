#!/usr/bin/env bash

echo "Creating disk image..."
rootfs_tar_size="$(du --block-size 1M /data/build/rootfs.tar | awk '{print $1}')"
rootfs_buffer="512"
disk_size_mb="$((rootfs_tar_size + rootfs_buffer))"
disk_size_sector=$(expr $disk_size_mb \* 1024 \* 1024 / 512)
disk_image="/data/build/umbrelos-amd64-usb-installer.img"
dd if=/dev/zero of="${disk_image}" bs="${disk_size_sector}" count=512

echo Creating disk partitions...
gpt_efi="ef00"
gpt_root_amd64="8304"
sgdisk \
    --new 1:2048:+200M \
    --typecode 1:"${gpt_efi}" \
    --change-name 1:ESP \
    --new 2:0:0 \
    --typecode 2:"${gpt_root_amd64}" \
    --change-name 1:ROOTFS \
    "${disk_image}"

disk_layout=$(fdisk -l "${disk_image}")
echo "${disk_layout}" 

echo Attaching partitions to loopback devices...
efi_start=$(echo "${disk_layout}" -l "${disk_image}" | grep EFI | awk '{print $2}')
efi_size=$(echo "${disk_layout}" -l "${disk_image}" | grep EFI | awk '{print $4}')
root_start=$(echo "${disk_layout}" -l "${disk_image}" | grep root | awk '{print $2}')
root_size=$(echo "${disk_layout}" -l "${disk_image}" | grep root | awk '{print $4}')
efi_device=$(losetup --offset $((512*efi_start)) --sizelimit $((512*efi_size)) --show --find "${disk_image}")
root_device=$(losetup --offset $((512*root_start)) --sizelimit $((512*root_size)) --show --find "${disk_image}")

echo Formatting partitions...
mkfs.vfat -n "ESP" "${efi_device}"
mkfs.ext4 -L "ROOTFS" "${root_device}"

echo Mounting partitions...
efi_mount_point="/mnt/efi"
root_mount_point="/mnt/root"
mkdir -p "${efi_mount_point}"
mkdir -p "${root_mount_point}"
mount "${efi_device}" "${efi_mount_point}"
mount -t ext4 "${root_device}" "${root_mount_point}"

echo Extracting rootfs...
tar -xf /data/build/rootfs.tar --directory "${root_mount_point}"

echo Copying boot directory over to ESP partition...
cp -r "${root_mount_point}/boot/." "${efi_mount_point}"
tree "${efi_mount_point}"
echo

echo Unmounting partitions...
umount "${root_mount_point}"
umount "${efi_mount_point}"

echo Detaching loopback devices...
losetup --detach "${efi_device}"
losetup --detach "${root_device}"

echo "Compressing image..."
xz --keep --threads 0 --force "${disk_image}"

echo Done!