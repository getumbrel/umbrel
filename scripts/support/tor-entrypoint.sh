#!/usr/bin/env bash

TORRC_PATH="/tmp/torrc"

echo "HiddenServiceDir ${HS_DIR}" > "${TORRC_PATH}"

# Loop through all ports we want to expose
# On this hidden service
for service in $HS_PORTS
do
  virtual_port=$(echo $service | cut -d : -f 1)
  source_host=$(echo $service | cut -d : -f 2)
  source_port=$(echo $service | cut -d : -f 3)
  echo "HiddenServicePort ${virtual_port} ${source_host}:${source_port}" >> "${TORRC_PATH}"
done

tor -f "${TORRC_PATH}"