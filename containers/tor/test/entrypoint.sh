#!/bin/bash

TORRC_PATH="/tmp/torrc"

echo "HiddenServiceDir /data/${HS_DIR}" > "${TORRC_PATH}"
echo "HiddenServicePort ${HS_VIRTUAL_PORT} ${HS_HOST}:${HS_PORT}" >> "${TORRC_PATH}"

tor -f "${TORRC_PATH}"