#!/usr/bin/env bash
set -euo pipefail

RELEASE=$1
UMBREL_ROOT=$2

APP_ID="electrs"
CURRENT_DATA_FOLDER="${UMBREL_ROOT}/electrs"
NEW_DATA_FOLDER="${UMBREL_ROOT}/app-data/${APP_ID}/data"
TOR_DATA_DIR="${UMBREL_ROOT}/tor/data"

if [[ ! -d "${CURRENT_DATA_FOLDER}" ]]; then
	echo "Electrs has already been migrated"
	exit
fi

# Check that 'electrs' isn't already installed
if "${UMBREL_ROOT}/scripts/app" ls-installed | grep --quiet "^${APP_ID}$"; then
	>&2 echo "Error: app \"${APP_ID}\" is already installed"
	>&2 echo "Skipping migration..."
	exit
fi

cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 73, "description": "Migrating Electrs", "updateTo": "$RELEASE"}
EOF

# Install the app from the app repo
"${UMBREL_ROOT}/scripts/app" install "${APP_ID}" --skip-start

if [[ ! -d "${NEW_DATA_FOLDER}" ]]; then
	echo "Failed to migrate Electrs. Destination does not exist: ${NEW_DATA_FOLDER}"
	exit
fi

cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 74, "description": "Moving Electrs Data", "updateTo": "$RELEASE"}
EOF

# Migate Tor HSs
ELECTRS_HS_DIR="${TOR_DATA_DIR}/electrum"
if [[ -d "${ELECTRS_HS_DIR}" ]]; then
	mv "${ELECTRS_HS_DIR}" "${TOR_DATA_DIR}/app-${APP_ID}-rpc"
fi

# Remove an existing 'electrs' folder inside the 'data' folder
rm --recursive --force "${NEW_DATA_FOLDER}/electrs" || true

# Move Umbrel's current 'electrs' folder into the app's data folder
mv "${CURRENT_DATA_FOLDER}" "${NEW_DATA_FOLDER}"

# Some cleanup...
# We no longer need a config file as we
# can pass all the config via env. vars.
rm --force "${NEW_DATA_FOLDER}/electrs/electrs.toml" || true

echo "Electrs successfully migrated"