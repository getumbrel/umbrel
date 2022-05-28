#!/usr/bin/env bash
set -euo pipefail

RELEASE=$1
UMBREL_ROOT=$2

APP_REPOS_MIGRATION_DONE_FILE="${UMBREL_ROOT}/db/.app-repos-migration"

if [[ -f "${APP_REPOS_MIGRATION_DONE_FILE}" ]]; then
  echo "Migration to app repos already completed"
  exit
fi

echo "Migrating apps to use app repos"

cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 70, "description": "Reconfiguring apps", "updateTo": "$RELEASE"}
EOF

# 1. Install 'gettext-base' if not installed
# This needed for 'envsubst' which is used for templating
REQUIRED_PKG="gettext-base"
PKG_OK=$(dpkg-query -W --showformat='${Status}\n' $REQUIRED_PKG | grep "install ok installed")
if [[ "" = "${PKG_OK}" ]]; then
  apt-get --yes install "${REQUIRED_PKG}"
fi

# 2. Set the default remote app remote (Add 'appRepo' to db/user.json)
DEFAULT_UMBREL_APP_REPO_URL=$("${UMBREL_ROOT}/scripts/repo" default-repo)
echo "Adding default Umbrel app repo: ${DEFAULT_UMBREL_APP_REPO_URL}"
"${UMBREL_ROOT}/scripts/repo" set "${DEFAULT_UMBREL_APP_REPO_URL}"

# 3. Clone remote repo locally
"${UMBREL_ROOT}/scripts/repo" update || true

# Check whether repo was actually cloned
# By checking there is a README.md in the local app repo
LOCAL_REPO_PATH=$($UMBREL_ROOT/scripts/repo path)
if [[ ! -f "${LOCAL_REPO_PATH}/README.md" ]]; then
  echo "Failed to clone remote app repo: ${DEFAULT_UMBREL_APP_REPO_URL}"
  exit 1
fi

# 4. Update all apps using the app repo as source of truth
for app in $("${UMBREL_ROOT}/scripts/app" ls-installed); do
  if [[ "${app}" != "" ]]; then
    # We typically want to stop and start during an app update
    # However here we don't want this. Apps need to be updated avoiding 
    # the 'stop' to avoid missing env errors
    # And we can skip start as later in the update process, this happens automatically
    "${UMBREL_ROOT}/scripts/app" update "${app}" --skip-stop --skip-start
  fi
done

# 5. Migrate Bitcoin, LND and Electrs
"${UMBREL_ROOT}/scripts/update/steps/migrate-bitcoin.sh" "${RELEASE}" "${UMBREL_ROOT}"
"${UMBREL_ROOT}/scripts/update/steps/migrate-lnd.sh" "${RELEASE}" "${UMBREL_ROOT}"
"${UMBREL_ROOT}/scripts/update/steps/migrate-electrs.sh" "${RELEASE}" "${UMBREL_ROOT}"

# 6. Record that the migration is done
# So that it doesn't execute again
touch "${APP_REPOS_MIGRATION_DONE_FILE}"

echo "Successfully migrated to enable app repos"