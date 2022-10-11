#!/usr/bin/env bash
set -euo pipefail

RELEASE=$1
UMBREL_ROOT=$2

USER_FILE="${UMBREL_ROOT}/db/user.json"

HAS_REMOTE_TOR_ACCESS=$(cat "${USER_FILE}" | jq 'has("remoteTorAccess")')

if [[ "${HAS_REMOTE_TOR_ACCESS}" == "true" ]]; then
	echo "'remoteTorAccess' user setting already setup..."
	
	exit
fi

echo "Adding 'remoteTorAccess' user setting..."

# Default to true for existing Umbrel users
# The default for new installs will be false
jq ".remoteTorAccess = true" "${USER_FILE}" > /tmp/user.json
mv /tmp/user.json "${USER_FILE}"