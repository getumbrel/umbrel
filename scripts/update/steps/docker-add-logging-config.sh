#!/usr/bin/env bash
set -euo pipefail

DOCKER_DAEMON_CONF_FILE="/etc/docker/daemon.json"
DOCKER_DAEMON_BACKUP_CONF_FILE="/etc/docker/daemon.json.bak"

if [[ ! -f "${DOCKER_DAEMON_CONF_FILE}" ]]; then
	echo "{}" > "${DOCKER_DAEMON_CONF_FILE}"
fi

# Check if a 'log-driver' is already set
has_log_driver=$(cat "${DOCKER_DAEMON_CONF_FILE}" | jq '. | has("log-driver")')

if [[ "${has_log_driver}" == "true" ]]; then
  echo "Docker daemon 'log-driver' already set"
  exit
fi

echo "Adding logging config. to Docker daemon"

# Make a backup of daemon.json
cp --archive "${DOCKER_DAEMON_CONF_FILE}" "${DOCKER_DAEMON_BACKUP_CONF_FILE}"

output=$(jq '. + {"log-driver": "json-file", "log-opts": {"max-size": "50m", "max-file": "1"}}' "${DOCKER_DAEMON_CONF_FILE}")
echo "${output}" > "${DOCKER_DAEMON_CONF_FILE}"

has_log_driver_after=$(cat "${DOCKER_DAEMON_CONF_FILE}" 2> /dev/null | jq -r '. | has("log-driver")' || true)

# If an explicit 'true' does not come back
# Then something has gone wrong, and we'll restore
if [[ "${has_log_driver_after}" != "true" ]]; then
  echo "The Docker daemon.json now looks bad. Restoring..."
  
  mv "${DOCKER_DAEMON_BACKUP_CONF_FILE}" "${DOCKER_DAEMON_CONF_FILE}"
  
  exit
fi

rm --force "${DOCKER_DAEMON_BACKUP_CONF_FILE}"

echo "Successfully added default logging config to Docker daemon"