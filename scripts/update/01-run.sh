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

updateStatus() {
  local -r state="installing"
  local -r progress="${1}"
  local -r description="${2}"

  cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "${state}", "progress": ${progress}, "description": "${description}", "updateTo": "${RELEASE}"}
EOF
}

[[ -f "/etc/default/umbrel" ]] && source "/etc/default/umbrel"

# Make Umbrel OS specific updates
if [[ ! -z "${UMBREL_OS:-}" ]]; then
    echo
    echo "============================================="
    echo "Installing on Umbrel OS $UMBREL_OS"
    echo "============================================="
    echo

    updateStatus 30 "Updating Umbrel OS"

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

    # This makes sure systemd services are always updated (and new ones are enabled).
    UMBREL_SYSTEMD_SERVICES="${UMBREL_ROOT}/.umbrel-${RELEASE}/scripts/umbrel-os/services/*.service"
    for service_path in $UMBREL_SYSTEMD_SERVICES; do
      service_name=$(basename "${service_path}")
      install -m 644 "${service_path}" "/etc/systemd/system/${service_name}"
      systemctl enable "${service_name}"
    done

    # Install fio which is used to check for SD card health
    if ! command -v fio &> /dev/null; then
        DEBIAN_FRONTEND=noninteractive apt-get install fio -y
    fi
fi

# Checkout the new release...
# To run the updated configure script
# And pull updated Umbrel docker images
cd "$UMBREL_ROOT"/.umbrel-"$RELEASE"

# Configure new install
echo "Configuring new release"
updateStatus 40 "Configuring new release"

PREV_ENV_FILE="${UMBREL_ROOT}/.env" ./scripts/configure

# Pulling new containers
echo "Pulling new containers"
updateStatus 50 "Pulling new containers"

docker-compose pull

# Change back to main install dir
cd "$UMBREL_ROOT"

# Save current images to clean up later
echo "Saving current Umbrel Docker images to clean up later"
compose_file="${UMBREL_ROOT}/docker-compose.yml"
echo "Reading file: ${compose_file}"
old_images=$(yq e '.services | map(select(.image != null)) | .[].image' "${compose_file}")
echo "${old_images}"

# Stop existing containers
echo "Stopping existing containers"
updateStatus 60 "Stopping existing containers"

cd "$UMBREL_ROOT"
./scripts/stop || {
  # If Docker fails to stop containers we're most likely 
  # hitting the 'network has active endponts' Docker bug
  # More info here: https://github.com/moby/moby/issues/17217
  # Restarting the Docker service seems to fix it
  echo "Attempting to autofix Docker failure"
  updateStatus 65 "Attempting to autofix Docker failure"

  sudo systemctl restart docker || true # Soft fail on environments that don't use systemd
  sleep 1
  ./scripts/stop || {
    # If this doesn't resolve the issue, start containers again before failing so the web UI is still accessible
    echo "That didn't work, attempting to restart containers"
    ./scripts/start
    echo "Error stopping Docker containers" > "${UMBREL_ROOT}/statuses/update-failure"
    false
  }
}

# Restart Docker to resolve:
# - This error could happen when pulling new images:
#   ERROR: Get "https://registry-1.docker.io/v2/": net/http: TLS handshake timeout
echo "Restarting Docker"
systemctl restart docker || true # Soft fail on environments that don't use systemd
sleep 1

# Overlay home dir structure with new dir tree
echo "Overlaying $UMBREL_ROOT/ with new directory tree"
rsync --archive \
    --verbose \
    --include-from="$UMBREL_ROOT/.umbrel-$RELEASE/scripts/update/.updateinclude" \
    --exclude-from="$UMBREL_ROOT/.umbrel-$RELEASE/scripts/update/.updateignore" \
    --delete \
    "$UMBREL_ROOT"/.umbrel-"$RELEASE"/ \
    "$UMBREL_ROOT"/

# Migrate current apps to support third party app repos
"${UMBREL_ROOT}/scripts/update/steps/migrate-third-party-repos.sh" "$RELEASE" "$UMBREL_ROOT"

# Add user setting to enable/disable remote tor access
"${UMBREL_ROOT}/scripts/update/steps/support-remote-tor-access.sh" "$RELEASE" "$UMBREL_ROOT"

# Fix permissions
echo "Fixing permissions"
find "$UMBREL_ROOT" -path "$UMBREL_ROOT/app-data" -prune -o -exec chown 1000:1000 {} +
if [[ -d "${UMBREL_ROOT}/tor/data" ]]; then
  chmod -R 700 "$UMBREL_ROOT"/tor/data/* || true
fi

# Start updated containers
echo "Starting new containers"
updateStatus 80 "Starting new containers"

cd "$UMBREL_ROOT"
./scripts/start

# Remove any old images we don't need anymore
echo "Cleaning up old Docker images..."
docker rmi $old_images || true

# Make Umbrel OS specific post-update changes
if [[ ! -z "${UMBREL_OS:-}" ]]; then

  # Delete unused Docker images on Umbrel OS
  echo "Deleting previous images"
  updateStatus 90 "Deleting previous images"

  docker image prune --all --force
fi
