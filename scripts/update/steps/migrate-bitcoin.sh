#!/usr/bin/env bash
set -euo pipefail

RELEASE=$1
UMBREL_ROOT=$2

APP_ID="bitcoin"
CURRENT_DATA_FOLDER="${UMBREL_ROOT}/bitcoin"
NEW_DATA_FOLDER="${UMBREL_ROOT}/app-data/${APP_ID}/data"
TOR_DATA_DIR="${UMBREL_ROOT}/tor/data"

if [[ ! -d "${CURRENT_DATA_FOLDER}" ]]; then
	echo "Bitcoin has already been migrated"
	exit
fi

# Check that 'bitcoin' isn't already installed
if "${UMBREL_ROOT}/scripts/app" ls-installed | grep --quiet "^${APP_ID}$"; then
	>&2 echo "Error: app \"${APP_ID}\" is already installed"
	>&2 echo "Skipping migration..."
	exit
fi

cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 71, "description": "Migrating Bitcoin", "updateTo": "$RELEASE"}
EOF

# Install the app from the app repo
"${UMBREL_ROOT}/scripts/app" install "${APP_ID}" --skip-start

if [[ ! -d "${NEW_DATA_FOLDER}" ]]; then
	echo "Failed to migrate Bitcoin. Destination does not exist: ${NEW_DATA_FOLDER}"
	exit
fi

cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 72, "description": "Moving Bitcoin Data", "updateTo": "$RELEASE"}
EOF

# Migate Tor HSs
BITCOIN_RPC_HS_DIR="${TOR_DATA_DIR}/bitcoin-rpc"
if [[ -d "${BITCOIN_RPC_HS_DIR}" ]]; then
	mv "${BITCOIN_RPC_HS_DIR}" "${TOR_DATA_DIR}/app-${APP_ID}-rpc"
fi
BITCOIN_P2P_HS_DIR="${TOR_DATA_DIR}/bitcoin-p2p"
if [[ -d "${BITCOIN_P2P_HS_DIR}" ]]; then
	mv "${BITCOIN_P2P_HS_DIR}" "${TOR_DATA_DIR}/app-${APP_ID}-p2p"
fi

# Remove an existing 'bitcoin' folder inside the 'data' folder
rm --recursive --force "${NEW_DATA_FOLDER}/bitcoin" || true

# Move Umbrel's current 'bitcoin' folder into the app's data folder
# 'bitcoin' will then mount 'bitcoin' inside 'data' folder
mv "${CURRENT_DATA_FOLDER}" "${NEW_DATA_FOLDER}"

# Some cleanup...
# We no longer need a config file as we
# can pass all the config via command line args.
rm --force "${NEW_DATA_FOLDER}/bitcoin/bitcoin.conf" || true

echo "Bitcoin successfully migrated"