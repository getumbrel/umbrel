#!/usr/bin/env bash

UMBREL_VERSION=0.3.7

# Helper functions
list_block_devices () {
  # We need to run sync here to make sure the filesystem is reflecting the
  # the latest changes in /sys/block/sd*
  sync
  # We use "2>/dev/null || true" to swallow errors if there are
  # no block devices. In that case the function just returns nothing
  # instead of an error which is what we want.
  #
  # sed 's!.*/!!' is to return the device path so we get sda
  # instead of /sys/block/sda
  (ls -d /sys/block/sd* 2>/dev/null || true) | sed 's!.*/!!'
}

get_root_dev () {
    dev=$(eval $(lsblk -oMOUNTPOINT,PKNAME -P -M | grep 'MOUNTPOINT="/"'); echo $PKNAME | sed 's/[0-9]*$//')
    echo $dev
} 

list_block_devices_without_root () {
    list_block_devices | sed "s/$(get_root_dev)//g"
}


# Actual script
if [[ $UID != 0 ]]; then
    echo "Umbrel must be installed as root"
    exit 1
fi

if ! command -v pip3 >/dev/null 2>&1; then
    echo "pip3 is not installing."
    echo "Plase install it to continue installing Umbrel."
    echo "On Debian-based distros, use 'sudo apt-get install python3-pip' to install it"
fi

if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is not installed, installing it..."
    curl -fsSL https://get.docker.com | sh
fi

if ! command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose is not installing, installing it..."
    pip3 install docker-compose
fi

echo "Where should we install Umbrel? Please provide the full path where umbrel should be stored."
echo "If none is entered, we'll use /etc/umbrel."
read install_dir

echo "Do you want us to use an external drive for Umbrel? If yes, please provide the path of that device in /dev"
echo "Please make sure to NOT enter the drive your OS is installed on, all data on the drive will be deleted"
echo "If you want to use the same disk for Umbrel and your OS, select none."
select opt in $(list_block_devices_without_root) none
do
    case $opt in
        "none")
            break
            ;;
        "")
            break
            ;;
        *)
            external_disk=$REPLY
            break
            ;;
    esac
done

echo "Do you want us to use mainnet, testnet or regtest?"
options=("mainnet (default)" "testnet" "regtest")
select opt in "${options[@]}"
do
    case $opt in
        "mainnet (default)")
            btc_network="mainnet"
            break
            ;;
        "testnet")
            btc_network="testnet"
            break
            ;;
        "regtest")
            btc_network="regtest"
            break
            ;;
        *)
            btc_network="mainnet"
            break
            ;;
    esac
done

if [[ -z "${install_dir}" ]]; then
    install_dir="/etc/umbrel"
fi


if [[ ! -z "${external_disk}" ]]; then
    echo "Installing Umbrel (${btc_network}) in $install_dir and configuring it to use $external_disk."
else
    echo "Installing Umbrel (${btc_network}) in $install_dir."
fi

echo "Press enter to start the setup"
read

echo "Starting setup..."
mkdir -p ${install_dir}
cd ${install_dir}
echo "Downloading Umbrel..."
curl -L https://github.com/getumbrel/umbrel/archive/v${UMBREL_VERSION}.tar.gz | tar -xz --strip-components=1

echo "Configuring Umbrel"
NETWORK=$btc_network ./scripts/configure

if [[ ! -z "${external_disk}" ]]; then
    echo "Installing mount service"
    install -m 644 ./scripts/services/umbrel-external-storage.service /etc/systemd/system/umbrel-external-storage.service
    sed -i -e "s/\/home\/umbrel\/umbrel/${install_dir}/g" /etc/systemd/system/umbrel-external-storage.service
    sed -i -e "s/EXTERNAL_STORAGE_PATH=\"undefined\"/EXTERNAL_STORAGE_PATH=\"${external_disk}\"/g" /etc/systemd/system/umbrel-external-storage.service
fi

echo "Installing startup service"
install -m 644 ./scripts/services/umbrel-startup.service /etc/systemd/system/umbrel-startup.service
sed -i -e "s/\/home\/umbrel\/umbrel/${install_dir}/g" /etc/systemd/system/umbrel-startup.service

echo "Starting services"
systemctl enable umbrel-startup
if [[ ! -z "${external_disk}" ]]; then
    systemctl enable umbrel-external-storage
    systemctl start umbrel-external-storage
fi

systemctl start umbrel-startup

echo "Umbrel was installed successfully!"
