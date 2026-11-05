# Bullseye is end of life and has been dropped from the regular Debian mirrors, so
# pin the base image and apt repositories to snapshot.debian.org.
ARG DEBIAN_IMAGE_SNAPSHOT_DATE=20260824
ARG APT_SNAPSHOT_DATE=20260824

FROM debian:bullseye-${DEBIAN_IMAGE_SNAPSHOT_DATE}
ARG APT_SNAPSHOT_DATE

RUN echo "deb http://snapshot.debian.org/archive/debian/${APT_SNAPSHOT_DATE} bullseye main" >/etc/apt/sources.list && \
    echo "deb http://snapshot.debian.org/archive/debian-security/${APT_SNAPSHOT_DATE} bullseye-security main" >>/etc/apt/sources.list && \
    echo "deb http://snapshot.debian.org/archive/debian/${APT_SNAPSHOT_DATE} bullseye-updates main" >>/etc/apt/sources.list && \
    echo 'Acquire::Check-Valid-Until "false";' >/etc/apt/apt.conf.d/90snapshot-validuntil

RUN apt-get -y update

# Install os image builder deps
RUN apt-get -y install fdisk gdisk qemu-utils dosfstools tree

# Install mender-convert
RUN apt-get -y install git
RUN git clone -b 4.0.1 https://github.com/mendersoftware/mender-convert.git /mender
RUN apt-get install -y sudo gdisk $(cat /mender/requirements-deb.txt)
RUN wget -q -O /usr/bin/mender-artifact https://downloads.mender.io/mender-artifact/3.10.0/linux/mender-artifact
RUN chmod +x /usr/bin/mender-artifact