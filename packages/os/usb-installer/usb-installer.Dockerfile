FROM debian:bookworm-slim

RUN echo "root:root" | chpasswd

RUN apt-get -y update

# Install Linux kernel, systemd, bootloader and script deps
RUN apt-get install --yes --no-install-recommends linux-image-amd64 systemd-sysv xz-utils dmidecode

# Reduce size
# We have to do this extremely aggreseively because we're close to GitHub's 2GB release asset limit
RUN apt-get clean && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/* /tmp/* /usr/share/man /usr/share/doc /usr/share/info /var/log/*
RUN find / -name '*.a' -delete && \
    find / -name '*.so*' -exec strip --strip-debug {} \;
RUN rm -rf /usr/lib/modules/6.1.0-20-amd64/kernel/drivers/gpu
RUN rm -rf /usr/lib/modules/6.1.0-20-amd64/kernel/drivers/net
RUN rm -rf /usr/lib/modules/6.1.0-20-amd64/kernel/drivers/infiniband
RUN rm -rf /usr/lib/modules/6.1.0-20-amd64/kernel/net
RUN rm -rf /usr/lib/modules/6.1.0-20-amd64/kernel/sound

# Copy in umbrelOS image
COPY build/umbrelos-amd64.img.xz  /

# Copy in filesystem overlay
COPY usb-installer/overlay /

# Configure TTY services
RUN systemctl enable custom-tty.service
RUN systemctl mask console-getty.service
RUN systemctl mask getty@tty1.service