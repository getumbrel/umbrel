#!/usr/bin/env bash
set -euo pipefail

RELEASE=$1
UMBREL_ROOT=$2

./check-memory "${RELEASE}" "${UMBREL_ROOT}" "notfirstrun"

echo
echo "======================================="
echo "=============== UPDATE ================"
echo "======================================="
echo "=========== Stage: Success ============"
echo "======================================="
echo

# Cleanup
echo "Removing backup"
cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 95, "description": "Removing backup"}
EOF
[[ -d "$UMBREL_ROOT"/.umbrel-backup ]] && rm -rf "$UMBREL_ROOT"/.umbrel-backup

REBOOT_REQUIRED_FILE="/tmp/umbrel-update-reboot-required"
if [[ -f "${REBOOT_REQUIRED_FILE}" ]]; then
	cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 97, "description": "Rebooting your Umbrel"}
EOF
	rm -f "${REBOOT_REQUIRED_FILE}"
	
	# Remove update lockfile so the next OTA update doesn't fail
	rm -f "${UMBREL_ROOT}/statuses/update-in-progress"
	
	# Sleep 5 seconds to give the frontend a chance to poll
	# and pull in latest update status
	echo "Sleeping 5 seconds"
	sleep 5

	# Write out a status file which will be used within scripts/start
	# To complete the update when the system boots up again
	touch "${UMBREL_ROOT}/statuses/umbrel-update-reboot-performed"
	shutdown --reboot now
	exit 0
fi

echo "Successfully installed Umbrel $RELEASE"
cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "success", "progress": 100, "description": "Successfully installed Umbrel $RELEASE", "updateTo": ""}
EOF
