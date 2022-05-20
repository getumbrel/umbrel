#!/usr/bin/env bash
set -euo pipefail

RELEASE=$1
UMBREL_ROOT=$2

APP_ID="lightning"
CURRENT_DATA_FOLDER="${UMBREL_ROOT}/lnd"
NEW_DATA_FOLDER="${UMBREL_ROOT}/app-data/${APP_ID}/data"
LIGHTNING_APP_DATA_FOLDER="${NEW_DATA_FOLDER}/lightning"
TOR_DATA_DIR="${UMBREL_ROOT}/tor/data"

if [[ ! -d "${CURRENT_DATA_FOLDER}" ]]; then
	echo "LND has already been migrated"
	exit
fi

# Check that 'lightning' isn't already installed
if "${UMBREL_ROOT}/scripts/app" ls-installed | grep --quiet "^${APP_ID}$"; then
	>&2 echo "Error: app \"${APP_ID}\" is already installed"
	>&2 echo "Skipping migration..."
	exit
fi

cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 73, "description": "Migrating LND", "updateTo": "$RELEASE"}
EOF

# Install the app from the app repo
"${UMBREL_ROOT}/scripts/app" install "${APP_ID}" --skip-start

if [[ ! -d "${NEW_DATA_FOLDER}" ]]; then
	echo "Failed to migrate LND. Destination does not exist: ${NEW_DATA_FOLDER}"
	exit
fi

cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 74, "description": "Moving LND Data", "updateTo": "$RELEASE"}
EOF

# Set some default state for the app
cat <<EOF > "${LIGHTNING_APP_DATA_FOLDER}/state.json"
{"acceptedTerms": true, "seed": [], "seedMigrated": false}
EOF

# Migate Tor HSs
LND_GRPC_HS_DIR="${TOR_DATA_DIR}/lnd-rest"
if [[ -d "${LND_GRPC_HS_DIR}" ]]; then
	mv "${LND_GRPC_HS_DIR}" "${TOR_DATA_DIR}/app-${APP_ID}-rest"
fi
LND_REST_HS_DIR="${TOR_DATA_DIR}/lnd-grpc"
if [[ -d "${LND_REST_HS_DIR}" ]]; then
	mv "${LND_REST_HS_DIR}" "${TOR_DATA_DIR}/app-${APP_ID}-grpc"
fi

# Remove an existing 'lnd' folder inside the 'data' folder
rm --recursive --force "${NEW_DATA_FOLDER}/lnd" || true

# Lastly, move Umbrel's current 'lnd' folder into the app's data folder
# 'lightning' will then mount 'lnd' inside 'data' folder
mv "${CURRENT_DATA_FOLDER}" "${NEW_DATA_FOLDER}"

echo "LND successfully migrated"