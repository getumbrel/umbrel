#!/usr/bin/env bash
set -euo pipefail

# Allow running from anywhere
cd "$(dirname $(readlink -f "${BASH_SOURCE[0]}"))"

docker_buildx() {
    docker buildx build --load --platform linux/amd64 $@
}

# This will run on the host machine when this script is called.
# It will setup the Docker build environment and then run this script again inside the container
# passing the --bootstrapped parameter to run the disk image build process.
function bootstrap() {
    release="${1:-}"
    dev="false"
    if [[ "${release}" == "" ]]
    then
        release="$(git rev-parse --short HEAD)-$(date +%s)"
        dev="true"
    fi
    echo "Ensuring the build dir exists..."
    mkdir -p build

    echo "Building Umbrel OS Docker image..."
    # Note we run the build context in ../../ so the build process has access to the entire repo to copy in umbreld stuff.
    docker_buildx --cache-from type=gha,scope=umbrelos --cache-to type=gha,mode=max,scope=umbrelos --file umbrelos.Dockerfile --tag umbrelos ../../

    echo "Dumping Umbrel OS Docker image filesytem into a tar archive..."
    umbrel_os_container_id=$(docker run --detach umbrelos /bin/true)
    docker export --output build/umbrelos.tar "${umbrel_os_container_id}"
    docker rm "${umbrel_os_container_id}"

    echo "Building bootable Umbrel OS disk image from tar archive..."
    docker_buildx --cache-from type=gha,scope=builder --cache-to type=gha,mode=max,scope=builder --file builder.Dockerfile --tag umbrelos:builder .
    docker run --entrypoint /data/build.sh --env UMBREL_OS_DEV_BUILD="${dev}" --env MENDER_ARTIFACT_NAME="${release}" --volume $PWD:/data --privileged umbrelos:builder '--bootstrapped'

    # TODO: Clean up any left behind containers to free up disk space

    # To boot from QEMU
    # qemu-system-x86_64 -net nic -net user,hostfwd=tcp::2222-:22 -machine accel=tcg -cpu max -smp 4 -m 8192 -hda build/umbrelos.img -bios OVMF.fd
}

# This will run inside a container when the --bootstrapped flag is passed
function create_disk_image() {
    echo "Creating disk image..."
    rootfs_tar_size="$(du --block-size 1M /data/build/umbrelos.tar | awk '{print $1}')"
    rootfs_buffer="1024"
    disk_size_mb="$((rootfs_tar_size + rootfs_buffer))"
    disk_size_sector=$(expr $disk_size_mb \* 1024 \* 1024 / 512)
    disk_image="/tmp/disk.img"
    dd if=/dev/zero of="${disk_image}" bs="${disk_size_sector}" count=512

    echo "Creating disk partitions..."
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

    echo "Attaching partitions to loopback devices..."
    efi_start=$(echo "${disk_layout}" -l "${disk_image}" | grep EFI | awk '{print $2}')
    efi_size=$(echo "${disk_layout}" -l "${disk_image}" | grep EFI | awk '{print $4}')
    root_start=$(echo "${disk_layout}" -l "${disk_image}" | grep root | awk '{print $2}')
    root_size=$(echo "${disk_layout}" -l "${disk_image}" | grep root | awk '{print $4}')
    efi_device=$(losetup --offset $((512*efi_start)) --sizelimit $((512*efi_size)) --show --find "${disk_image}")
    root_device=$(losetup --offset $((512*root_start)) --sizelimit $((512*root_size)) --show --find "${disk_image}")

    echo "Formatting partitions..."
    mkfs.vfat -n "ESP" "${efi_device}"
    mkfs.ext4 -L "ROOTFS" "${root_device}"

    echo "Mounting partitions..."
    efi_mount_point="/mnt/efi"
    root_mount_point="/mnt/root"
    mkdir -p "${efi_mount_point}"
    mkdir -p "${root_mount_point}"
    mount "${efi_device}" "${efi_mount_point}"
    mount -t ext4 "${root_device}" "${root_mount_point}"

    echo "Extracting rootfs..."
    tar -xf /data/build/umbrelos.tar --directory "${root_mount_point}"

    echo "Setup hostname..."
    # We need to do this here becuse if we do it in the Dockerfile it gets
    # clobbered when Docker sets a random hostname during `docker run`
    overlay_dir="/data/overlay"
    cp "${overlay_dir}/etc/hostname" "${root_mount_point}/etc/hostname"
    cp "${overlay_dir}/etc/hosts" "${root_mount_point}/etc/hosts"

    echo "Copying boot directory over to ESP partition..."
    cp -r "${root_mount_point}/boot/." "${efi_mount_point}"
    tree "${efi_mount_point}"
    echo

    echo "Unmounting partitions..."
    umount "${root_mount_point}"
    umount "${efi_mount_point}"

    echo "Detaching loopback devices..."
    losetup --detach "${efi_device}"
    losetup --detach "${root_device}"

    echo "Disk image created!"

    echo "Running disk image through mender-convert..."
    cd /mender
    /mender/mender-convert --disk-image "${disk_image}" --config /data/mender.cfg

    echo "Copying to ./build/..."
    mv /mender/deploy/* /data/build/
}

arguments=${@:-}

if [[ "${arguments}" = *"--bootstrapped"* ]]
then
    create_disk_image
else
    bootstrap $@
fi