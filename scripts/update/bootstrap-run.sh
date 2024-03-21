#!/usr/bin/env bash
set -euo pipefail

# This script needs to be in this exact location for legacy reasons.
# 
# It bootstraps the umbrelOS 1.0 update for old 0.5.x Umbrel installs.
# During OTA they download the latest release tarball from GitHub, extract
# it and then execute ./scripts/*-run.sh to process the update. So now we just
# have this ./scripts/bootstrap-run.sh in this exact location in the codebase
# so old Umbrel installs can bootstrap into the new mender based update system
# and reboot into the new OS.

RELEASE=$1
UMBREL_ROOT=$2
UPDATE_ROOT=$(readlink -f "${PWD}/../..")

# Make sure we correctly display an error if the bootstrap fails
function fail_update() {
  reason="${1}"
  echo "${reason}" | tee "${UMBREL_ROOT}/statuses/update-failure"
  echo "Update failed!"
  exit 1
}

function is_pi() {
  cat /proc/cpuinfo | grep --quiet 'Raspberry Pi'
}

function is_home() {
  dmidecode -t system | grep --silent 'Umbrel Home'
}

echo "Hardware support detection"

# Raspberry Pi
if is_pi
then
  echo "Raspberry Pi detected"
  fail_update "Please install umbrelOS 1.0 on your microSD card to update: https://link.umbrel.com/pi-update"
fi

# Not an Umbrel Home (custom Linux install)
if ! is_home
then
  echo "Custon Linux install detected"
  fail_update "umbrelOS 1.0 is not yet supported for custom Linux installs: https://link.umbrel.com/linux-update"
fi

# If we get here we're running on an Umbrel Home
echo "Umbrel Home detected"

# Flash new update
echo '{"state": "installing", "progress": 25, "description": "Installing umbrelOS 1.0, this may take a while", "updateTo": ""}' > "${UMBREL_ROOT}/statuses/update-status.json"
mender install https://download.umbrel.com/release/1.0.1/umbrelos-amd64.update

# Reboot
cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 97, "description": "Restarting Umbrel Home"}
EOF

# Sleep 5 seconds to give the frontend a chance to poll
# and pull in latest update status
echo "Sleeping 5 seconds"
sleep 5

# The following two cleanups shouldn't be needed since we'll reboot into a 1.0 install
# but we do it just incase something goes wrong and we end up back in 0.5.x

# Remove update lockfile so the next OTA update doesn't fail
rm -f "${UMBREL_ROOT}/statuses/update-in-progress"

# Write out a status file which will be used within scripts/start
# To complete the update when the system boots up again
touch "${UMBREL_ROOT}/statuses/umbrel-update-reboot-performed"
shutdown --reboot now
exit 0