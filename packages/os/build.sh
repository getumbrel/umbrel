#!/usr/bin/env bash

set -euo pipefail

# Pin the Rugix Docker image.
export RUGIX_BAKERY_IMAGE="ghcr.io/silitics/rugix-bakery@sha256:1abcf7791548aa441c06a8bc9b97acf170356cca8cd269b3fa8df4cc762d0251" # v0.8.15 + progress reporting for local delta hits (git-0c91222)
# export RUGIX_VERSION="branch-main"
# export RUGIX_DEV=true

# Allow running from anywhere
cd "$(dirname $(readlink -f "${BASH_SOURCE[0]}"))"

docker_buildx() {
    docker buildx build --load $@
}

mender_artifact() {
    docker run --rm -v "$(pwd):/data" umbrelos:builder /usr/bin/mender-artifact "$@"
}

# Run a command with sudo only in GitHub Actions
# These commands fail in GHA without sudo but they aren't needed locally and it's
# annoying for the script to get blocked and be prompted.
maybe_sudo() {
    if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
        sudo "$@"
    else
        "$@"
    fi
}

# Main entrypoint.
function main() {
    release="${1:-}"
    dev="false"
    if [[ "${release}" == "" ]]
    then
        release="$(git rev-parse --short HEAD)-$(date +%s)"
        dev="true"
    fi

    # Enable QEMU/binfmt-based multi-platform support for building arm64 on
    # amd64 or vice versa, e.g., to build for Pi 5 on an x86 system.
    docker run --privileged --rm tonistiigi/binfmt --install all

    if [ -z "${SKIP_ROOTS:-}" ]; then
        if [ -z "${SKIP_ARM64:-}" ]; then
            build_root_fs arm64 "${release}"
        fi
        if [ -z "${SKIP_AMD64:-}" ]; then
            build_root_fs amd64 "${release}"
        fi
    fi

    if [ -z "${SKIP_RUGIX_ARTIFACTS:-}" ]; then
        build_rugix_artifacts "${release}" "${dev}"
    fi

    if [ -z "${SKIP_MENDER_ARTIFACTS:-}" ]; then
        docker_buildx \
            --platform "linux/amd64" \
            --cache-from type=gha,scope=builder \
            --cache-to type=gha,mode=max,scope=builder \
            --file builder.Dockerfile \
            --tag umbrelos:builder \
            .
        build_mender_artifacts "${release}"
    fi

    # Rename artifacts
    # TODO: Maybe do this a cleaner way
    # *.update are the new rugix native artifacts
    # *-legacy.update are rugix update artifacts for legacy mender formatted devices
    # *-legacy-migration.update are mender update artifacts to allow mender based update
    # systems to migrate to the new rugix based update system.
    mv build/umbrelos-amd64.rugixb        build/umbrelos-amd64.update                  || true
    mv build/umbrelos-mender-amd64.mender build/umbrelos-amd64-legacy-migration.update || true
    mv build/umbrelos-mender-amd64.rugixb build/umbrelos-amd64-legacy.update           || true
    mv build/umbrelos-pi.mender           build/umbrelos-pi-legacy-migration.update    || true
    mv build/umbrelos-pi.rugixb           build/umbrelos-pi.update                     || true

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

    # Ensure that the overlay directory exists.
    mkdir -p "overlay-${arch}"

    echo "Building Umbrel OS Docker image..."
    # Note that we run the build context in ../../ so the build process has access to the
    # entire repo to copy in umbreld stuff.
    docker_buildx \
        --cache-from type=gha,scope=umbrelos-${arch} \
        --cache-to type=gha,mode=max,scope=umbrelos-${arch} \
        --platform "linux/${arch}" \
        --file umbrelos.Dockerfile \
        --tag "umbrelos-${arch}" \
        ../../

    echo "Dumping Umbrel OS Docker image filesystem into a tar archive..."
    umbrel_os_container_id=$(docker run --platform "linux/${arch}" --detach "umbrelos-${arch}" /bin/true)
    docker export --output "build/umbrelos-root-${arch}.tar" "${umbrel_os_container_id}"
    docker rm "${umbrel_os_container_id}"
}

# Build the Rugix artifacts.
#
# Arguments: <release> <dev>
function build_rugix_artifacts() {
    local release="$1"
    local dev="$2"

    # Make sure that the Rugix build directory exists.
    mkdir -p rugix/build/umbrelos-root
    # Copy the root filesystems previously build with Docker.
    cp build/*.tar rugix/build/umbrelos-root
    # Copy `/etc/hostname` and `/etc/hosts` such that Rugix can fix them.
    cp overlay-common/etc/{hostname,hosts} rugix/recipes/fix-overlay/files
    
    local compression="compression = { type = \"xz\", level = 9 }"
    if [ "$dev" == "true" ]; then
        compression=""
    fi

    pushd rugix
    # Clean Rugix cache to force a clean build.
    rm -rf .rugix || true

    if [ -z "${SKIP_ARM64:-}" ] && [ -z "${SKIP_PI4:-}" ]; then 
        build_rugix_system "umbrelos-pi4" "$release" "$dev"
        maybe_sudo mv -f "build/umbrelos-pi4/system.img" "../build/umbrelos-pi4.img"
    fi
    if [ -z "${SKIP_ARM64:-}" ] && [ -z "${SKIP_PI_TRYBOOT:-}" ]; then 
        build_rugix_system "umbrelos-pi-tryboot" "$release" "$dev"
        maybe_sudo mv -f "build/umbrelos-pi-tryboot/system.img" "../build/umbrelos-pi5.img"
        maybe_sudo mv -f "build/umbrelos-pi-tryboot/system.rugixb" "../build/umbrelos-pi.rugixb"
    fi
    if [ -z "${SKIP_ARM64:-}" ] && [ -z "${SKIP_PI_MBR:-}" ]; then 
        build_rugix_system "umbrelos-pi-mbr" "$release" "$dev"
        # Truncate the image to the end of the last partition. This is required for
        # compatibility with the legacy Mender-Rugpi update module.
        popd
        docker_buildx \
            --platform "linux/amd64" \
            --cache-from type=gha,scope=builder \
            --cache-to type=gha,mode=max,scope=builder \
            --file builder.Dockerfile \
            --tag umbrelos:builder \
            .
        docker run --rm -v "$(pwd)/rugix:/data" umbrelos:builder /data/fix-umbrelos-pi-mbr.sh
        pushd rugix
    fi
    if [ -z "${SKIP_AMD64:-}" ] && [ -z "${SKIP_AMD64_RUGIX:-}" ]; then 
        build_rugix_system "umbrelos-amd64" "$release" "$dev"
        maybe_sudo mv -f "build/umbrelos-amd64/system.img" "../build/umbrelos-amd64.img"
        maybe_sudo mv -f "build/umbrelos-amd64/system.rugixb" "../build/umbrelos-amd64.rugixb"
    fi
    if [ -z "${SKIP_AMD64:-}" ] && [ -z "${SKIP_AMD64_MENDER:-}" ]; then
        ./run-bakery bake image --release-version "$release" "umbrelos-mender-amd64"
        maybe_sudo mkdir -p build/umbrelos-mender-amd64/bundle
        maybe_sudo ln -s ../filesystems build/umbrelos-mender-amd64/bundle/payloads
        cat <<EOF | maybe_sudo tee build/umbrelos-mender-amd64/bundle/rugix-bundle.toml > /dev/null
update-type = "full"

hash-algorithm = "sha512-256"

[[payloads]]
filename = "partition-1.img"
[payloads.delivery]
type = "slot"
slot = "system"
[payloads.block-encoding]
hash-algorithm = "sha512-256"
chunker = "casync-64"
$compression
deduplication = true
EOF
        ./run-bakery bundler bundle build/umbrelos-mender-amd64/bundle build/umbrelos-mender-amd64/system.rugixb
        maybe_sudo mv -f "build/umbrelos-mender-amd64/system.rugixb" "../build/umbrelos-mender-amd64.rugixb"
    fi
    popd
}

# Build the image and update bundle for a given system.
#
# Arguments: <system> <release> <dev>
function build_rugix_system() {
    local system="$1"
    local release="$2"
    local dev="$3"

    local compression=""
    if [ "$dev" == "true" ]; then
        compression="--without-compression"
    fi

    ./run-bakery bake bundle --release-version "$release" $compression "$system"
}

# Build the Mender update artifacts.
#
# Arguments: <release>
function build_mender_artifacts() {
    local release="$1"

    if [ -z "${SKIP_ARM64:-}" ] && [ -z "${SKIP_PI:-}" ]; then
        if [ ! -e "rugix/build/umbrelos-pi-mbr/system.img" ]; then
            echo "'umbrelos-pi-mbr' image is required to build Raspberry Pi Mender artifact."
            exit 1
        fi
        echo "Build Raspberry Pi Mender artifact..."
        mender_artifact write module-image \
            --artifact-name "${release}" \
            -t raspberrypi \
            -T rugpi-image \
            -f /data/rugix/build/umbrelos-pi-mbr/system.img \
            -o /data/build/umbrelos-pi.mender
    fi
    if [ -z "${SKIP_AMD64:-}" ] && [ -z "${SKIP_AMD64_MENDER:-}" ]; then
        if [ ! -e "rugix/build/umbrelos-mender-amd64/filesystems/partition-1.img" ]; then
            echo "'umbrelos-mender-amd64' image is required to build AMD64 Mender artifact."
            exit 1
        fi
        echo "Build AMD64 Mender artifact..."
        mender_artifact write rootfs-image \
            --artifact-name "${release}" \
            -t amd64 \
            -f /data/rugix/build/umbrelos-mender-amd64/filesystems/partition-1.img \
            -o /data/build/umbrelos-mender-amd64.mender
    fi
}

main "$@"
