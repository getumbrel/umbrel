#!/usr/bin/env bash
set -euo pipefail

RELEASE=$1
UMBREL_ROOT=$2

./check-memory "${RELEASE}" "${UMBREL_ROOT}" "firstrun"

echo
echo "======================================="
echo "=============== UPDATE ================"
echo "======================================="
echo "========= Stage: Pre-update ==========="
echo "======================================="
echo

# Make sure any previous backup doesn't exist
if [[ -d "$UMBREL_ROOT"/.umbrel-backup ]]; then
    echo "Cannot install update. A previous backup already exists at $UMBREL_ROOT/.umbrel-backup"
    echo "This can only happen if the previous update installation wasn't successful"
    exit 1
fi

echo "Installing Umbrel $RELEASE at $UMBREL_ROOT"

# A user could have Pihole installed (via Umbrel)
# and use this for their network's DNS (ie they set
# this in their router's DHCP settings)
# During an update, all apps get stopped (including Pihole), 
# which will break DNS for the Umbrel server (ie itself)
# as it cannot resolve DNS queries and therefore
# the update process cannot e.g. pull new Docker images...
# From here onwards, we'll use public DNS servers
# and restore their DNS config. after the update

# Create a backup of the current /etc/resolv.conf
RESOLV_CONF_FILE="/etc/resolv.conf"
RESOLV_CONF_BACKUP_FILE="/tmp/resolv.conf"
cat "${RESOLV_CONF_FILE}" > "${RESOLV_CONF_BACKUP_FILE}"

# Use Cloudflare and Google public DNS servers for update
echo "nameserver 1.1.1.1" > "${RESOLV_CONF_FILE}"
echo "nameserver 8.8.8.8" >> "${RESOLV_CONF_FILE}"

# Update status file
cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 20, "description": "Backing up", "updateTo": "$RELEASE"}
EOF

# Fix permissions
echo "Fixing permissions"
find "$UMBREL_ROOT" -path "$UMBREL_ROOT/app-data" -prune -o -exec chown 1000:1000 {} +

# Backup
echo "Backing up existing directory tree"

rsync -av \
    --include-from="$UMBREL_ROOT/.umbrel-$RELEASE/scripts/update/.updateinclude" \
    --exclude-from="$UMBREL_ROOT/.umbrel-$RELEASE/scripts/update/.updateignore" \
    "$UMBREL_ROOT"/ \
    "$UMBREL_ROOT"/.umbrel-backup/

echo "Successfully backed up to $UMBREL_ROOT/.umbrel-backup"
