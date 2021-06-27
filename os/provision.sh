#!/usr/bin/env bash
set -euox pipefail

UMBREL_VERSION="v0.3.13"
UMBREL_ROOT="/home/umbrel/umbrel"

export DEBIAN_FRONTEND=noninteractive

# Setup Umbrel OS
# -----------------------

# Update package lists
apt-get update

# Set UMBREL_OS environment variable
# TODO: Find the correct place to set this
echo "UMBREL_OS=${UMBREL_VERSION}" >> /etc/environment
echo "export UMBREL_OS=${UMBREL_VERSION}" >> /etc/default/umbrel

# Change hostname to Umbrel
echo umbrel > /etc/hostname

# Install Avahi
apt-get install -y avahi-daemon avahi-discover libnss-mdns

# Create umbrel user
password_hash=$(perl -e 'print crypt("moneyprintergobrrr", "salt")')
useradd --create-home --groups sudo --password $password_hash umbrel

# Pi OS specific tweaks
# -----------------------

# Enable SSH
touch /boot/ssh

# Delete Pi user
pkill --euid pi || true
deluser --remove-home pi

# Umbrel installation
# -------------------

# Install Docker
apt-get install -y curl
curl -fsSL https://get.docker.com | sh
usermod --append --groups docker umbrel

# Install docker-compose
apt-get install -y python3-pip libffi-dev
pip3 install docker-compose

# Install Umbrel
apt-get install -y python3-qrcode fswatch rsync jq
mkdir "${UMBREL_ROOT}"
(
  cd "${UMBREL_ROOT}" &&
  curl -L "https://github.com/getumbrel/umbrel/archive/${UMBREL_VERSION}.tar.gz" | tar -xz --strip-components=1 &&
  UMBREL_SYSTEMD_SERVICES="${UMBREL_ROOT}/scripts/umbrel-os/services/*.service"
  for service_path in $UMBREL_SYSTEMD_SERVICES; do
    service_name=$(basename "${service_path}")
    install -m 644 "${service_path}" "/etc/systemd/system/${service_name}"
    systemctl enable "${service_name}"
  done
)
