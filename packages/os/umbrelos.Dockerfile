#########################################################################
# ui build stage
#########################################################################

FROM node:18.19.1-buster-slim as ui-build

# Install pnpm
RUN npm install -g pnpm

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

FROM debian:bookworm as umbrelos-base-amd64

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

FROM debian:bookworm as umbrelos-base-arm64

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
RUN apt-get install --yes isc-dhcp-client network-manager ntp openssh-server

# Install essential system utilities
RUN apt-get install --yes sudo nano vim less man iproute2 iputils-ping curl wget ca-certificates dmidecode usbutils

# Add Umbrel user
RUN adduser --gecos "" --disabled-password umbrel
RUN echo "umbrel:umbrel" | chpasswd
RUN usermod -aG sudo umbrel

# These deps are actually handled by the `umbreld provision-os` below, but since we invalidate the cache
# and need to re-run that step every time we change umbreld we just manually install all those packages here.
# It makes OS rebuilds way quicker. We should remove this at some point in the future to ensure that umbreld
# is the single source of truth for OS provisioning.
RUN apt-get install --yes network-manager python3 fswatch jq rsync curl git gettext-base python3 gnupg avahi-daemon avahi-discover libnss-mdns

# Preload images
RUN sudo apt-get install --yes skopeo
RUN mkdir -p /images
RUN skopeo copy docker://getumbrel/tor@sha256:2ace83f22501f58857fa9b403009f595137fa2e7986c4fda79d82a8119072b6a docker-archive:/images/tor
RUN skopeo copy docker://getumbrel/auth-server@sha256:b4a4b37896911a85fb74fa159e010129abd9dff751a40ef82f724ae066db3c2a docker-archive:/images/auth

# Install umbreld
RUN apt-get install --yes npm
COPY packages/umbreld /tmp/umbreld
COPY --from=ui-build /app/dist /tmp/umbreld/ui
WORKDIR /tmp/umbreld
RUN rm -rf node_modules || true
RUN npm install --omit dev --global
RUN rm -rf /tmp/umbreld
WORKDIR /

# Let umbreld provision the system
RUN umbreld provision-os

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
