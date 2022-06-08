#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${1}"

# Some test env vars. for nextcloud
export APP_DOMAIN="localhost"
export APP_PASSWORD="password"

# Env vars. specific to app proxy
export APP_PORT=$(cat fixtures/mempool-umbrel-app.yml | yq '.port')

echo "Proxy booting on port: ${APP_PORT}"

# Generate random project id
PROJECT=$(echo -n "${COMPOSE_FILE}" | sha256sum)

export MANAGER_IP="10.21.21.4"

docker-compose --project-name "${PROJECT}" -f ./docker-compose.yml -f "${COMPOSE_FILE}" up