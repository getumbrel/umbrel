#!/usr/bin/env bash
set -euo pipefail

UMBREL_ENV_FILE="$(readlink -f $(dirname "${BASH_SOURCE[0]}")/../../../.env)"

COMPOSE_FILE="${1}"

# Some test env vars. for nextcloud
export APP_DOMAIN="localhost"
export APP_PASSWORD="password"

# Test env vars. for bitcoind
BIN_ARGS=()
BIN_ARGS+=( "-chain=regtest" )
BIN_ARGS+=( "-rpcport=18443" )
BIN_ARGS+=( "-rpcbind=0.0.0.0" )
BIN_ARGS+=( "-rpcallowip=0.0.0.0/0" )
BIN_ARGS+=( "-rpcuser=umbrel" )
BIN_ARGS+=( "-rpcpassword=bitcoinbitcoin" )
BIN_ARGS+=( "-txindex=1" )
BIN_ARGS+=( "-blockfilterindex=1" )
BIN_ARGS+=( "-peerbloomfilters=1" )
BIN_ARGS+=( "-peerblockfilters=1" )
BIN_ARGS+=( "-deprecatedrpc=addresses" )
BIN_ARGS+=( "-rpcworkqueue=128" )

export APP_BITCOIN_COMMAND=$(IFS=" "; echo "${BIN_ARGS[@]}")

# Env vars. specific to app proxy
export APP_PORT=$(cat fixtures/mempool-umbrel-app.yml | yq '.port')

echo "Proxy booting on port: ${APP_PORT}"

# Generate random project id
PROJECT=$(echo -n "${COMPOSE_FILE}" | sha256sum)

docker-compose --env-file "${UMBREL_ENV_FILE}" --project-name "${PROJECT}" -f ./docker-compose.yml -f "${COMPOSE_FILE}" up