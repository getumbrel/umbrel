#########################################################################
# ui build stage
#########################################################################

FROM node:18.19.1-buster-slim AS ui-build

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

FROM debian:bookworm AS umbrelos-base-amd64

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

FROM debian:bookworm AS umbrelos-base-arm64

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
RUN apt-get install --yes sudo nano vim less man iproute2 iputils-ping curl wget ca-certificates usbutils whois

# Install umbreld dependencies
# (many of these can be remove after the apps refactor)
RUN apt-get install --yes python3 fswatch jq rsync git gettext-base gnupg npm procps dmidecode

# Install yq from binary
# Debian repos have kislyuk/yq but we want mikefarah/yq
ARG YQ_VERSION=v4.24.5
ARG YQ_BINARY_amd64=yq_linux_amd64
ARG YQ_BINARY_arm64=yq_linux_arm64
ARG YQ_SHA256_amd64=c93a696e13d3076e473c3a43c06fdb98fafd30dc2f43bc771c4917531961c760
ARG YQ_SHA256_arm64=8879e61c0b3b70908160535ea358ec67989ac4435435510e1fcb2eda5d74a0e9

RUN YQ_BINARY=$(eval echo \$YQ_BINARY_${TARGETARCH}) && \
    YQ_SHA256=$(eval echo \$YQ_SHA256_${TARGETARCH}) && \
    curl -L https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/${YQ_BINARY} -o /usr/bin/yq && \
    echo "${YQ_SHA256} /usr/bin/yq" | sha256sum -c && \
    chmod +x /usr/bin/yq

# Install Docker
ARG DOCKER_VERSION=v25.0.4
ARG DOCKER_INSTALL_COMMIT=0efeea282625c87d28fa1f0d7aace794be2ce3cd

RUN curl -fsSL https://raw.githubusercontent.com/docker/docker-install/${DOCKER_INSTALL_COMMIT}/install.sh -o /tmp/install-docker.sh
RUN sh /tmp/install-docker.sh --version ${DOCKER_VERSION}
RUN rm /tmp/install-docker.sh

# Add Umbrel user
RUN adduser --gecos "" --disabled-password umbrel
RUN echo "umbrel:umbrel" | chpasswd
RUN usermod -aG sudo umbrel

# Preload images
RUN sudo apt-get install --yes skopeo
RUN mkdir -p /images
RUN skopeo copy docker://getumbrel/tor@sha256:2ace83f22501f58857fa9b403009f595137fa2e7986c4fda79d82a8119072b6a docker-archive:/images/tor
RUN skopeo copy docker://getumbrel/auth-server@sha256:b4a4b37896911a85fb74fa159e010129abd9dff751a40ef82f724ae066db3c2a docker-archive:/images/auth

# Install umbreld
COPY packages/umbreld /tmp/umbreld
COPY --from=ui-build /app/dist /tmp/umbreld/ui
WORKDIR /tmp/umbreld
RUN rm -rf node_modules || true
RUN npm install --omit dev --global
RUN rm -rf /tmp/umbreld
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
