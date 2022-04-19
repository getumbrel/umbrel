#!/usr/bin/env bash
set -euo pipefail

RELEASE=$1
UMBREL_ROOT=$2

DEFAULT_UMBREL_APP_REPO_URL="git@github.com:nevets963/umbrel-repo.git"

APP_REPOS_MIGRATION_DONE_FILE="${UMBREL_ROOT}/db/.app-repos-migration"

if [[ ! -f "${APP_REPOS_MIGRATION_DONE_FILE}" ]]; then
  echo "Migrating apps to use app repos"

  cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 70, "description": "Reconfiguring apps", "updateTo": "$RELEASE"}
EOF
  
  # 1. Install 'gettext-base' if not installed (needed for envsubst)
  REQUIRED_PKG="gettext-base"
  PKG_OK=$(dpkg-query -W --showformat='${Status}\n' $REQUIRED_PKG | grep "install ok installed")
  if [[ "" = "${PKG_OK}" ]]; then
    apt-get --yes install "${REQUIRED_PKG}"
  fi

  # 2. Set the default remote app remote (Add 'appRepo' to db/user.json)
  echo "Adding default Umbrel app repo: ${DEFAULT_UMBREL_APP_REPO_URL}"
  $UMBREL_ROOT/scripts/repo set "${DEFAULT_UMBREL_APP_REPO_URL}"

  # 3. Clone remote repo locally
  $UMBREL_ROOT/scripts/repo update

  # 4. Update all apps using the app repo as source of truth
  for app in $("${UMBREL_ROOT}/scripts/app" ls-installed); do
    if [[ "${app}" != "" ]]; then
      echo "Copy apps/${app} to app-data/${app}..."
      
      # We typically want to stop and start during an app update
      # However here we don't want this. Apps need to be updated avoiding 
      # the 'stop' to avoid missing env errors
      # And we can skip start as later in the update process, this happens automatically
      "${UMBREL_ROOT}/scripts/app" update "${app}" --skip-stop --skip-start
    fi
  done

  # 5. Record that the migration is done
  # So that it doesn't execute again
  touch "${APP_REPOS_MIGRATION_DONE_FILE}"
  
fi