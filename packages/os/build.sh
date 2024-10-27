#!/usr/bin/env bash
set -euo pipefail

# Pin the Rugpi Docker image.
export RUGPI_BAKERY_IMAGE="ghcr.io/silitics/rugpi-bakery@sha256:ed8b522d3511434dc351bc6576bb56d9fbbc4b596f4189bd487ae9db40789901" # v0.6.5

# Allow running from anywhere
cd "$(dirname $(readlink -f "${BASH_SOURCE[0]}"))"

docker_buildx() {
    docker buildx build --load $@
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

    # Enable QEMU/binfmt-based multi-platform support for building arm64 on
    # amd64 or vice versa, e.g. to build for Pi 5 on an x86 system.
    docker run --privileged --rm tonistiigi/binfmt --install all

    if [ -z "${SKIP_ARM64:-}" ]; then
        build_root_fs arm64 "${release}"
        build_rugpi_images
    fi
    if [ -z "${SKIP_AMD64:-}" ]; then
        build_root_fs amd64 "${release}"
    fi

    echo "Building bootable Umbrel OS disk image from tar archive..."
    docker_buildx --platform "linux/amd64" --cache-from type=gha,scope=builder --cache-to type=gha,mode=max,scope=builder --file builder.Dockerfile --tag umbrelos:builder .
    docker run \
        --platform "linux/amd64" \
        --entrypoint /data/build.sh \
        --env UMBREL_OS_DEV_BUILD="${dev}" \
        --env MENDER_ARTIFACT_NAME="${release}" \
        --env SKIP_ARM64="${SKIP_ARM64:-}" \
        --env SKIP_AMD64="${SKIP_AMD64:-}" \
        --env SKIP_PI4="${SKIP_PI4:-}" \
        --env SKIP_PI5="${SKIP_PI5:-}" \
        --env SKIP_MENDER="${SKIP_MENDER:-}" \
        --volume $PWD:/data \
        --privileged \
        umbrelos:builder \
        '--bootstrapped'

    # TODO: Clean up any left behind containers to free up disk space

    # To boot from QEMU
    # qemu-system-x86_64 -net nic -net user,hostfwd=tcp::2222-:22 -machine accel=tcg -cpu max -smp 4 -m 8192 -hda build/umbrelos.img -bios OVMF.fd
}

# Build the root filesystem.
#
# Arguments: <arch> <release>
function build_root_fs() {
    local arch=$1;
    local release=$2;

    echo "Ensuring the build dir exists..."
    mkdir -p build

    echo "Building Umbrel OS Docker image..."
    # Note that we run the build context in ../../ so the build process has access to the
    # entire repo to copy in umbreld stuff.
    docker_buildx \
        --cache-from type=gha,scope=umbrelos \
        --cache-to type=gha,mode=max,scope=umbrelos \
        --platform "linux/${arch}" \
        --file umbrelos.Dockerfile \
        --tag "umbrelos-${arch}" \
        ../../

    echo "Dumping Umbrel OS Docker image filesytem into a tar archive..."
    umbrel_os_container_id=$(docker run --platform "linux/${arch}" --detach "umbrelos-${arch}" /bin/true)
    docker export --output "build/umbrelos-${arch}.tar" "${umbrel_os_container_id}"
    docker rm "${umbrel_os_container_id}"
}

# Build Rugpi images for Pi 4 and 5.
function build_rugpi_images() {
    # Make sure that the Rugpi build directory exists.
    mkdir -p rugpi/build
    # Copy the root filesystem previously build with Docker.
    cp build/umbrelos-arm64.tar rugpi/build/umbrelos-base.tar
    # Copy `/etc/hostname` and `/etc/hosts` such that Rugpi can fix them.
    cp overlay-common/etc/{hostname,hosts} rugpi/recipes/fix-overlay/files

    pushd rugpi
    # Clean Rugpi cache to get a clean build.
    rm -rf .rugpi || true
    # Bake both images.
    if [ -z "${SKIP_PI4:-}" ]; then 
        ./run-bakery bake image pi4 build/umbrelos-pi4.img
        # Move image to global build directory.
        mv -f build/umbrelos-pi4.img ../build/umbrelos-pi4.img
    fi
    if [ -z "${SKIP_PI5:-}" ]; then 
        ./run-bakery bake image tryboot build/umbrelos-tryboot.img
        # Move image to global build directory.
        mv -f build/umbrelos-tryboot.img ../build/umbrelos-pi5.img
    fi
    popd
}

# This will run inside a container when the --bootstrapped flag is passed
function bootstrapped() {
    if [ -z "${SKIP_ARM64:-}" ] && [ -z "${SKIP_MENDER:-}" ]; then
        build_raspberrypi_mender_artifact
    fi
    if [ -z "${SKIP_AMD64:-}" ]; then
        build_x86_artifacts
    fi
}

# Build the Raspberry Pi mender artifact.
function build_raspberrypi_mender_artifact() {
    if [ -n "${SKIP_PI5:-}" ]; then
        echo "Pi 5 image is required for Mender artifact."
        exit 1
    fi

    echo "Build Raspberry Pi Mender artifact..."
    # We use the Pi 5 image as a basis. The only difference to the Pi 4 image is that
    # it lacks the firmware update, which is not necessary for the update.
    /usr/bin/mender-artifact write module-image \
        --artifact-name "${MENDER_ARTIFACT_NAME}" \
        -t raspberrypi \
        -T rugpi-image \
        -f /data/build/umbrelos-pi5.img \
        -o /data/build/umbrelos-pi.update
}

# Build the x86 artifacts.
function build_x86_artifacts() {
    echo "Creating disk image..."
    rootfs_tar_size="$(du --block-size 1M /data/build/umbrelos-amd64.tar | awk '{print $1}')"
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
    tar -xf /data/build/umbrelos-amd64.tar --directory "${root_mount_point}"

    echo "Setup hostname..."
    # We need to do this here becuse if we do it in the Dockerfile it gets
    # clobbered when Docker sets a random hostname during `docker run`. If
    # you copy any additional files here, please also do so in Rugpi.
    overlay_dir="/data/overlay-common"
    cp "${overlay_dir}/etc/hostname" "${root_mount_point}/etc/hostname"
    cp "${overlay_dir}/etc/hosts" "${root_mount_point}/etc/hosts"

    echo "Remove .dockerenv..."
    # We also need to remove this to prevent the system from being detected as a contianer
    rm "${root_mount_point}/.dockerenv"

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
    mv /mender/deploy/umbrelos.mender /data/build/umbrelos-amd64.update
    mv /mender/deploy/umbrelos.img /data/build/umbrelos-amd64.img
}

arguments=${@:-}

if [[ "${arguments}" = *"--bootstrapped"* ]]
then
    bootstrapped
else
    bootstrap $@
fi
