ARG DEBIAN_VERSION=trixie
# Debian Docker image tags lag behind snapshot.debian.org, so pin the base image
# and apt repositories independently. Base images are also pinned by digest
# because tags can be re-pushed, which would silently change the build. Pin
# every stage's base image this way.
ARG DEBIAN_IMAGE_SNAPSHOT_DATE=20261027
ARG DEBIAN_IMAGE_DIGEST=sha256:2dc419c6d7fe3dad0a2f9fd469c34cc90b0f9ba642d8fde837fe3d7d34a0e7f1
ARG APT_SNAPSHOT_DATE=20261031
# amd64 and generic arm64 take their kernel, ZFS, and firmware from trixie-backports (see umbrelos-base below), pinned to their own snapshot
ARG KERNEL_BACKPORTS_SNAPSHOT_DATE=20261028T000000Z
ARG BASE_VARIANT=""

# Build tools that record the current time (user creation in package scripts,
# initramfs, DKMS) read it from SOURCE_DATE_EPOCH instead, so the build doesn't
# depend on when it runs. Any fixed value works. Keep it fixed rather than
# passing the commit time, which would invalidate the layer cache on every
# commit. build.sh sets the timestamps of the exported root filesystem to the
# commit time separately. Declare `ARG SOURCE_DATE_EPOCH` in every stage that
# runs such tools, since stages don't see it otherwise.
ARG SOURCE_DATE_EPOCH=1792627200

ARG NVIDIA_CUDA_SUPPORT=true
ARG NVIDIA_DRIVER_VERSION=595.91.07
ARG NVIDIA_CONTAINER_TOOLKIT_VERSION=1.20.1-1
ARG LIBNVIDIA_CONTAINER1_SHA256_amd64=9d803cd9c898cb2fa927529d5ac4fc09f3d65c8cfbde8985de1b9398e53a4656
ARG LIBNVIDIA_CONTAINER_TOOLS_SHA256_amd64=8bd131b8977a3db667982024850ae7b50cfa02d6b2be06a718064ec814778f05
ARG NVIDIA_CONTAINER_TOOLKIT_BASE_SHA256_amd64=e01964a064fbdb62425ab22ec5832349f92c5b0b50c8f23fdf14dad004db4fb2
ARG NVIDIA_CONTAINER_TOOLKIT_SHA256_amd64=a95c9d206a7ecd6a90adff9290635271fa167a86b5767b17eaa0478a552eb02c

ARG YQ_VERSION=4.54.1
ARG YQ_SHA256_amd64=8e34fc298390875de416e6a4afcb8cabeceb25d9aa8506c1a2f9353cf702ea5f
ARG YQ_SHA256_arm64=189088da0c6429ec5178dfaab1a114805f6cab0b61b165ab236efedf1d57a71b

ARG NODE_VERSION=26.12.1
ARG NODE_IMAGE_DIGEST=sha256:88e480776c6149ff1d098cd304f44bf18057fb5d284a3329b78162d29821e28c
ARG NODE_SHA256_amd64=0fd1eb7770598f52a21995edf6ed35fc690400fa437c2386af329519e9143132
ARG NODE_SHA256_arm64=a6c01af459dd8972ab3fb08ee5da81244d26ba8c4944a62d5bbba8c597ae154f

ARG KOPIA_VERSION=0.23.1
ARG KOPIA_SHA256_amd64=416d0f84a3dbb321a8b2d8f0997b1a0a6e915babe79ee76fa6e4d2bd1e1c5178
ARG KOPIA_SHA256_arm64=a4ffbc019e0b0f932e2632054e73ec521dc1e80172a00095369c53ecf4e5a6cb

ARG RCLONE_RELEASE=1.75.2
ARG RCLONE_SHA256_amd64=349ac8fba6ff65d6247043f1750cdcb518ec5d500ef91463a10d37c0ccdf3702
ARG RCLONE_SHA256_arm64=7e1e8d69654941b7b7df84ee74c5f7fb09cce7d5496947fb7bf16b55ff427d10

ARG LIBDE265_VERSION=1.1.3-1
ARG LIBDE265_SNAPSHOT_DATE=20260919T000000Z
ARG LIBDE265_SHA256_amd64=36115188a321806ac797218cb878be15e8df7584fc65b10ea50d52cad065c5f5
ARG LIBDE265_SHA256_arm64=36c69add16a79fdffd85f284501b8f9ddd7128ccb8e078598818beb3e50109ec

#########################################################################
# source stage
#########################################################################

# Files copied from the build context keep the modes and mtimes they have in the
# checkout, which depend on the umask and on when each file was checked out.
# Normalize the ones that end up in the OS so the result doesn't depend on the
# checkout: Git only tracks the executable bit, and every mtime is set to
# SOURCE_DATE_EPOCH.
FROM --platform=$BUILDPLATFORM debian:${DEBIAN_VERSION}-${DEBIAN_IMAGE_SNAPSHOT_DATE}@${DEBIAN_IMAGE_DIGEST} AS source

ARG SOURCE_DATE_EPOCH

COPY packages/ui /source/ui
COPY packages/umbreld /source/umbreld
COPY packages/os/overlay /source/overlay
COPY packages/os/overlay-pi /source/overlay-pi
RUN find /source -type d -exec chmod 0755 {} + && \
    find /source -type f -perm /0111 -exec chmod 0755 {} + && \
    find /source -type f ! -perm /0111 -exec chmod 0644 {} + && \
    find /source -exec touch --no-dereference --date="@${SOURCE_DATE_EPOCH}" {} +


#########################################################################
# ui build stage
#########################################################################

# The UI output is architecture-independent, so build it on the builder's native
# architecture. This also avoids running esbuild's Go binary under emulation.
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim@${NODE_IMAGE_DIGEST} AS ui-build

# Set the working directory
WORKDIR /app

# Copy the package.json and package-lock.json
COPY --from=source /source/ui/ .

# The ui-build stage only has 'packages/ui' in '/app', but the ui imports runtime values
# via a relative path ('../../../umbreld/source/modules/server/trpc/common') that resolves outside '/app'.
# We copy the target file to the expected path for the build to succeed.
COPY packages/umbreld/source/modules/server/trpc/common.ts /umbreld/source/modules/server/trpc/common.ts
COPY packages/umbreld/source/modules/user/wallpapers.ts /umbreld/source/modules/user/wallpapers.ts
COPY packages/umbreld/source/modules/machines/input-motion.ts /umbreld/source/modules/machines/input-motion.ts

# Install the dependencies
RUN rm -rf node_modules || true
RUN npm ci

# Build the shared dashboard and app-auth frontend
# The build needs more than Node's default heap on the arm64 builders, which
# otherwise run out of memory part way through
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN npm run build


#########################################################################
# bundled container image stage
#########################################################################

# Pull the target-architecture images with a native skopeo binary. Go binaries
# can fail under cross-architecture user-mode emulation, and skopeo is only
# needed while building these archives—not in the shipped OS.
FROM --platform=$BUILDPLATFORM debian:${DEBIAN_VERSION}-${DEBIAN_IMAGE_SNAPSHOT_DATE}@${DEBIAN_IMAGE_DIGEST} AS bundled-images

ARG SOURCE_DATE_EPOCH
ARG APT_SNAPSHOT_DATE
ARG TARGETARCH

COPY packages/os/build-steps /build-steps
RUN /build-steps/initialize.sh "${APT_SNAPSHOT_DATE}" && \
    apt-get install --yes ca-certificates skopeo && \
    mkdir -p /images
RUN skopeo copy --override-arch "${TARGETARCH}" docker://ghcr.io/getumbrel/tor@sha256:7663d18fe37b3edd97c859aa36bb5eeaa328d86c57729db0433dff430e8abd8d docker-archive:/images/tor


#########################################################################
# umbrelos-base build stage (amd64 and generic arm64)
#########################################################################

FROM debian:${DEBIAN_VERSION}-${DEBIAN_IMAGE_SNAPSHOT_DATE}@${DEBIAN_IMAGE_DIGEST} AS umbrelos-base

ARG SOURCE_DATE_EPOCH
ARG APT_SNAPSHOT_DATE
ARG KERNEL_BACKPORTS_SNAPSHOT_DATE
ARG TARGETARCH
ARG NVIDIA_CUDA_SUPPORT
ARG NVIDIA_DRIVER_VERSION

COPY packages/os/build-steps /build-steps

RUN /build-steps/initialize.sh "${APT_SNAPSHOT_DATE}"

# DKMS signs the modules it builds with a key it generates on the fly, which
# would make every build differ and ship the private key in the image. umbrelOS
# doesn't use Secure Boot, so nothing checks module signatures. Point DKMS at a
# signing tool that doesn't exist so it leaves the modules unsigned.
RUN mkdir -p /etc/dkms/framework.conf.d && \
    echo 'sign_file=/nonexistent' > /etc/dkms/framework.conf.d/umbrel-no-module-signing.conf

# Install Linux kernel, firmware, and ZFS.
#
# Take the kernel and firmware from trixie-backports, which tracks newer
# upstream kernels, so new hardware is supported without out-of-tree drivers.
# trixie's 6.12 kernel only gets fixes. The backports firmware matches the
# backports kernel. Generic arm64 (dev VMs) takes the same kernel so it matches
# what amd64 devices run.
#
# ZFS stays on trixie for now. trixie's ZFS builds against kernels up to its
# upstream Linux-Maximum (7.2 for 2.3.9) and refuses anything newer. To build
# against newer kernels, add src:zfs-linux to the pin to take ZFS from
# backports too.
#
# Pin the source packages that have to come from backports, rather than using
# --target-release, which would also pull in whatever other backports packages
# the install's dependencies happen to reach and then conflict with later
# installs from trixie. Everything else stays on trixie. If a future backports
# kernel, ZFS, or firmware needs another backports package, the install fails
# and its source package needs adding here.
#
# Newer kernels depend on dracut | initramfs-tools, and apt picks dracut on
# arm64. umbrelOS builds its initramfs with initramfs-tools, so install it
# explicitly.
RUN set -e; \
    echo "deb http://snapshot.debian.org/archive/debian/${KERNEL_BACKPORTS_SNAPSHOT_DATE} trixie-backports main contrib non-free non-free-firmware" \
        >/etc/apt/sources.list.d/trixie-backports.list; \
    printf '%s\n' \
        'Package: src:linux src:linux-signed-amd64 src:linux-signed-arm64 src:linux-base src:firmware-nonfree' \
        'Pin: release n=trixie-backports' \
        'Pin-Priority: 990' \
        >/etc/apt/preferences.d/trixie-backports-kernel; \
    apt-get update --yes; \
    apt-get install --yes \
        zfs-dkms \
        zfsutils-linux \
        linux-headers-${TARGETARCH} \
        linux-image-${TARGETARCH} \
        initramfs-tools \
        firmware-linux \
        firmware-intel-graphics \
        firmware-intel-misc \
        firmware-mediatek \
        firmware-nvidia-graphics

# Install amd64-specific microcode and firmware
#
# Both microcode packages add their updates to the initramfs, which loads them
# early in boot. amd64-microcode only does so when the machine building the
# image has an AMD CPU, so AMD devices would only get microcode updates if the
# image happened to be built on one. Always include them, like intel-microcode
# already does for generic initramfs images.
RUN set -e; \
    if [ "${TARGETARCH}" = "amd64" ]; then \
    apt-get install --yes \
        intel-microcode \
        amd64-microcode \
        firmware-realtek \
        firmware-iwlwifi \
        firmware-atheros; \
    echo 'AMD64UCODE_INITRAMFS=early' >> /etc/default/amd64-microcode; \
    fi

# The Debian kernel and firmware already provide the in-tree amdgpu/KFD and
# nouveau drivers. That is sufficient when containers bring their own ROCm or
# Vulkan userspace (including Mesa NVK for NVIDIA GPUs).
#
# CUDA, NVIDIA's Vulkan implementation, and NVDEC/NVENC share the NVIDIA kernel
# driver. Keep their userspace libraries on the host so the NVIDIA Container
# Toolkit can inject the versions matching that driver into application
# containers.
#
# Debian's own NVIDIA packages are stuck on the 550 branch, which predates
# Blackwell (RTX 50-series) support. Install a production-branch driver from
# NVIDIA's Debian 13 repository instead. Those packages follow Debian's
# driver-library and Vulkan ICD package contracts so all private compute, video,
# GLX, EGL, and Vulkan dependencies stay version-matched. The repository is not
# archived by snapshot.debian.org, so pin every package by checksum and keep the
# repository itself out of the image's apt sources.
#
# NVIDIA ships nvidia-smi in nvidia-driver-cuda, which also enables
# nvidia-persistenced. Every amd64 image carries the driver whether or not an
# NVIDIA GPU is present, so leave the daemon disabled.
#
# NVIDIA's nvidia_drm module claims the same PCI IDs as nvidia, so udev would
# autoload it with modesetting on and give NVIDIA GPUs a /dev/dri card and render
# node. On systems with an iGPU, the NVIDIA node can then take renderD128, which
# VA-API/QSV apps assume is the iGPU. CUDA, NVENC/NVDEC, and NVIDIA Vulkan only
# need /dev/nvidia*, so blacklist the autoload and keep NVIDIA GPUs off /dev/dri.
#
# NVIDIA's module build embeds the output of $(DATE), which defaults to `date`,
# so point it at SOURCE_DATE_EPOCH.
COPY packages/os/nvidia-driver-packages.sha256 /tmp/nvidia-driver-packages.sha256
RUN set -eu; \
    if [ "${TARGETARCH}" = "amd64" ] && [ "${NVIDIA_CUDA_SUPPORT}" = "true" ]; then \
        apt-get install --yes curl ca-certificates; \
        mkdir -p /tmp/nvidia-driver; \
        while read -r checksum package_file; do \
            curl -fsSL "https://developer.download.nvidia.com/compute/cuda/repos/debian13/x86_64/${package_file}" -o "/tmp/nvidia-driver/${package_file}"; \
            echo "${checksum}  /tmp/nvidia-driver/${package_file}" | sha256sum -c -; \
        done < /tmp/nvidia-driver-packages.sha256; \
        DATE="date --utc --date=@${SOURCE_DATE_EPOCH}" \
            apt-get install --yes --no-install-recommends --no-remove /tmp/nvidia-driver/*.deb; \
        systemctl disable nvidia-persistenced.service; \
        echo 'blacklist nvidia_drm' > /etc/modprobe.d/nvidia-drm.conf; \
        module_built=false; \
        for modules_dir in /lib/modules/*; do \
            test "$(modinfo -k "$(basename "${modules_dir}")" -F version nvidia)" = "${NVIDIA_DRIVER_VERSION}"; \
            module_built=true; \
        done; \
        test "${module_built}" = "true"; \
        rm -rf /tmp/nvidia-driver; \
        install --directory /etc/vulkan/icd.d; \
        cp /usr/share/vulkan/icd.d/nvidia_icd.json \
            /etc/vulkan/icd.d/nvidia_icd.json; \
        grep -q 'libGLX_nvidia.so.0' /etc/vulkan/icd.d/nvidia_icd.json; \
        rm -f \
            /usr/share/vulkan/icd.d/nvidia_icd.json \
            /usr/share/vulkan/implicit_layer.d/nvidia_layers.json; \
    fi; \
    rm /tmp/nvidia-driver-packages.sha256

# Keep the cross-hardware acceleration contract explicit. These options are
# provided by Debian's generic amd64 kernel and expose /dev/dri for Vulkan plus
# /dev/kfd for containerized ROCm workloads.
RUN set -e; \
    if [ "${TARGETARCH}" = "amd64" ]; then \
        grep -q '^CONFIG_DRM_AMDGPU=m$' /boot/config-*; \
        grep -q '^CONFIG_HSA_AMD=y$' /boot/config-*; \
        grep -q '^CONFIG_DRM_NOUVEAU=m$' /boot/config-*; \
    fi

# Cleanup build steps.
RUN rm -rf /build-steps


#########################################################################
# umbrelos-base-pi build stage (Raspberry Pi)
#########################################################################

FROM debian:${DEBIAN_VERSION}-${DEBIAN_IMAGE_SNAPSHOT_DATE}@${DEBIAN_IMAGE_DIGEST} AS umbrelos-base-pi

ARG SOURCE_DATE_EPOCH
ARG APT_SNAPSHOT_DATE

COPY packages/os/build-steps /build-steps

RUN /build-steps/initialize.sh "${APT_SNAPSHOT_DATE}"

RUN /build-steps/setup-raspberrypi.sh

# Cleanup build steps.
RUN rm -rf /build-steps

# Copy Pi-specific filesystem overlay
COPY --from=source /source/overlay-pi /


#########################################################################
# watchman build stage (amd64 and arm64)
#########################################################################

# umbreld watches files through Watchman, which avoids bugs in inotify-based
# watching: https://github.com/getumbrel/umbrel/issues/2158
#
# We install Watchman through Homebrew because it gives us prebuilt bottles
# for both arm64 and amd64. Building Watchman from source takes ages, and
# upstream only provides prebuilt binaries for amd64.
FROM debian:${DEBIAN_VERSION}-${DEBIAN_IMAGE_SNAPSHOT_DATE}@${DEBIAN_IMAGE_DIGEST} AS watchman-build

ARG SOURCE_DATE_EPOCH
ARG APT_SNAPSHOT_DATE
ARG WATCHMAN_VERSION=2026.05.11.00
ARG HOMEBREW_BREW_COMMIT=76ca8d74e4a180badad438bf245ddfc740d68a8e
ARG WATCHMAN_HOMEBREW_CORE_COMMIT=a33d7e6eed67d79d55b3d45050c6f45646116393

COPY packages/os/build-steps /build-steps

RUN /build-steps/initialize.sh "${APT_SNAPSHOT_DATE}"

RUN apt-get install --yes ca-certificates curl git file patchelf procps

RUN useradd --create-home --shell /bin/bash linuxbrew && \
    mkdir -p /home/linuxbrew/.linuxbrew && \
    chown -R linuxbrew:linuxbrew /home/linuxbrew

USER linuxbrew

ENV HOME=/home/linuxbrew
ENV HOMEBREW_PREFIX=/home/linuxbrew/.linuxbrew
ENV HOMEBREW_CELLAR=/home/linuxbrew/.linuxbrew/Cellar
ENV HOMEBREW_REPOSITORY=/home/linuxbrew/.linuxbrew/Homebrew
ENV PATH=/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin:${PATH}
ENV HOMEBREW_NO_ANALYTICS=1
ENV HOMEBREW_NO_AUTO_UPDATE=1
ENV HOMEBREW_NO_ENV_HINTS=1
ENV HOMEBREW_NO_INSTALL_CLEANUP=1
ENV HOMEBREW_NO_INSTALL_FROM_API=1

RUN git init "${HOMEBREW_REPOSITORY}" && \
    git -C "${HOMEBREW_REPOSITORY}" remote add origin https://github.com/Homebrew/brew.git && \
    git -C "${HOMEBREW_REPOSITORY}" fetch --depth=1 origin "${HOMEBREW_BREW_COMMIT}" && \
    git -C "${HOMEBREW_REPOSITORY}" checkout --detach FETCH_HEAD && \
    test "$(git -C "${HOMEBREW_REPOSITORY}" rev-parse HEAD)" = "${HOMEBREW_BREW_COMMIT}" && \
    mkdir -p \
        "${HOMEBREW_PREFIX}/bin" \
        "${HOMEBREW_PREFIX}/etc" \
        "${HOMEBREW_PREFIX}/include" \
        "${HOMEBREW_PREFIX}/lib" \
        "${HOMEBREW_PREFIX}/opt" \
        "${HOMEBREW_PREFIX}/sbin" \
        "${HOMEBREW_PREFIX}/share" \
        "${HOMEBREW_PREFIX}/var/homebrew" && \
    ln -s ../Homebrew/bin/brew "${HOMEBREW_PREFIX}/bin/brew"

# Rosetta reports the arm64 host's /proc/cpuinfo even while presenting an
# x86_64 userspace to the container. Homebrew consequently rejects its x86_64
# bottle before execution despite Rosetta supporting SSSE3. Bypass only that
# preflight in this identifiable cross-build environment; native x86_64 builds
# retain Homebrew's hardware guard unchanged.
RUN if [ "$(uname -m)" = "x86_64" ] && \
       grep -q '^Features.*asimd' /proc/cpuinfo && \
       ! grep -qE '^(flags|Features).*\bssse3\b' /proc/cpuinfo; then \
        grep -qE 'if ! grep -qE .*ssse3.*\/proc\/cpuinfo' \
            "${HOMEBREW_REPOSITORY}/Library/Homebrew/brew.sh" && \
        sed -i '/if ! grep -qE .*ssse3.*\/proc\/cpuinfo/,/    fi/c\    :' \
            "${HOMEBREW_REPOSITORY}/Library/Homebrew/brew.sh" && \
        ! grep -qE 'if ! grep -qE .*ssse3.*\/proc\/cpuinfo' \
            "${HOMEBREW_REPOSITORY}/Library/Homebrew/brew.sh"; \
    fi

RUN mkdir -p "${HOMEBREW_REPOSITORY}/Library/Taps/homebrew/homebrew-core" && \
    git -C "${HOMEBREW_REPOSITORY}/Library/Taps/homebrew/homebrew-core" init && \
    git -C "${HOMEBREW_REPOSITORY}/Library/Taps/homebrew/homebrew-core" remote add origin https://github.com/Homebrew/homebrew-core.git && \
    git -C "${HOMEBREW_REPOSITORY}/Library/Taps/homebrew/homebrew-core" fetch --depth=1 origin "${WATCHMAN_HOMEBREW_CORE_COMMIT}" && \
    git -C "${HOMEBREW_REPOSITORY}/Library/Taps/homebrew/homebrew-core" checkout --detach FETCH_HEAD

RUN brew install --formula --force-bottle watchman && \
    test "$(watchman -v)" = "${WATCHMAN_VERSION}" && \
    brew cleanup --prune=all

USER root

RUN cp -a /home/linuxbrew/.linuxbrew /opt/linuxbrew && \
    grep -Z -a -r -l "/home/linuxbrew/.linuxbrew" /opt/linuxbrew | xargs -0 -r sh -c ' \
        for file do \
            if patchelf --print-interpreter "$file" >/dev/null 2>&1; then \
                patchelf --set-interpreter /opt/linuxbrew/lib/ld.so "$file"; \
            fi; \
            rpath="$(patchelf --print-rpath "$file" 2>/dev/null || true)"; \
            if printf "%s" "$rpath" | grep -q "/home/linuxbrew/.linuxbrew"; then \
                patchelf --set-rpath "$(printf "%s" "$rpath" | sed "s#/home/linuxbrew/.linuxbrew#/opt/linuxbrew#g")" "$file"; \
            fi; \
        done \
    ' sh && \
    mv /home/linuxbrew /home/linuxbrew.build-only && \
    /opt/linuxbrew/bin/watchman -v

# Only Watchman runs in the OS, so drop Homebrew itself, along with the install
# receipts and SBOMs it writes with the time each package was poured.
RUN rm -rf /opt/linuxbrew/Homebrew /opt/linuxbrew/bin/brew && \
    find /opt/linuxbrew/Cellar -mindepth 3 -maxdepth 3 \( -name INSTALL_RECEIPT.json -o -name sbom.spdx.json \) -delete


#########################################################################
# avahi build stage
#########################################################################

# Debian's avahi 0.8 publishes IPv6 addresses while they are still tentative,
# before Duplicate Address Detection has finished. If another host on the LAN
# already uses the address (e.g. a DHCPv6 server hands out an address that is
# still in use), DAD fails, but avahi has already started probing a reverse
# PTR record for it. The real owner defends that record and avahi treats it as
# a host name conflict, so umbrel.local becomes umbrel-2.local. Clients keep
# retrying the address, so the suffix keeps climbing (we've seen
# umbrel-5582.local) until avahi is restarted.
#
# Upstream fixed this by ignoring tentative addresses, so we rebuild Debian's
# avahi with that commit backported. This can be removed once Debian ships
# avahi 0.9: https://github.com/avahi/avahi/pull/616
FROM debian:${DEBIAN_VERSION}-${DEBIAN_IMAGE_SNAPSHOT_DATE}@${DEBIAN_IMAGE_DIGEST} AS avahi-build

ARG APT_SNAPSHOT_DATE

COPY packages/os/build-steps /build-steps

RUN /build-steps/initialize.sh "${APT_SNAPSHOT_DATE}"

RUN apt-get install --yes dpkg-dev

COPY packages/os/avahi-patches /avahi-patches

# The build profiles skip the GTK and GObject introspection packages, which
# umbrelOS doesn't install, and the test suite.
WORKDIR /build
RUN export DEB_BUILD_PROFILES="nogir pkg.avahi.nogui nocheck" DEB_BUILD_OPTIONS="nocheck" && \
    apt-get source avahi && \
    cd avahi-*/ && \
    apt-get build-dep --yes ./ && \
    for patch in /avahi-patches/*.patch; do \
        cp "${patch}" debian/patches/ && \
        basename "${patch}" >> debian/patches/series; \
    done && \
    { \
        printf 'avahi (%s+umbrel1) %s; urgency=medium\n\n' "$(dpkg-parsechangelog --show-field Version)" "$(dpkg-parsechangelog --show-field Distribution)" && \
        printf '  * Backport upstream fix to ignore tentative IPv6 addresses.\n\n' && \
        printf ' -- umbrelOS <noreply@umbrel.com>  %s\n\n' "$(dpkg-parsechangelog --show-field Date)" && \
        cat debian/changelog; \
    } > debian/changelog.new && \
    mv debian/changelog.new debian/changelog && \
    dpkg-buildpackage --build=binary --no-sign && \
    mkdir /debs && \
    mv ../*.deb /debs/


#########################################################################
# umbrelos build stage
#########################################################################

# TODO: Instead of using the debian:trixie image as a base we should
# build a fresh rootfs from scratch. We can use the same tool the Docker
# images use for reproducible Debian builds: https://github.com/debuerreotype/debuerreotype
FROM umbrelos-base${BASE_VARIANT} AS umbrelos

# We need to duplicate this such that we can also use the argument below.
ARG SOURCE_DATE_EPOCH
ARG TARGETARCH
ARG NVIDIA_CUDA_SUPPORT
ARG NVIDIA_CONTAINER_TOOLKIT_VERSION
ARG LIBNVIDIA_CONTAINER1_SHA256_amd64
ARG LIBNVIDIA_CONTAINER_TOOLS_SHA256_amd64
ARG NVIDIA_CONTAINER_TOOLKIT_BASE_SHA256_amd64
ARG NVIDIA_CONTAINER_TOOLKIT_SHA256_amd64
ARG YQ_VERSION
ARG YQ_SHA256_amd64
ARG YQ_SHA256_arm64
ARG NODE_VERSION
ARG NODE_SHA256_amd64
ARG NODE_SHA256_arm64
ARG KOPIA_VERSION
ARG KOPIA_SHA256_amd64
ARG KOPIA_SHA256_arm64
ARG RCLONE_RELEASE
ARG RCLONE_SHA256_amd64
ARG RCLONE_SHA256_arm64
ARG LIBDE265_VERSION
ARG LIBDE265_SNAPSHOT_DATE
ARG LIBDE265_SHA256_amd64
ARG LIBDE265_SHA256_arm64

# Install acpid
# We use acpid to implement custom behaviour for power button presses
RUN apt-get install --yes acpid
RUN systemctl enable acpid

# Install zram-generator for swap
RUN apt-get install --yes systemd-zram-generator

# Install essential networking services
RUN apt-get install --yes network-manager systemd-timesyncd openssh-server avahi-daemon avahi-discover avahi-utils libnss-mdns nftables

# Replace Debian's avahi packages with our patched rebuild (see the avahi build stage)
COPY --from=avahi-build /debs /tmp/avahi-debs
RUN cd /tmp/avahi-debs && \
    dpkg --install \
        avahi-daemon_*.deb \
        avahi-utils_*.deb \
        libavahi-client3_*.deb \
        libavahi-common-data_*.deb \
        libavahi-common3_*.deb \
        libavahi-core7_*.deb \
        python3-avahi_*.deb && \
    rm -rf /tmp/avahi-debs

# Install bluetooth stack
# The default configuration enables all bluetooth controllers/adapters present on boot and plugged in after boot
RUN apt-get install --yes bluez

# Install essential system utilities
RUN apt-get install --yes sudo nano vim less man iproute2 iputils-ping curl wget ca-certificates usbutils whois build-essential e2fsprogs

# Install the host virtualization stack used by Umbrel Machines. Both system
# emulators and firmware families are present on every architecture so restored
# machines can still boot through TCG when their guest architecture differs
# from the host. Machine definitions and disks live in the Umbrel data
# directory; libvirt only owns disposable runtime state. Avoid the default
# recommendations, which add unrelated GUI, media, network, and storage
# backends and consume well over a gigabyte on the A/B system partitions.
# QEMU's OpenGL module loads libEGL at runtime without declaring it as a hard
# package dependency, so keep libegl1 explicit for the headless virgl display.
# eject loads the medium of a USB drive a guest ejected before it changes hands.
RUN apt-get install --yes --no-install-recommends \
    libvirt-daemon-system \
    libvirt-daemon-driver-qemu \
    libvirt-daemon-lock \
    libvirt-clients \
    qemu-system-x86 \
    qemu-system-arm \
    qemu-system-modules-opengl \
    qemu-utils \
    libegl1 \
    ovmf \
    qemu-efi-aarch64 \
    seabios \
    swtpm \
    swtpm-tools \
    dnsmasq-base \
    nftables \
    iptables \
    alsa-utils \
    cloud-image-utils \
    libarchive-tools \
    xorriso \
    genisoimage \
    dosfstools \
    mtools \
    wimtools \
    eject

# Docker's nftables compatibility rules can contain expressions that the
# iptables frontend cannot round-trip (notably Tailscale interface globs).
# Use libvirt's native nftables backend so transient VM networks coexist with
# Docker without attempting to parse or rewrite Docker's rules.
RUN sed -i 's/^#firewall_backend = "iptables"/firewall_backend = "nftables"/' /etc/libvirt/network.conf && \
    grep -Fqx 'firewall_backend = "nftables"' /etc/libvirt/network.conf && \
    rm -f /etc/libvirt/qemu/networks/default.xml /etc/libvirt/qemu/networks/autostart/default.xml

# QEMU opens the snd-aloop playback devices while umbreld captures the paired
# streams. Device nodes are owned by root:audio on Debian. The explicit device
# ACL also tells libvirt which loopback nodes to copy into each QEMU mount
# namespace; its dynamic disk, render, and other device grants remain intact.
COPY packages/os/qemu-machines.conf /tmp/qemu-machines.conf
RUN usermod --append --groups audio libvirt-qemu && \
    sed -i '$r /tmp/qemu-machines.conf' /etc/libvirt/qemu.conf && \
    rm /tmp/qemu-machines.conf && \
    grep -Fq '"/dev/snd/pcmC15D0p"' /etc/libvirt/qemu.conf

# Debian builds libvirt with the monolithic daemon. Keep it socket activated;
# it can reconnect to running QEMU processes after a daemon restart and does
# not persist any canonical Umbrel machine definitions.
RUN systemctl disable libvirtd.service
# Umbreld owns the lifecycle of its transient domains. Debian enables
# libvirt-guests by default, but its five-minute shutdown wait would delay an
# Umbrel reboot whenever a guest ignores ACPI poweroff (for example while it
# is sitting in firmware or an installer).
RUN systemctl mask libvirt-guests.service
RUN systemctl enable libvirtd.socket libvirtd-ro.socket libvirtd-admin.socket virtlogd.socket virtlockd.socket

# Install umbreld dependencies
# (many of these can be remove after the apps refactor)
RUN apt-get install --yes python3 fswatch jq rsync git gettext-base gnupg procps dmidecode unar imagemagick ffmpeg libimage-exiftool-perl samba wsdd2 cifs-utils smbclient nvme-cli smartmontools pciutils

# Debian trixie ships libde265 1.0.15, which leaves 10-bit image planes
# uninitialized before decoding. Apple tiled HEIC images can consequently pick
# up heap contents as magenta/cyan blocks that ImageMagick preserves in cached
# thumbnails. Install Debian's newer Forky/testing package containing the
# upstream initialization fix.
RUN LIBDE265_SHA256=$(eval echo \$LIBDE265_SHA256_${TARGETARCH}) && \
    curl -fsSL "https://snapshot.debian.org/archive/debian/${LIBDE265_SNAPSHOT_DATE}/pool/main/libd/libde265/libde265-0_${LIBDE265_VERSION}_${TARGETARCH}.deb" -o /tmp/libde265-0.deb && \
    echo "${LIBDE265_SHA256}  /tmp/libde265-0.deb" | sha256sum -c - && \
    dpkg --install /tmp/libde265-0.deb && \
    test "$(dpkg-query -W -f='${Version}' libde265-0)" = "${LIBDE265_VERSION}" && \
    rm /tmp/libde265-0.deb

# Disable automatically starting smbd and wsdd2 at boot so umbreld can initialize them only when they're needed
RUN systemctl disable smbd wsdd2

# Filessystem support
RUN apt-get install --yes gdisk parted e2fsprogs exfatprogs ntfs-3g

# Install Node.js
RUN NODE_ARCH=$([ "${TARGETARCH}" = "arm64" ] && echo "arm64" || echo "x64") && \
    NODE_SHA256=$(eval echo \$NODE_SHA256_${TARGETARCH}) && \
    curl -fsSL https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.gz -o node.tar.gz && \
    echo "${NODE_SHA256}  node.tar.gz" | sha256sum -c - && \
    tar -xz -f node.tar.gz -C /usr/local --strip-components=1 && \
    rm -rf node.tar.gz

# Install yq from binary
# Debian repos have kislyuk/yq but we want mikefarah/yq
RUN YQ_SHA256=$(eval echo \$YQ_SHA256_${TARGETARCH}) && \
    curl -L https://github.com/mikefarah/yq/releases/download/v${YQ_VERSION}/yq_linux_${TARGETARCH} -o /usr/bin/yq && \
    echo "${YQ_SHA256} /usr/bin/yq" | sha256sum -c && \
    chmod +x /usr/bin/yq

# Create the runtime user with the password "umbrel". Set it from a fixed hash,
# since chpasswd salts it randomly on every build.
RUN adduser --gecos "" --disabled-password umbrel
RUN usermod --password '$y$j9T$DVr8q3Zyf9OtCMowT3Q/K1$UNSCQ/Ev7h65gu36ePxQHpvbyUrvBJBQ5PxtinaXtuB' umbrel
RUN usermod -aG sudo umbrel

# Install the rclone release used by Cloud.
RUN RCLONE_SHA256=$(eval echo \$RCLONE_SHA256_${TARGETARCH}) && \
    curl -L https://downloads.rclone.org/v${RCLONE_RELEASE}/rclone-v${RCLONE_RELEASE}-linux-${TARGETARCH}.zip -o /tmp/rclone.zip && \
    echo "${RCLONE_SHA256} /tmp/rclone.zip" | sha256sum -c && \
    python3 -m zipfile -e /tmp/rclone.zip /tmp/rclone && \
    mv /tmp/rclone/rclone-v${RCLONE_RELEASE}-linux-${TARGETARCH}/rclone /usr/bin/rclone && \
    chmod +x /usr/bin/rclone && \
    test "$(rclone version | head -n 1)" = "rclone v${RCLONE_RELEASE}" && \
    rm -rf /tmp/rclone /tmp/rclone.zip

# Docker 29 changed two defaults that /etc/docker/daemon.json reverts:
# - Fresh installs default to the containerd image store, which keeps images
#   in /var/lib/containerd on the root filesystem. Only /var/lib/docker is
#   persisted on the data partition, so new devices and factory-reset devices
#   would lose every app image on reboot. Keep the graphdriver store that
#   existing devices already use.
# - The minimum API version rose from 1.24 to 1.40, which would break apps
#   that talk to the host Docker socket with older clients. Keep 1.24.
#
# Docker's repository isn't archived by snapshot.debian.org and moves on as new
# versions are released, so install the same packages Docker's install script
# would, pinned by checksum, and keep the repository out of the image's apt
# sources. To update Docker, take the Filename (minus `dists/trixie/pool/stable/`)
# and SHA256 of each of these packages from
# https://download.docker.com/linux/debian/dists/trixie/stable/binary-<arch>/Packages
# for amd64 and arm64.
COPY packages/os/docker-packages.sha256 /tmp/docker-packages.sha256
RUN set -eu; \
    mkdir -p /tmp/docker; \
    grep "_${TARGETARCH}.deb\$" /tmp/docker-packages.sha256 | while read -r checksum package_path; do \
        package_file="$(basename "${package_path}")"; \
        curl -fsSL "https://download.docker.com/linux/debian/dists/trixie/pool/stable/${package_path}" -o "/tmp/docker/${package_file}"; \
        echo "${checksum}  /tmp/docker/${package_file}" | sha256sum -c -; \
    done; \
    apt-get install --yes /tmp/docker/*.deb; \
    rm -rf /tmp/docker /tmp/docker-packages.sha256

# Install the NVIDIA Container Toolkit directly from pinned, checksummed
# packages. The toolkit exposes the matching CUDA and Vulkan driver userspace
# to containers; application runtimes remain in the application container.
RUN set -e; \
    if [ "${TARGETARCH}" = "amd64" ] && [ "${NVIDIA_CUDA_SUPPORT}" = "true" ]; then \
        nvidia_toolkit_url="https://nvidia.github.io/libnvidia-container/stable/deb/amd64"; \
        curl -fsSL "${nvidia_toolkit_url}/libnvidia-container1_${NVIDIA_CONTAINER_TOOLKIT_VERSION}_amd64.deb" -o /tmp/libnvidia-container1.deb; \
        curl -fsSL "${nvidia_toolkit_url}/libnvidia-container-tools_${NVIDIA_CONTAINER_TOOLKIT_VERSION}_amd64.deb" -o /tmp/libnvidia-container-tools.deb; \
        curl -fsSL "${nvidia_toolkit_url}/nvidia-container-toolkit-base_${NVIDIA_CONTAINER_TOOLKIT_VERSION}_amd64.deb" -o /tmp/nvidia-container-toolkit-base.deb; \
        curl -fsSL "${nvidia_toolkit_url}/nvidia-container-toolkit_${NVIDIA_CONTAINER_TOOLKIT_VERSION}_amd64.deb" -o /tmp/nvidia-container-toolkit.deb; \
        echo "${LIBNVIDIA_CONTAINER1_SHA256_amd64}  /tmp/libnvidia-container1.deb" | sha256sum -c -; \
        echo "${LIBNVIDIA_CONTAINER_TOOLS_SHA256_amd64}  /tmp/libnvidia-container-tools.deb" | sha256sum -c -; \
        echo "${NVIDIA_CONTAINER_TOOLKIT_BASE_SHA256_amd64}  /tmp/nvidia-container-toolkit-base.deb" | sha256sum -c -; \
        echo "${NVIDIA_CONTAINER_TOOLKIT_SHA256_amd64}  /tmp/nvidia-container-toolkit.deb" | sha256sum -c -; \
        apt-get install --yes --no-install-recommends \
            /tmp/libnvidia-container1.deb \
            /tmp/libnvidia-container-tools.deb \
            /tmp/nvidia-container-toolkit-base.deb \
            /tmp/nvidia-container-toolkit.deb; \
        rm -f \
            /tmp/libnvidia-container1.deb \
            /tmp/libnvidia-container-tools.deb \
            /tmp/nvidia-container-toolkit-base.deb \
            /tmp/nvidia-container-toolkit.deb; \
    fi

# Install kopia from binary
RUN KOPIA_ARCH=$([ "${TARGETARCH}" = "arm64" ] && echo "arm64" || echo "x64") && \
    KOPIA_SHA256=$(eval echo \$KOPIA_SHA256_${TARGETARCH}) && \
    curl -L https://github.com/kopia/kopia/releases/download/v${KOPIA_VERSION}/kopia-${KOPIA_VERSION}-linux-${KOPIA_ARCH}.tar.gz -o /tmp/kopia.tar.gz && \
    echo "${KOPIA_SHA256} /tmp/kopia.tar.gz" | sha256sum -c && \
    tar -xz -f /tmp/kopia.tar.gz -C /tmp && \
    mv /tmp/kopia-${KOPIA_VERSION}-linux-${KOPIA_ARCH}/kopia /usr/bin/kopia && \
    chmod +x /usr/bin/kopia

# kopia also requires fuse3 for mounting snapshots
RUN apt-get install --yes fuse3 bindfs

# Install Watchman from pinned Homebrew bottles.
COPY --from=watchman-build --chown=root:root /opt/linuxbrew/ /opt/linuxbrew/
ENV PATH=/opt/linuxbrew/bin:/opt/linuxbrew/sbin:${PATH}
RUN ln -sf /opt/linuxbrew/bin/watchman /usr/local/bin/watchman && \
    ln -sf /opt/linuxbrew/bin/watchman /usr/bin/watchman && \
    mkdir -p /usr/local/var/run/watchman && \
    chmod 2777 /usr/local/var/run/watchman && \
    watchman -v

# External and network Files mounts use the Umbrel group for shared write
# access. This lets the unprivileged QEMU user run disks from USB/NAS storage
# without weakening QEMU to root or making those mounts world-writable.
RUN usermod -aG umbrel libvirt-qemu

# Preload images
COPY --from=bundled-images /images /images

# Install umbreld
COPY --from=source /source/umbreld /opt/umbreld
COPY --from=ui-build /app/dist /opt/umbreld/ui
WORKDIR /opt/umbreld
RUN rm -rf node_modules || true
RUN npm clean-install --omit dev && npm link
WORKDIR /

# Copy in filesystem overlay
COPY --from=source /source/overlay /

# The common overlay is shared with arm64 builds, so add the NVIDIA runtime
# after copying it and only when the runtime binary exists on amd64. The
# toolkit auto-selects JIT CDI, which does not inject private dependencies from
# Debian's split NVIDIA packages. Legacy mode uses libnvidia-container's
# complete dependency discovery.
#
# Toolkit 1.20 enables nvidia-cdi-refresh, which writes a CDI spec at boot.
# Docker tries CDI before the legacy hook for GPU device requests, so that spec
# would silently bypass legacy mode. Mask it so GPU apps keep using the hook.
RUN set -e; \
    if [ "${TARGETARCH}" = "amd64" ] && [ "${NVIDIA_CUDA_SUPPORT}" = "true" ]; then \
        nvidia-ctk runtime configure --runtime=docker; \
        nvidia-ctk config --in-place \
            --set nvidia-container-runtime.mode=legacy; \
        systemctl mask nvidia-cdi-refresh.service nvidia-cdi-refresh.path; \
    fi

# Rebuild initramfs after overlay changes so custom udev rules are available
# during early boot coldplug and /dev/disk/by-umbrel-id exists before the
# mount script runs. Pi images ship two kernels (Pi 4 and Pi 5) and
# update-initramfs only regenerates the highest version by default, so
# regenerate every installed kernel's initramfs.
RUN update-initramfs -u -k all

# Remove build-time state that would differ between otherwise identical builds:
# logs, caches, and IDs generated at random while installing packages.
# - Each device generates its own SSH host keys on first boot
#   (umbrel-ssh-host-key-hydration).
# - Rugix Ctrl gives each device its own machine ID at boot, which D-Bus reads
#   from /etc/machine-id.
# - Every device running a given build already shared the generated ZFS host
#   ID and NVMe host NQN, so give them fixed values instead. umbrelOS imports
#   pools with --force, so the host ID only needs to be stable.
# - Homebrew's Python writes sitecustomize.py when it's poured, and build steps
#   that run Python afterwards compile it with that time embedded.
RUN rm -f /etc/ssh/ssh_host_*_key* /var/lib/dbus/machine-id /var/cache/ldconfig/aux-cache && \
    truncate -s 0 /etc/machine-id && \
    if command -v zgenhostid > /dev/null; then zgenhostid -f 756d6272; fi && \
    if [ -d /etc/nvme ]; then \
        echo "a4b0c2a6-4e3c-4f6b-9d38-4b5f0e1c7a21" > /etc/nvme/hostid && \
        echo "nqn.2014-08.org.nvmexpress:uuid:a4b0c2a6-4e3c-4f6b-9d38-4b5f0e1c7a21" > /etc/nvme/hostnqn; \
    fi && \
    rm -rf /var/lib/dkms/*/*/*/*/log /root/.npm /tmp/node-compile-cache && \
    find /opt/linuxbrew/Cellar -path '*/__pycache__/sitecustomize.*.pyc' -delete && \
    find /var/log -type f -delete

# Move persistant locations to /data to be bind mounted over the OS.
# /data will exist on a seperate partition that survives OS updates.
# This step should always be last so things like /var/log/apt/
# exist while installing packages.
# Migrataing current data is required to not break journald, otherwise
# /var/log/journal will not exist and journald will log to RAM and not
# persist between reboots.
RUN mkdir -p /data/umbrel-os/var
RUN mv /var/log     /data/umbrel-os/var/log
RUN mv /home        /data/umbrel-os/home


#########################################################################
# Docker image stage
#########################################################################

# Publish the multi-arch Docker image as a single layer holding the finished
# filesystem. Every build step's layer also captures the logs and caches it
# wrote, which would make the image differ on every build even though the
# filesystem it adds up to doesn't. Keep the config the umbrelos stage ends up
# with.
#
# This stage has to come after umbrelos to copy from it, which makes it the
# default target, so everything that builds the OS itself passes
# `--target umbrelos`.
FROM scratch AS umbrelos-docker

COPY --from=umbrelos / /
ENV PATH=/opt/linuxbrew/bin:/opt/linuxbrew/sbin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WORKDIR /
CMD ["bash"]
