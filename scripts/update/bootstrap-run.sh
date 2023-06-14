#!/usr/bin/env bash
set -euo pipefail

RELEASE=$1
UMBREL_ROOT=$2
UPDATE_ROOT=$(readlink -f "${PWD}/../..")

echo "Bootstrapping umbreld"

# Make sure we correctly display an error if the bootstrap fails
function show_error {
  echo "Update failed!"
  echo "Error bootstrapping umbrel server" > "${UMBREL_ROOT}/statuses/update-failure"
}
trap show_error ERR

# Map uname architecture to umbreld architecture
machine_arch="$(uname --machine)"
if [[ "${machine_arch}" = "x86_64" ]]
then
  binary_arch="amd64"
elif [[ "${machine_arch}" = "aarch64" ]]
then
  binary_arch="arm64"
else
  echo "Unsupported architecture: ${machine_arch}"
  exit 1
fi
echo "Detected architecture: ${binary_arch}"

binary_source_location="${UPDATE_ROOT}/server/build/umbreld-${binary_arch}"
binary_destination_location="${UMBREL_ROOT}/bin/umbreld"

# Download umbreld release binary if we don't have a local dev build
if [[ -f "${binary_source_location}" ]]
then
  echo "Using local development binary at \"${binary_source_location}\""
else
  # TODO: Ideally this would do a lookup to download.umbrel.com which would return a redirect to
  # the GitHub release asset. That way we have freedom to change the repo or not use GitHub releases
  # at all in the future.
  binary_url="https://github.com/getumbrel/umbrel/releases/download/v${RELEASE}/umbreld-${binary_arch}"
  echo "Downloading umbreld from \"${binary_url}\""
  mkdir -p "${binary_source_location%/*}"
  # TODO: Test this code actually works
  curl --fail --output "${binary_source_location}" "${binary_url}"
fi


echo "Installing umbreld to \"${binary_destination_location}\""
echo '{"state": "installing", "progress": 25, "description": "Installing umbreld", "updateTo": ""}' > "${UMBREL_ROOT}/statuses/update-status.json"
cp "${binary_source_location}" "${binary_destination_location}-new"
mv "${binary_destination_location}-new" "${binary_destination_location}"

echo "Running \"umbreld --update\""
echo '{"state": "installing", "progress": 50, "description": "Running Umbrel migrations", "updateTo": ""}' > "${UMBREL_ROOT}/statuses/update-status.json"
"${binary_destination_location}" --update "${UPDATE_ROOT}" "${UMBREL_ROOT}"

echo "Starting \"umbreld\""
echo '{"state": "installing", "progress": 75, "description": "Starting new services", "updateTo": ""}' > "${UMBREL_ROOT}/statuses/update-status.json"
"${UMBREL_ROOT}/scripts/start"

echo "Successfully installed Umbrel $RELEASE"
echo '{"state": "success", "progress": 100, "description": "Successfully installed Umbrel '$RELEASE'", "updateTo": ""}' > "${UMBREL_ROOT}/statuses/update-status.json"