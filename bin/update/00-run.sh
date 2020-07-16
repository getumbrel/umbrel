#!/usr/bin/env bash
set -euo pipefail

RELEASE=$1
UMBREL_ROOT=$2
UMBREL_USER=$3

echo
echo "======================================="
echo "============= OTA UPDATE =============="
echo "======================================="
echo "========= Stage: Pre-update ==========="
echo "======================================="
echo

# Make sure any previous backup doesn't exist 
if [[ -d /tmp/umbrel-backup ]]; then
    echo "Cannot install update. A previous backup already exists at /tmp/umbrel-backup"
    echo "This can only happen if the previous update installation wasn't successful"
    exit 1
fi

echo "Installing Umbrel $RELEASE at $UMBREL_ROOT"

# Update status file
cat <<EOF > $UMBREL_ROOT/statuses/update-status.json
{"state": "installing", "progress": 20, "description": "Backing up"}
EOF

# Fix permissions
echo "Fixing permissions"
chown -R $UMBREL_USER:$UMBREL_USER $UMBREL_ROOT/

# Backup
echo "Backing up existing directory tree"
rsync -av $UMBREL_ROOT/ \
    --exclude='.*' \
    --exclude='bitcoin' \
    --exclude='db' \
    --exclude='lnd' \
    --exclude='secrets' \
    --exclude='signals' \
    --exclude='statuses' \
    --exclude='tor' \
    /tmp/umbrel-backup/

echo "Successfully backed up to /tmp/umbrel-backup"
