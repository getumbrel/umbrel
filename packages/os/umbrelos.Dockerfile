ARG DEBIAN_VERSION=trixie
# Debian Docker image tags lag behind snapshot.debian.org, so pin the base image
# and apt repositories independently.
ARG DEBIAN_IMAGE_SNAPSHOT_DATE=20260713
ARG APT_SNAPSHOT_DATE=20260727
ARG BASE_VARIANT=""

ARG DOCKER_VERSION=28.5.0
ARG DOCKER_INSTALL_SCRIPT_COMMIT=5c8855edd778525564500337f5ac4ad65a0c168e

ARG NVIDIA_CUDA_SUPPORT=true
ARG NVIDIA_CONTAINER_TOOLKIT_VERSION=1.19.1-1
ARG LIBNVIDIA_CONTAINER1_SHA256_amd64=d73bb582af893135198ef81cb22135c790a75d2ad72910446477c6c4430f3e6b
ARG LIBNVIDIA_CONTAINER_TOOLS_SHA256_amd64=5642763d51961a2295dff09990048a5dcee81edbea2a8c5084e47b09ccf17268
ARG NVIDIA_CONTAINER_TOOLKIT_BASE_SHA256_amd64=b6c5b4e77a28cde0197cc0e64edf75538604775d9f8aea502cef667e7e5b2132
ARG NVIDIA_CONTAINER_TOOLKIT_SHA256_amd64=e66acb5b33420a8417429cd217abc8400b4a409a2ae17a3852cf6feb34b5c8e6

ARG YQ_VERSION=4.24.5
ARG YQ_SHA256_amd64=c93a696e13d3076e473c3a43c06fdb98fafd30dc2f43bc771c4917531961c760
ARG YQ_SHA256_arm64=8879e61c0b3b70908160535ea358ec67989ac4435435510e1fcb2eda5d74a0e9

ARG NODE_VERSION=22.13.0
ARG NODE_SHA256_amd64=9a33e89093a0d946c54781dcb3ccab4ccf7538a7135286528ca41ca055e9b38f  
ARG NODE_SHA256_arm64=e0cc088cb4fb2e945d3d5c416c601e1101a15f73e0f024c9529b964d9f6dce5b

ARG KOPIA_VERSION=0.19.0
ARG KOPIA_SHA256_amd64=c07843822c82ec752e5ee749774a18820b858215aabd7da448ce665b9b9107aa
ARG KOPIA_SHA256_arm64=632db9d72f2116f1758350bf7c20aa57c22c220480aaccb5f839e75669210ed9

ARG RTL8127_VERSION=11.015.00
ARG RTL8127_COMMIT=d4efe6050041f7d794d6f31b288abbacef11ff63
ARG RTL8127_SHA256=7ef27a4b5845ed011271217a8d5824f97ef6f1720ae304661b57bf0714010080

ARG RCLONE_RELEASE=1.74.4
ARG RCLONE_SHA256_amd64=fe435e0c36228e7c2f116a8701f01127bb1f694005fc11d1f27186c8bca4115d
ARG RCLONE_SHA256_arm64=97685285c9ad6a0cf17d5844115d2a67245af6444db672187074bd9c358de419

ARG LIBDE265_VERSION=1.1.1-1
ARG LIBDE265_SNAPSHOT_DATE=20260831T000000Z
ARG LIBDE265_SHA256_amd64=9af67dd3a1dce99c936f33865f92407746ca4031b7a8b86ae8c28b9a3445f01c
ARG LIBDE265_SHA256_arm64=1982300d3b6845a1c96f80a364b7921a69b69abd0c0417dc8554e2d487f488f5

#########################################################################
# ui build stage
#########################################################################

# The UI output is architecture-independent, so build it on the builder's native
# architecture. This also avoids running esbuild's Go binary under emulation.
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS ui-build

# Set the working directory
WORKDIR /app

# Copy the package.json and package-lock.json
COPY packages/ui/ .

# The ui-build stage only has 'packages/ui' in '/app', but the ui imports runtime values
# via a relative path ('../../../umbreld/source/modules/server/trpc/common') that resolves outside '/app'.
# We copy the target file to the expected path for the build to succeed.
COPY packages/umbreld/source/modules/server/trpc/common.ts /umbreld/source/modules/server/trpc/common.ts
COPY packages/umbreld/source/modules/user/wallpapers.ts /umbreld/source/modules/user/wallpapers.ts

# Install the dependencies
RUN rm -rf node_modules || true
RUN npm ci

# Build the shared dashboard and app-auth frontend
RUN npm run build


#########################################################################
# bundled container image stage
#########################################################################

# Pull the target-architecture images with a native skopeo binary. Go binaries
# can fail under cross-architecture user-mode emulation, and skopeo is only
# needed while building these archives—not in the shipped OS.
FROM --platform=$BUILDPLATFORM debian:${DEBIAN_VERSION}-${DEBIAN_IMAGE_SNAPSHOT_DATE} AS bundled-images

ARG APT_SNAPSHOT_DATE
ARG TARGETARCH

COPY packages/os/build-steps /build-steps
RUN /build-steps/initialize.sh "${APT_SNAPSHOT_DATE}" && \
    apt-get install --yes ca-certificates skopeo && \
    mkdir -p /images
RUN skopeo copy --override-arch "${TARGETARCH}" docker://ghcr.io/getumbrel/tor@sha256:e382b8629c0dfef6ceb396b062622d4e4e955b19d6f16b883fd2c0723ad5671a docker-archive:/images/tor


#########################################################################
# umbrelos-base build stage (amd64 and generic arm64)
#########################################################################

FROM debian:${DEBIAN_VERSION}-${DEBIAN_IMAGE_SNAPSHOT_DATE} AS umbrelos-base

ARG APT_SNAPSHOT_DATE
ARG TARGETARCH
ARG NVIDIA_CUDA_SUPPORT

COPY packages/os/build-steps /build-steps

RUN /build-steps/initialize.sh "${APT_SNAPSHOT_DATE}"

# Install Linux kernel, firmware, and ZFS
RUN apt-get install --yes \
    zfs-dkms \
    zfsutils-linux \
    linux-headers-${TARGETARCH} \
    linux-image-${TARGETARCH} \
    firmware-linux

# Install amd64-specific microcode and firmware
RUN set -e; \
    if [ "${TARGETARCH}" = "amd64" ]; then \
    apt-get install --yes \
        intel-microcode \
        amd64-microcode \
        firmware-realtek \
        firmware-iwlwifi \
        firmware-atheros; \
    fi

# The Debian kernel and firmware already provide the in-tree amdgpu/KFD and
# nouveau drivers. That is sufficient when containers bring their own ROCm or
# Vulkan userspace (including Mesa NVK for NVIDIA GPUs).
#
# CUDA, NVIDIA's Vulkan implementation, and NVDEC/NVENC share the NVIDIA kernel
# driver. Keep their userspace libraries on the host so the NVIDIA Container
# Toolkit can inject the versions matching that driver into application
# containers. Use Debian's driver-library and Vulkan ICD package contracts so
# all private compute, video, GLX, EGL, and Vulkan dependencies stay
# version-matched.
RUN set -e; \
    if [ "${TARGETARCH}" = "amd64" ] && [ "${NVIDIA_CUDA_SUPPORT}" = "true" ]; then \
        apt-get install --yes --no-install-recommends \
            nvidia-open-kernel-dkms \
            nvidia-driver-libs \
            libcuda1 \
            libnvcuvid1 \
            libnvidia-encode1 \
            nvidia-smi \
            nvidia-vulkan-icd; \
        install --directory /etc/vulkan/icd.d; \
        cp /usr/share/vulkan/icd.d/nvidia_icd.json \
            /etc/vulkan/icd.d/nvidia_icd.json; \
        grep -q 'libGLX_nvidia.so.0' /etc/vulkan/icd.d/nvidia_icd.json; \
        rm -f \
            /usr/share/vulkan/icd.d/nvidia_icd.json \
            /usr/share/vulkan/implicit_layer.d/nvidia_layers.json; \
    fi

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

FROM debian:${DEBIAN_VERSION}-${DEBIAN_IMAGE_SNAPSHOT_DATE} AS umbrelos-base-pi

ARG APT_SNAPSHOT_DATE

COPY packages/os/build-steps /build-steps

RUN /build-steps/initialize.sh "${APT_SNAPSHOT_DATE}"

RUN /build-steps/setup-raspberrypi.sh

RUN apt-get install --yes \
    zfs-dkms \
    zfsutils-linux

# Cleanup build steps.
RUN rm -rf /build-steps

# Copy Pi-specific filesystem overlay
COPY packages/os/overlay-pi /


#########################################################################
# watchman build stage (amd64 and arm64)
#########################################################################

# Nasty hack to work around a Parcel watcher bug:
# https://github.com/getumbrel/umbrel/issues/2158
#
# We install Watchman through Homebrew because it gives us prebuilt bottles
# for both arm64 and amd64. Building Watchman from source takes ages, and
# upstream only provides prebuilt binaries for amd64.
#
# This can be removed if Parcel fixes the watcher bug or if we move away from
# Parcel's watcher.
FROM debian:${DEBIAN_VERSION}-${DEBIAN_IMAGE_SNAPSHOT_DATE} AS watchman-build

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


#########################################################################
# umbrelos build stage
#########################################################################

# TODO: Instead of using the debian:trixie image as a base we should
# build a fresh rootfs from scratch. We can use the same tool the Docker
# images use for reproducible Debian builds: https://github.com/debuerreotype/debuerreotype
FROM umbrelos-base${BASE_VARIANT} AS umbrelos

# We need to duplicate this such that we can also use the argument below.
ARG TARGETARCH
ARG DOCKER_VERSION
ARG DOCKER_INSTALL_SCRIPT_COMMIT
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
ARG RTL8127_VERSION
ARG RTL8127_COMMIT
ARG RTL8127_SHA256
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
    wimtools

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

# Install the Realtek RTL8127 10GbE driver on amd64 systems. Build against the
# kernels in the image rather than the kernel running the Docker builder.
RUN set -e; \
    if [ "${TARGETARCH}" = "amd64" ]; then \
        curl -fsSL "https://github.com/openwrt/rtl8127/archive/${RTL8127_COMMIT}.tar.gz" -o /tmp/rtl8127.tar.gz && \
        echo "${RTL8127_SHA256}  /tmp/rtl8127.tar.gz" | sha256sum -c - && \
        mkdir -p /tmp/rtl8127 && \
        tar -xzf /tmp/rtl8127.tar.gz -C /tmp/rtl8127 --strip-components=1 && \
        module_built=false && \
        for modules_dir in /lib/modules/*; do \
            if [ ! -d "${modules_dir}/build" ]; then \
                continue; \
            fi; \
            kernel_version="$(basename "${modules_dir}")"; \
            make -C "${modules_dir}/build" M=/tmp/rtl8127 clean; \
            make -C "${modules_dir}/build" M=/tmp/rtl8127 modules; \
            make -C "${modules_dir}/build" M=/tmp/rtl8127 INSTALL_MOD_DIR=kernel/drivers/net/ethernet/realtek modules_install; \
            depmod -a "${kernel_version}"; \
            test "$(modinfo -k "${kernel_version}" -F version r8127)" = "${RTL8127_VERSION}-NAPI"; \
            module_built=true; \
        done && \
        test "${module_built}" = "true" && \
        rm -rf /tmp/rtl8127 /tmp/rtl8127.tar.gz; \
    fi

# Disable automatically starting smbd and wsdd2 at boot so umbreld can initialize them only when they're needed
RUN systemctl disable smbd wsdd2

# Filessystem support
RUN apt-get install --yes gdisk parted e2fsprogs exfatprogs
# For some reason this always fails on arm64 but it's ok since we
# don't support external storage on Pi anyway.
RUN [ "${TARGETARCH}" = "amd64" ] && apt-get install --yes ntfs-3g || true

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

# Create the runtime user.
RUN adduser --gecos "" --disabled-password umbrel
RUN echo "umbrel:umbrel" | chpasswd
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

RUN curl -fsSL https://raw.githubusercontent.com/docker/docker-install/${DOCKER_INSTALL_SCRIPT_COMMIT}/install.sh -o /tmp/install-docker.sh
RUN sh /tmp/install-docker.sh --version v${DOCKER_VERSION}
RUN rm /tmp/install-docker.sh

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
COPY packages/umbreld /opt/umbreld
COPY --from=ui-build /app/dist /opt/umbreld/ui
WORKDIR /opt/umbreld
RUN rm -rf node_modules || true
RUN npm clean-install --omit dev && npm link
WORKDIR /

# Copy in filesystem overlay
COPY packages/os/overlay /

# The common overlay is shared with arm64 builds, so add the NVIDIA runtime
# after copying it and only when the runtime binary exists on amd64. Toolkit
# 1.19.1 auto-selects JIT CDI, which does not inject private dependencies from
# Debian's split NVIDIA packages. Legacy mode uses libnvidia-container's
# complete dependency discovery.
RUN set -e; \
    if [ "${TARGETARCH}" = "amd64" ] && [ "${NVIDIA_CUDA_SUPPORT}" = "true" ]; then \
        nvidia-ctk runtime configure --runtime=docker; \
        nvidia-ctk config --in-place \
            --set nvidia-container-runtime.mode=legacy; \
    fi

# Rebuild initramfs after overlay changes so custom udev rules are available
# during early boot coldplug and /dev/disk/by-umbrel-id exists before the
# mount script runs. Pi images ship two kernels (Pi 4 and Pi 5) and
# update-initramfs only regenerates the highest version by default, so
# regenerate every installed kernel's initramfs.
RUN update-initramfs -u -k all

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
