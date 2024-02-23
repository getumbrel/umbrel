FROM debian:bullseye

RUN apt-get -y update

# Install os image builder deps
RUN apt-get -y install fdisk gdisk qemu-utils dosfstools tree

# Install mender-convert
RUN apt-get -y install git
RUN git clone -b 4.0.1 https://github.com/mendersoftware/mender-convert.git /mender
RUN apt-get install -y sudo gdisk $(cat /mender/requirements-deb.txt)
RUN wget -q -O /usr/bin/mender-artifact https://downloads.mender.io/mender-artifact/3.10.0/linux/mender-artifact
RUN chmod +x /usr/bin/mender-artifact