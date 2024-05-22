FROM debian:bookworm

RUN apt-get -y update
RUN apt-get -y install grub-common grub-efi xorriso mtools xz-utils