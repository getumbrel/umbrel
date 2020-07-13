#!/bin/bash -e

RELEASE=$1
UMBREL_ROOT=$2
UMBREL_USER=$3

echo "======================================="
echo "============= OTA UPDATE =============="
echo "======================================="
echo "=========== Stage: Success ============"
echo "======================================="
echo

# Delete previous (unused) images
echo "Deleting previous images"
cat <<EOF > $UMBREL_ROOT/statuses/update-status.json
{"state": "installing", "progress": 90, "description": "Deleting previous images"}
EOF
# docker image prune --all --force

# Cleanup
echo "Removing backup"
cat <<EOF > $UMBREL_ROOT/statuses/update-status.json
{"state": "installing", "progress": 95, "description": "Removing backup"}
EOF
[ -d /tmp/umbrel-backup ] && rm -rf /tmp/umbrel-backup

echo "Successfully installed Umbrel $RELEASE"
cat <<EOF > $UMBREL_ROOT/statuses/update-status.json
{"state": "success", "progress": 100, "description": "Successfully installed Umbrel $RELEASE"}
EOF