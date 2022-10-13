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

# Due to changes with how we handle app's Tor HSes
# We need update the affected apps

# Ensure we've pulled in all the latest app updates
"${UMBREL_ROOT}/scripts/repo" update || true

affected_apps="bitcoin core-lightning electrs elements gitea jam kollider lightning samourai-server sphinx-relay squeaknode suredbits-wallet synapse"

for app in $affected_apps
do
	if "${UMBREL_ROOT}/scripts/app" ls-installed | grep --quiet "${app}"
	then
		"${UMBREL_ROOT}/scripts/app" update "${app}" --skip-stop --skip-start || true
	fi
done