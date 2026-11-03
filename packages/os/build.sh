#!/usr/bin/env bash

set -euo pipefail

# Pin the Rugix Docker image.
export RUGIX_BAKERY_IMAGE="ghcr.io/rugix/rugix-bakery@sha256:abd9f86531f004d76ba73783e4e2d4f8046857c28a8786a435f67d45fc87a58b" # v0.9.4
# export RUGIX_VERSION="branch-main"
# export RUGIX_DEV=true

# Pin BuildKit so every machine interprets the Dockerfile and exports the root
# filesystems the same way. The builder is named after the version so bumping it
# creates a new one. Keep this in sync with the BuildKit pin in CI. The binfmt
# image is pinned too, since its emulators run the cross-architecture build
# steps.
BUILDKIT_VERSION="v0.34.1"
BUILDKIT_IMAGE="moby/buildkit:${BUILDKIT_VERSION}@sha256:99368f3e46177c6405b9740e4461d91cee004128daeecca78d4ceac50ec1da5c"
BUILDX_BUILDER="umbrelos-buildkit-${BUILDKIT_VERSION}"
BINFMT_IMAGE="tonistiigi/binfmt@sha256:400a4873b838d1b89194d982c45e5fb3cda4593fbfd7e08a02e76b03b21166f0"

# Allow running from anywhere
cd "$(dirname $(readlink -f "${BASH_SOURCE[0]}"))"
OS_BUILD_DIR="$(pwd)"

docker_buildx() {
    docker buildx build --builder "${BUILDX_BUILDER}" --load $@
}

ensure_buildx_builder() {
    if ! docker buildx inspect "${BUILDX_BUILDER}" > /dev/null 2>&1; then
        docker buildx create \
            --name "${BUILDX_BUILDER}" \
            --driver docker-container \
            --driver-opt "image=${BUILDKIT_IMAGE}"
    fi
}

# Run Rugix Bakery with SOURCE_DATE_EPOCH set, so the filesystem tools it runs
# date what they create by the commit rather than the current time.
run_bakery() {
    DOCKER_FLAGS="${DOCKER_FLAGS:-} -e SOURCE_DATE_EPOCH=${source_date_epoch}" ./run-bakery "$@"
}

mender_artifact() {
    docker run --rm -v "$(pwd):/data" umbrelos:builder /usr/bin/mender-artifact "$@"
}

# Check whether the host can already run both build architectures without QEMU.
# amd64 emulation only counts as working if the container sees SSSE3 in
# /proc/cpuinfo: Rosetta and native hosts do, QEMU user-mode emulation doesn't
# (and Homebrew hard-fails on exactly that check during the amd64 root fs build).
host_emulation_is_good() {
    docker run --rm --platform linux/amd64 alpine grep -q ssse3 /proc/cpuinfo > /dev/null 2>&1 \
        && docker run --rm --platform linux/arm64 alpine true > /dev/null 2>&1
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

cleanup_os_build_intermediates() {
    local cleanup_failed=0

    echo "Cleaning OS build intermediates..."
    maybe_sudo rm -rf \
        "${OS_BUILD_DIR}/rugix/.rugix" \
        "${OS_BUILD_DIR}/rugix/build" \
        || cleanup_failed=1
    maybe_sudo rm -f \
        "${OS_BUILD_DIR}"/build/umbrelos-root-*.tar \
        || cleanup_failed=1

    return "${cleanup_failed}"
}

os_build_cleanup_enabled() {
    # CI checkouts are ephemeral, and release builds run concurrently in the same
    # checkout, so cleaning their shared Rugix state is unnecessary and unsafe.
    [ "${GITHUB_ACTIONS:-false}" != "true" ] \
        && [ "${SKIP_OS_BUILD_CLEANUP:-false}" != "true" ]
}

cleanup_os_build_intermediates_on_exit() {
    local build_exit_code=$?
    local cleanup_exit_code=0

    trap - EXIT
    if os_build_cleanup_enabled; then
        cleanup_os_build_intermediates || cleanup_exit_code=$?
    fi

    if [ "${build_exit_code}" -ne 0 ]; then
        exit "${build_exit_code}"
    fi
    exit "${cleanup_exit_code}"
}

SKIP_PI4="${SKIP_PI4-true}"
SKIP_MENDER_ARTIFACTS="${SKIP_MENDER_ARTIFACTS-true}"
SKIP_PI_MBR="${SKIP_PI_MBR-${SKIP_MENDER_ARTIFACTS}}"

# Main entrypoint.
function main() {
    trap cleanup_os_build_intermediates_on_exit EXIT

    # Date everything the build produces with the commit time, so building the
    # same commit produces the same artifacts. To build without a Git checkout,
    # set SOURCE_DATE_EPOCH to the commit time. Unset it afterwards: buildx
    # passes SOURCE_DATE_EPOCH from the environment to the build, which would
    # override the Dockerfile's fixed value.
    source_date_epoch="${SOURCE_DATE_EPOCH:-$(git log -1 --format=%ct 2>/dev/null || date +%s)}"
    unset SOURCE_DATE_EPOCH
    source_date="$(date -u -d "@${source_date_epoch}" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
        || date -u -r "${source_date_epoch}" +%Y-%m-%dT%H:%M:%SZ)"

    release="${1:-}"
    dev="false"
    if [[ "${release}" == "" ]]
    then
        # Use the full hash, the length of short hashes depends on the clone.
        local git_hash
        git_hash="$(git rev-parse HEAD 2>/dev/null || echo "dev")"
        release="${git_hash}-${source_date_epoch}"
        dev="true"
    fi

    # Pull the Rugix Bakery image while the root filesystems build, rather than
    # after. run-bakery still pulls it again, which is quick once it's here, and
    # reports the error if this pull failed.
    local bakery_pull_pid=""
    if [ -z "${SKIP_RUGIX_ARTIFACTS:-}" ] && [ "${RUGIX_DEV:-false}" = "false" ]; then
        docker pull --quiet "${RUGIX_BAKERY_IMAGE}" > /dev/null 2>&1 &
        bakery_pull_pid=$!
    fi

    # Enable QEMU/binfmt-based multi-platform support for building arm64 on
    # amd64 or vice versa, e.g., to build for Pi 5 on an x86 system. Skipped when
    # the host already runs both architectures well, since installing the QEMU
    # handlers would replace Rosetta on Apple Silicon (OrbStack/Docker Desktop),
    # which is faster than QEMU and, unlike it, exposes the x86 CPU flags that
    # Homebrew requires (we probe with the same SSSE3 check Homebrew performs).
    if ! host_emulation_is_good; then
        docker run --privileged --rm "${BINFMT_IMAGE}" --install all
    fi

    ensure_buildx_builder

    if [ -n "${DOCKER_IMAGE_OUTPUT:-}" ]; then
        build_docker_image "${DOCKER_IMAGE_OUTPUT}"
    fi

    if [ -z "${SKIP_ROOTS:-}" ]; then
        if [ -z "${SKIP_PI:-}" ]; then
            build_root_fs pi "${release}"
        fi
        if [ -z "${SKIP_ARM64:-}" ]; then
            build_root_fs arm64 "${release}"
        fi
        if [ -z "${SKIP_AMD64:-}" ]; then
            build_root_fs amd64 "${release}"
        fi
    fi

    if [ -z "${SKIP_RUGIX_ARTIFACTS:-}" ]; then
        if [ -n "${bakery_pull_pid}" ]; then
            wait "${bakery_pull_pid}" || true
        fi
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
    mv build/umbrelos-amd64.rugixb        build/umbrelos-amd64.update                  2>/dev/null || true
    mv build/umbrelos-arm64.rugixb        build/umbrelos-arm64.update                  2>/dev/null || true
    mv build/umbrelos-mender-amd64.mender build/umbrelos-amd64-legacy-migration.update 2>/dev/null || true
    mv build/umbrelos-mender-amd64.rugixb build/umbrelos-amd64-legacy.update           2>/dev/null || true
    mv build/umbrelos-pi.mender           build/umbrelos-pi-legacy-migration.update    2>/dev/null || true
    mv build/umbrelos-pi.rugixb           build/umbrelos-pi.update                     2>/dev/null || true

    # Rugix Bakery writes bundles as root with mode 0600, so make them readable like the
    # images, otherwise CI can't cache, checksum or upload them
    for artifact in build/*.update; do
        if [ -e "${artifact}" ]; then
            maybe_sudo chmod 0644 "${artifact}"
        fi
    done

    # Record each Rugix bundle's hash for the signed release manifest. Devices pass it to
    # `rugix-ctrl update install --bundle-hash`, which verifies the bundle as it streams in.
    for bundle in build/*.update; do
        if [ -e "${bundle}" ] && [[ "${bundle}" != *-legacy-migration.update ]]; then
            ./hash-update-bundle.sh "${bundle}" > "${bundle}.hash"
        fi
    done

    # To boot from QEMU
    # qemu-system-x86_64 -net nic -net user,hostfwd=tcp::2222-:22 -machine accel=tcg -cpu max -smp 4 -m 8192 -hda build/umbrelos.img -bios OVMF.fd
}

# Build the root filesystem.
#
# Arguments: <arch> <release>
# arch can be: amd64, arm64, pi
function build_root_fs() {
    local arch=$1;
    local release=$2;

    # Determine the Docker platform and base variant
    local platform_arch="${arch}"
    local base_variant=""
    if [[ "${arch}" == "pi" ]]; then
        platform_arch="arm64"
        base_variant="-pi"
    fi

    echo "Ensuring the build dir exists..."
    mkdir -p build

    echo "Building Umbrel OS Docker image for ${arch}..."
    # The dedicated umbrelos-${arch} cache job already exports these layers to the
    # gha cache. In CI contexts that only need the image (not to refresh the
    # cache), set SKIP_CACHE_EXPORT=true to skip the redundant re-export — mass
    # or transient re-exports otherwise intermittently fail the build with cache
    # backend errors (429/504/not_found). The --cache-from import is unaffected.
    cache_to="--cache-to type=gha,mode=max,scope=umbrelos-${arch}"
    if [ "${SKIP_CACHE_EXPORT:-false}" = "true" ]; then
        cache_to=""
    fi
    # Note that we run the build context in ../../ so the build process has access to the
    # entire repo to copy in umbreld stuff.
    docker buildx build \
        --builder "${BUILDX_BUILDER}" \
        --cache-from type=gha,scope=umbrelos-${arch} \
        ${cache_to} \
        --platform "linux/${platform_arch}" \
        --build-arg BASE_VARIANT="${base_variant}" \
        --file umbrelos.Dockerfile \
        --target umbrelos \
        --output "type=tar,dest=build/umbrelos-root-${arch}.tar,source-date-epoch=${source_date_epoch}" \
        ../../
}

# Build the multi-arch umbrelOS Docker image.
#
# Arguments: <buildx output>, e.g. type=image,name=<tag>,push=true
function build_docker_image() {
    local output="$1"

    # Unlike the root filesystem export, the image export only clamps newer
    # timestamps, and cached layers keep the times they were built at. Use the
    # Dockerfile's fixed SOURCE_DATE_EPOCH, which predates every layer, rather
    # than the commit time. Provenance attestations record the build time and
    # CI run, so leave them out.
    local image_source_date_epoch
    image_source_date_epoch="$(sed -n 's/^ARG SOURCE_DATE_EPOCH=//p' umbrelos.Dockerfile)"
    docker buildx build \
        --builder "${BUILDX_BUILDER}" \
        --cache-from type=gha,scope=umbrelos-amd64 \
        --cache-from type=gha,scope=umbrelos-arm64 \
        --platform linux/amd64,linux/arm64 \
        --file umbrelos.Dockerfile \
        --target umbrelos-docker \
        --provenance=false \
        --output "${output},rewrite-timestamp=true,source-date-epoch=${image_source_date_epoch}" \
        ../../
}

# Build the Rugix artifacts.
#
# Arguments: <release> <dev>
function build_rugix_artifacts() {
    local release="$1"
    local dev="$2"

    # Make sure that the Rugix build directory exists.
    mkdir -p rugix/build/umbrelos-root
    # Hard link the root filesystems previously built with Docker. Copying them
    # takes a while, they're several GB each, and Rugix Bakery only reads them.
    ln -f build/*.tar rugix/build/umbrelos-root
    # Copy `/etc/hostname` and `/etc/hosts` such that Rugix can fix them.
    cp overlay/etc/{hostname,hosts} rugix/recipes/fix-overlay/files
    
    local compression="compression = { type = \"xz\", level = 9 }"
    if [ "$dev" == "true" ]; then
        compression=""
    fi

    pushd rugix
    # Clean Rugix cache to force a clean build.
    # Rugix keys imported files by their path rather than their contents, so reusing
    # this cache across OS builds could silently use a stale root filesystem.
    # CI starts with a fresh checkout and may run parallel builds in this directory.
    if os_build_cleanup_enabled; then
        rm -rf .rugix || true
    fi

    if [ -z "${SKIP_PI:-}" ] && [ -z "${SKIP_PI4:-}" ]; then
        build_rugix_system "umbrelos-pi4" "$release" "$dev"
        maybe_sudo mv -f "build/umbrelos-pi4/system.img" "../build/umbrelos-pi4.img"
    fi
    if [ -z "${SKIP_PI:-}" ] && [ -z "${SKIP_PI_TRYBOOT:-}" ]; then
        build_rugix_system "umbrelos-pi-tryboot" "$release" "$dev"
        # Set the GPT's first usable LBA to 34 so Windows doesn't break the image
        # for the Raspberry Pi bootloader.
        DOCKER_FLAGS="--entrypoint /project/fix-umbrelos-pi-gpt.sh" run_bakery
        maybe_sudo mv -f "build/umbrelos-pi-tryboot/system.img" "../build/umbrelos-pi.img"
        # Date the image by the commit time too, since the release zips it and
        # zip records its modification time.
        maybe_sudo touch -d "${source_date}" "../build/umbrelos-pi.img"
        maybe_sudo mv -f "build/umbrelos-pi-tryboot/system.rugixb" "../build/umbrelos-pi.rugixb"
    fi
    if [ -z "${SKIP_PI:-}" ] && [ -z "${SKIP_PI_MBR:-}" ]; then
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
        if [ "${SKIP_AMD64_RUGIX_BUNDLE:-}" = "true" ]; then
            bake_rugix_image "umbrelos-amd64" "$release"
        else
            build_rugix_system "umbrelos-amd64" "$release" "$dev"
        fi
        maybe_sudo mv -f "build/umbrelos-amd64/system.img" "../build/umbrelos-amd64.img"
        if [ "${SKIP_AMD64_RUGIX_BUNDLE:-}" != "true" ]; then
            maybe_sudo mv -f "build/umbrelos-amd64/system.rugixb" "../build/umbrelos-amd64.rugixb"
        fi
    fi
    if [ -z "${SKIP_ARM64:-}" ]; then
        build_rugix_system "umbrelos-arm64" "$release" "$dev"
        maybe_sudo mv -f "build/umbrelos-arm64/system.img" "../build/umbrelos-arm64.img"
        maybe_sudo mv -f "build/umbrelos-arm64/system.rugixb" "../build/umbrelos-arm64.rugixb"
    fi
    if [ -z "${SKIP_AMD64:-}" ] && [ -z "${SKIP_AMD64_MENDER:-}" ]; then
        bake_rugix_image "umbrelos-mender-amd64" "$release"
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
        run_bakery bundler bundle build/umbrelos-mender-amd64/bundle build/umbrelos-mender-amd64/system.rugixb
        maybe_sudo mv -f "build/umbrelos-mender-amd64/system.rugixb" "../build/umbrelos-mender-amd64.rugixb"
    fi
    popd
}

# Build the image for a given system.
#
# Arguments: <system> <release>
function bake_rugix_image() {
    local system="$1"
    local release="$2"

    run_bakery bake image --release-version "$release" --source-date "$source_date" "$system"

    # Rugix Bakery's images vary between builds and build machines, so fix
    # them up. See the script for details.
    if [[ "${system}" =~ ^umbrelos-(amd64|arm64|mender-amd64|pi-tryboot|pi4)$ ]]; then
        DOCKER_FLAGS="--entrypoint /project/fix-umbrelos-reproducible.sh" run_bakery "$system"
    fi
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
        compression="--disable-compression"
    fi

    # `bake bundle` has no --source-date and would date a fresh image by the
    # current time, so bake the image first and let the bundle reuse it. Fail
    # if Rugix rebuilds the image anyway, since the bundle wouldn't be
    # reproducible.
    bake_rugix_image "$system" "$release"
    touch "build/${system}.image-baked"
    run_bakery bake bundle --release-version "$release" $compression "$system"
    if [ "build/${system}/system-build-info.json" -nt "build/${system}.image-baked" ]; then
        echo "Rugix Bakery rebuilt the ${system} image instead of bundling the existing one."
        exit 1
    fi
    rm "build/${system}.image-baked"
}

# Build the Mender update artifacts.
#
# Arguments: <release>
function build_mender_artifacts() {
    local release="$1"

    if [ -z "${SKIP_PI:-}" ]; then
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
