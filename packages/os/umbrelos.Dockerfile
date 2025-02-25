ARG DEBIAN_VERSION=bookworm

ARG DOCKER_VERSION=25.0.4
ARG DOCKER_COMMIT=0efeea282625c87d28fa1f0d7aace794be2ce3cd

ARG YQ_VERSION=4.24.5
ARG YQ_SHA256_amd64=c93a696e13d3076e473c3a43c06fdb98fafd30dc2f43bc771c4917531961c760
ARG YQ_SHA256_arm64=8879e61c0b3b70908160535ea358ec67989ac4435435510e1fcb2eda5d74a0e9

ARG NODE_VERSION=22.13.0
ARG NODE_SHA256_amd64=9a33e89093a0d946c54781dcb3ccab4ccf7538a7135286528ca41ca055e9b38f  
ARG NODE_SHA256_arm64=e0cc088cb4fb2e945d3d5c416c601e1101a15f73e0f024c9529b964d9f6dce5b

#########################################################################
# ui build stage
#########################################################################

FROM node:${NODE_VERSION}-${DEBIAN_VERSION}-slim AS ui-build

# Install pnpm
RUN npm install -g pnpm@8

# Set the working directory
WORKDIR /app

# Copy the package.json and package-lock.json
COPY packages/ui/ .

# Install the dependencies
RUN rm -rf node_modules || true
RUN pnpm install

# Build the app
RUN pnpm run build


#########################################################################
# umbrelos-base-amd64 build stage
#########################################################################

FROM debian:${DEBIAN_VERSION} AS umbrelos-base-amd64

COPY packages/os/build-steps /build-steps

RUN /build-steps/initialize.sh

# Install Linux kernel and non-free firmware.
RUN apt-get install --yes \
    linux-image-amd64 \
    intel-microcode \
    amd64-microcode \
    firmware-linux \
    firmware-realtek \
    firmware-iwlwifi

# Cleanup build steps.
RUN rm -rf /build-steps


#########################################################################
# umbrelos-base-arm64 build stage
#########################################################################

FROM debian:${DEBIAN_VERSION} AS umbrelos-base-arm64

COPY packages/os/build-steps /build-steps

RUN /build-steps/initialize.sh

RUN /build-steps/setup-raspberrypi.sh

# Cleanup build steps.
RUN rm -rf /build-steps


#########################################################################
# umbrelos build stage
#########################################################################

ARG TARGETARCH

# TODO: Instead of using the debian:bookworm image as a base we should
# build a fresh rootfs from scratch. We can use the same tool the Docker
# images use for reproducible Debian builds: https://github.com/debuerreotype/debuerreotype
FROM umbrelos-base-${TARGETARCH} AS umbrelos

# We need to duplicate this such that we can also use the argument below.
ARG TARGETARCH
ARG DOCKER_VERSION
ARG DOCKER_COMMIT
ARG YQ_VERSION
ARG YQ_SHA256_amd64
ARG YQ_SHA256_arm64
ARG NODE_VERSION
ARG NODE_SHA256_amd64
ARG NODE_SHA256_arm64

# Install boot tooling
# We don't actually use systemd-boot as a bootloader since Mender injects GRUB
# but we use its systemd-repart tool to expand partitions on boot.
# We install mender-client via apt because injecting via mender-convert appears
# to be broken on bookworm.
RUN apt-get install --yes systemd-boot mender-client

# Install acpid
# We use acpid to implement custom behaviour for power button presses
RUN apt-get install --yes acpid
RUN systemctl enable acpid

# Install essential networking services
RUN apt-get install --yes network-manager systemd-timesyncd openssh-server avahi-daemon avahi-discover avahi-utils libnss-mdns

# Install bluetooth stack
# The default configuration enables all bluetooth controllers/adapters present on boot and plugged in after boot
RUN apt-get install --yes bluez

# Install essential system utilities
RUN apt-get install --yes sudo nano vim less man iproute2 iputils-ping curl wget ca-certificates usbutils whois build-essential

# Install umbreld dependencies
# (many of these can be remove after the apps refactor)
RUN apt-get install --yes python3 fswatch jq rsync git gettext-base gnupg procps dmidecode samba wsdd2 p7zip-full imagemagick ffmpeg

# Support for alternate filesystems
# For some reason this always fails on arm64 but it's ok since we
# don't support external storage on Pi anyway.
RUN [ "${TARGETARCH}" = "amd64" ] && apt-get install --yes ntfs-3g || true

# TODO: udisks2 recommends eject (2.38.1-5+deb12u3) which is currently missing
RUN apt-get install --yes --no-install-recommends udisks2

# Disable automatically starting smbd at boot so umbreld can initialize it first
RUN systemctl disable smbd.service

# Install Node.js
RUN apt-get install --yes python3 fswatch jq rsync git gettext-base gnupg procps dmidecode
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

RUN curl -fsSL https://raw.githubusercontent.com/docker/docker-install/${DOCKER_COMMIT}/install.sh -o /tmp/install-docker.sh
RUN sh /tmp/install-docker.sh --version v${DOCKER_VERSION}
RUN rm /tmp/install-docker.sh

# Add Umbrel user
RUN addgroup --gid 1000 umbrel && adduser --uid 1000 --gid 1000 --gecos "" --disabled-password umbrel
RUN echo "umbrel:umbrel" | chpasswd
RUN usermod -aG sudo,sambashare umbrel

# Preload images
RUN apt-get install --yes skopeo
RUN mkdir -p /images
RUN skopeo copy docker://getumbrel/tor@sha256:2ace83f22501f58857fa9b403009f595137fa2e7986c4fda79d82a8119072b6a docker-archive:/images/tor
RUN skopeo copy docker://getumbrel/auth-server@sha256:b4a4b37896911a85fb74fa159e010129abd9dff751a40ef82f724ae066db3c2a docker-archive:/images/auth

# Install umbreld
COPY packages/umbreld /opt/umbreld
COPY --from=ui-build /app/dist /opt/umbreld/ui
WORKDIR /opt/umbreld
RUN rm -rf node_modules || true
RUN npm clean-install --omit dev && npm link
WORKDIR /

# Copy in filesystem overlay
COPY packages/os/overlay-common /
COPY "packages/os/overlay-${TARGETARCH}" /

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
