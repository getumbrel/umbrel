#!/usr/bin/env bash
set -euo pipefail

RELEASE=$1
UMBREL_ROOT=$2

./check-memory "${RELEASE}" "${UMBREL_ROOT}" "notfirstrun"

# Only used on Umbrel OS
SD_CARD_UMBREL_ROOT="/sd-root${UMBREL_ROOT}"

echo
echo "======================================="
echo "=============== UPDATE ================"
echo "======================================="
echo "=========== Stage: Install ============"
echo "======================================="
echo

[[ -f "/etc/default/umbrel" ]] && source "/etc/default/umbrel"

# Make Umbrel OS specific updates
if [[ ! -z "${UMBREL_OS:-}" ]]; then
    echo
    echo "============================================="
    echo "Installing on Umbrel OS $UMBREL_OS"
    echo "============================================="
    echo

    # In Umbrel OS v0.1.2, we need to bind Avahi to only
    # eth0,wlan0 interfaces to prevent hostname cycling
    # https://github.com/getumbrel/umbrel-os/issues/76
    # This patch can be safely removed from Umbrel v0.3.x+
    if [[ $UMBREL_OS == "v0.1.2" ]] && [[ -f "/etc/avahi/avahi-daemon.conf" ]]; then
        echo "Binding Avahi to eth0 and wlan0"
        sed -i "s/#allow-interfaces=eth0/allow-interfaces=eth0,wlan0/g;" "/etc/avahi/avahi-daemon.conf"
        systemctl restart avahi-daemon.service
    fi

    # Update SD card installation
    if  [[ -f "${SD_CARD_UMBREL_ROOT}/.umbrel" ]]; then
        echo "Replacing ${SD_CARD_UMBREL_ROOT} on SD card with the new release"
        rsync --archive \
            --verbose \
            --include-from="${UMBREL_ROOT}/.umbrel-${RELEASE}/scripts/update/.updateinclude" \
            --exclude-from="${UMBREL_ROOT}/.umbrel-${RELEASE}/scripts/update/.updateignore" \
            --delete \
            "${UMBREL_ROOT}/.umbrel-${RELEASE}/" \
            "${SD_CARD_UMBREL_ROOT}/"

        echo "Fixing permissions"
        chown -R 1000:1000 "${SD_CARD_UMBREL_ROOT}/"
    else
        echo "ERROR: No Umbrel installation found at SD root ${SD_CARD_UMBREL_ROOT}"
        echo "Skipping updating on SD Card..."
    fi
    
    # Update apt packages on update
    # Remember, the apt package is called unattended-updates, the command is unattended-update
    if ! command -v unattended-upgrade &> /dev/null; then
        DEBIAN_FRONTEND=noninteractive apt-get install unattended-upgrades -y
    fi
    # Manual run of the update (Normally for debugging purposes only, but we don't want to have a potential backdoor in Umbrel)
    # https://wiki.debian.org/UnattendedUpgrades#Manual_run_.28for_debugging.29
cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 30, "description": "Installing security updates", "updateTo": "$RELEASE"}
EOF
    unattended-upgrade -d
fi

cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 35, "description": "Configuring settings", "updateTo": "$RELEASE"}
EOF

# Checkout to the new release
cd "$UMBREL_ROOT"/.umbrel-"$RELEASE"

# Configure new install
echo "Configuring new release"
cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 40, "description": "Configuring new release", "updateTo": "$RELEASE"}
EOF

PREV_ENV_FILE="$UMBREL_ROOT/.env"
BITCOIN_NETWORK="mainnet"
[[ -f "${PREV_ENV_FILE}" ]] && source "${PREV_ENV_FILE}"
PREV_ENV_FILE="${PREV_ENV_FILE}" NETWORK=$BITCOIN_NETWORK ./scripts/configure

# Pulling new containers
echo "Pulling new containers"
cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 50, "description": "Pulling new containers", "updateTo": "$RELEASE"}
EOF
docker-compose pull

echo "Updating installed apps"
cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 60, "description": "Updating installed apps", "updateTo": "$RELEASE"}
EOF
# We can just loop over this once everyone has the latest app script
# "$UMBREL_ROOT/scripts/app" ls-installed
# but for now we need to implement it here manually
USER_FILE="${UMBREL_ROOT}/db/user.json"
list_installed_apps() {
  cat "${USER_FILE}" 2> /dev/null | jq -r 'if has("installedApps") then .installedApps else [] end | join("\n")' || true
}
list_installed_apps | while read app; do
  if [[ "${app}" != "" ]]; then
    echo "${app}..."
    scripts/app compose "${app}" pull
  fi
done

# Stop existing containers
echo "Stopping existing containers"
cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 70, "description": "Removing old containers", "updateTo": "$RELEASE"}
EOF
cd "$UMBREL_ROOT"
./scripts/stop

# Overlay home dir structure with new dir tree
echo "Overlaying $UMBREL_ROOT/ with new directory tree"
rsync --archive \
    --verbose \
    --include-from="$UMBREL_ROOT/.umbrel-$RELEASE/scripts/update/.updateinclude" \
    --exclude-from="$UMBREL_ROOT/.umbrel-$RELEASE/scripts/update/.updateignore" \
    --delete \
    "$UMBREL_ROOT"/.umbrel-"$RELEASE"/ \
    "$UMBREL_ROOT"/

# Fix permissions
echo "Fixing permissions"
find "$UMBREL_ROOT" -path "$UMBREL_ROOT/app-data" -prune -o -exec chown 1000:1000 {} +
chmod -R 700 "$UMBREL_ROOT"/tor/data/*

# Killing karen
echo "Killing background daemon"
cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 75, "description": "Killing background daemon", "updateTo": "$RELEASE"}
EOF
pkill -f "\./karen"

# Start updated containers
echo "Starting new containers"
cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 80, "description": "Starting new containers", "updateTo": "$RELEASE"}
EOF
cd "$UMBREL_ROOT"
./scripts/start

# Delete obselete backup lock file
# https://github.com/getumbrel/umbrel/pull/213
# Remove this in the next breaking update
[[ -f "${UMBREL_ROOT}/statuses/backup-in-progress" ]] && rm -f "${UMBREL_ROOT}/statuses/backup-in-progress"

# Make Umbrel OS specific post-update changes
if [[ ! -z "${UMBREL_OS:-}" ]]; then

  # Delete unused Docker images on Umbrel OS
  echo "Deleting previous images"
  cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 90, "description": "Deleting previous images", "updateTo": "$RELEASE"}
EOF
  docker image prune --all --force

  # Uninstall dphys-swapfile since we now use our own swapfile logic
  # Remove this in the next breaking update
  if command -v dphys-swapfile >/dev/null 2>&1; then
    echo "Removing unused dependency \"dphys-swapfile\""
    cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 95, "description": "Removing unused dependencies", "updateTo": "$RELEASE"}
EOF
    apt-get remove -y dphys-swapfile
  fi

  # Setup swap if it doesn't already exist
  # Remove this in the next breaking update
  MOUNT_POINT="/mnt/data"
  SWAP_DIR="/swap"
  SWAP_FILE="${SWAP_DIR}/swapfile"
  if ! df -h "${SWAP_DIR}" 2> /dev/null | grep --quiet '/dev/sd'; then
    cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 97, "description": "Setting up swap", "updateTo": "$RELEASE"}
EOF

    echo "Bind mounting external storage to ${SWAP_DIR}"
    mkdir -p "${MOUNT_POINT}/swap" "${SWAP_DIR}"
    mount --bind "${MOUNT_POINT}/swap" "${SWAP_DIR}"

    echo "Checking ${SWAP_DIR} is now on external storage..."
    df -h "${SWAP_DIR}" | grep --quiet '/dev/sd'

    echo "Setting up swapfile"
    rm "${SWAP_FILE}" || true
    fallocate -l 4G "${SWAP_FILE}"
    chmod 600 "${SWAP_FILE}"
    mkswap "${SWAP_FILE}"
    swapon "${SWAP_FILE}"
  fi
fi
