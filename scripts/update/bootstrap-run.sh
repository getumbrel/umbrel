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

# Save current images to clean up later
echo "Saving current Umbrel Docker images to clean up later"
compose_file="${UMBREL_ROOT}/docker-compose.yml"
echo "Reading file: ${compose_file}"
old_images=$(yq e '.services | map(select(.image != null)) | .[].image' "${compose_file}")
echo "${old_images}"

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

binary_source_location="${UPDATE_ROOT}/server/build/linux_${binary_arch}/umbreld"
binary_destination_location="${UMBREL_ROOT}/bin/umbreld"

# Download umbreld release binary if we don't have a local dev build
echo "Installing umbreld to \"${binary_destination_location}\""
echo '{"state": "installing", "progress": 25, "description": "Installing umbreld", "updateTo": ""}' > "${UMBREL_ROOT}/statuses/update-status.json"

if [[ -f "${binary_source_location}" ]]
then
  echo "Using local development binary at \"${binary_source_location}\""
  cp "${binary_source_location}" "${binary_destination_location}-new"
  mv "${binary_destination_location}-new" "${binary_destination_location}"
else
  # TODO: Ideally this would do a lookup to download.umbrel.com which would return a redirect to
  # the GitHub release asset. That way we have freedom to change the repo or not use GitHub releases
  # at all in the future.
  binary_url="https://github.com/getumbrel/umbrel/releases/download/${RELEASE}/umbreld-${RELEASE}-${binary_arch}.tar.gz"
  echo "Downloading umbreld from \"${binary_url}\""
  binary_containing_directory="${binary_destination_location%/*}"
  tmp_binary_containing_directory="${binary_containing_directory}/tmp"
  mkdir -p "${tmp_binary_containing_directory}"
  curl --fail --location "${binary_url}" | tar --extract --gzip --directory="${tmp_binary_containing_directory}"
  mv "${tmp_binary_containing_directory}/umbreld" "${binary_destination_location}"
  rm -rf "${tmp_binary_containing_directory}"
fi

echo "Running \"umbreld --update\""
echo '{"state": "installing", "progress": 50, "description": "Running Umbrel migrations", "updateTo": ""}' > "${UMBREL_ROOT}/statuses/update-status.json"
"${binary_destination_location}" --update "${UPDATE_ROOT}" "${UMBREL_ROOT}"

echo "Starting \"umbreld\""
echo '{"state": "installing", "progress": 75, "description": "Starting new services", "updateTo": ""}' > "${UMBREL_ROOT}/statuses/update-status.json"
"${UMBREL_ROOT}/scripts/start"

# Remove any old images we don't need anymore
echo "Deleting previous images"
echo '{"state": "success", "progress": 90, "description": "Deleting previous images", "updateTo": ""}' > "${UMBREL_ROOT}/statuses/update-status.json"
docker rmi $old_images || true

echo "Successfully installed Umbrel $RELEASE"
echo '{"state": "success", "progress": 100, "description": "Successfully installed Umbrel '$RELEASE'", "updateTo": ""}' > "${UMBREL_ROOT}/statuses/update-status.json"