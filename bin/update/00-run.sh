#!/bin/bash -e

RELEASE=$1
UMBREL_PATH=$2
UMBREL_USER=$3

echo "==== OTA UPDATE ===== | STAGE: PRE-UPDATE"
echo "Installing Umbrel $1 at $2"

# Update status file
cat <<EOF > $UMBREL_PATH/bin/update/status.json
{"state": "installing", "progress": 20, "description": "Backing up"}
EOF

# Cleanup just in case there's temp stuff lying around from previous update
echo "Cleaning up any previous backup"
[ -d /tmp/umbrel-backup ] && rm -rf /tmp/umbrel-backup

# Fix permissions
echo "Fixing permissions"
chown -R $UMBREL_USER:$UMBREL_USER $UMBREL_PATH/

# Backup
echo "Backing up existing directory tree"
rsync -av $UMBREL_PATH/ \
    --exclude='.*' \
    --exclude='bitcoin' \
    --exclude='lnd' \
    --exclude='db' \
    --exclude='secrets' \
    --exclude='tor' \
    /tmp/umbrel-backup/

echo "Successfully backed up to /tmp/umbrel-backup"