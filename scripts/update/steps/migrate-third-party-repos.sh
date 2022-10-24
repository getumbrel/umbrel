#!/usr/bin/env bash
set -euo pipefail

RELEASE=$1
UMBREL_ROOT=$2

USER_FILE="${UMBREL_ROOT}/db/user.json"
DEFAULT_UMBREL_APP_REPO_URL="https://github.com/getumbrel/umbrel-apps.git"

HAS_USER_REPOS=$(cat "${USER_FILE}" | jq ". | has(\"repos\")")

if [[ "${HAS_USER_REPOS}" == "true" ]]; then
  echo "Already migrated to enable third party app repos"
  exit
fi

echo "Migrating to enable third party app repos"

echo
echo "Setting default app repo remote: ${DEFAULT_UMBREL_APP_REPO_URL}"

updated_json=$(cat "${USER_FILE}" | jq ".repos |= (. + [\"${DEFAULT_UMBREL_APP_REPO_URL}\"])")
echo "${updated_json}" > "${USER_FILE}"

echo
echo "Setting the app origin for all app"

current_repo_url=$(cat "${USER_FILE}" | jq -r ".appRepo")
umbrel_repo_path=$("${UMBREL_ROOT}/scripts/repo" path "${DEFAULT_UMBREL_APP_REPO_URL}")

apps=$(cat "${USER_FILE}" 2> /dev/null | jq -r 'if has("installedApps") then .installedApps else [] end | join("\n")' || true)
for app in $apps; do
  echo "Add origin for: ${app}"

  updated_json=$(cat "${USER_FILE}" | jq ".appOrigin |= (. + {\"${app}\":\"${DEFAULT_UMBREL_APP_REPO_URL}\"})")
  echo "${updated_json}" > "${USER_FILE}"
done
  
echo
echo "Remove 'appRepo' property"
updated_json=$(cat "${USER_FILE}" | jq "del(.appRepo)")
echo "${updated_json}" > "${USER_FILE}"

echo "Successfully migrated to enable third party app repos"