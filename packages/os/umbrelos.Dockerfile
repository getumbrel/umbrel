FROM debian:bookworm

# Add non-free sources and update package index
RUN rm /etc/apt/sources.list.d/debian.sources
RUN echo "deb http://deb.debian.org/debian bookworm main non-free-firmware" > /etc/apt/sources.list
RUN echo "deb-src http://deb.debian.org/debian bookworm main non-free-firmware" >> /etc/apt/sources.list
RUN echo "deb http://deb.debian.org/debian-security bookworm-security main non-free-firmware" >> /etc/apt/sources.list
RUN echo "deb-src http://deb.debian.org/debian-security bookworm-security main non-free-firmware" >> /etc/apt/sources.list
RUN echo "deb http://deb.debian.org/debian bookworm-updates main non-free-firmware" >> /etc/apt/sources.list
RUN echo "deb-src http://deb.debian.org/debian bookworm-updates main non-free-firmware" >> /etc/apt/sources.list
RUN apt-get update --yes

# Install Linux kernel
RUN apt-get install --yes linux-image-amd64

# Install systemd
RUN apt-get install --yes systemd-sysv

# Install boot tooling
# We don't actually use systemd-boot as a bootloader since Mender injects GRUB
# but we use its systemd-repart tool to expand partitions on boot.
RUN apt-get install --yes systemd-boot

# Install non-free firmware
RUN apt-get install --yes intel-microcode amd64-microcode firmware-linux firmware-realtek firmware-iwlwifi

# Install essential networking services
RUN apt-get install --yes isc-dhcp-client network-manager ntp openssh-server

# Install essential system utilities
RUN apt-get install --yes sudo nano vim less man iproute2 iputils-ping curl wget ca-certificates dmidecode

# Add Umbrel user
RUN adduser --gecos "" --disabled-password umbrel
RUN echo "umbrel:umbrel" | chpasswd
RUN usermod -aG sudo umbrel

# Install Docker and docker-compose
RUN apt-get install --yes docker.io docker-compose

# TODO: Install Umbrel

# Copy in filesystem overlay
COPY overlay /

# Move persistant locations to /data to be bind mounted over the OS.
# /data will exist on a seperate partition that survives OS updates.
# This step should always be last so things like /var/log/apt/
# exist while installing packages.
# Migrataing current data is required to not break journald, otherwise
# /var/log/journal will not exist and journald will log to RAM and not
# persist between reboots.
RUN mkdir -p /data/umbrelos/var
RUN mv /var/log     /data/umbrelos/var/log
RUN mv /home        /data/umbrelos/home