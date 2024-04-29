FROM debian:bookworm

RUN apt-get -y update
RUN apt-get -y install fdisk gdisk qemu-utils dosfstools tree