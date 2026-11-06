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

# Validate the config before launching tor. An invalid config (for example a
# HiddenServicePort target that tor can't parse, which happens for apps whose
# proxy host isn't resolvable such as `network_mode: host` apps) makes tor exit
# immediately. Combined with the `restart: on-failure` policy on the tor_server
# service, docker then recreates the container roughly once a minute, forever --
# silently pinning a CPU core and thermally throttling the whole device
# (observed in the wild: 40k+ restarts over 9 days, host stuck at 95C).
#
# Retrying in place with a backoff keeps a single long-lived container and
# surfaces the error in the logs, instead of an endless container-recreation
# storm. On the happy path `--verify-config` passes instantly and `exec tor`
# makes tor PID 1 so it still receives signals cleanly on container stop.
until tor --verify-config -f "${TORRC_PATH}"
do
  echo "tor-entrypoint: tor config is invalid (see errors above); retrying in 60s" >&2
  sleep 60
done

exec tor -f "${TORRC_PATH}"
