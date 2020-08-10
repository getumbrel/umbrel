#!/usr/bin/env bash
set -euo pipefail

RELEASE=$1
UMBREL_ROOT=$2

echo
echo "======================================="
echo "============= OTA UPDATE =============="
echo "======================================="
echo "=========== Stage: Install ============"
echo "======================================="
echo

[[ -f "/etc/default/umbrel" ]] && source "/etc/default/umbrel"

if [[ ! -z "${UMBREL_OS:-}" ]]; then
    echo 
    echo "============================================="
    echo "=== Installing on Umbrel OS $UMBREL_OS ==="
    echo "============================================="
    echo 

    echo "Copying new release from external storage to a temporary directory on the SD card"

    # Cleanup any tmp dir from unclean install run
    [[ -d "/home/umbrel/.umbrel-${RELEASE}" ]] && rm -rf "/home/umbrel/.umbrel-${RELEASE}"

    # Copy from external storage to SD card
    mkdir -p "/home/umbrel/.umbrel-$RELEASE"
    cp  --recursive \
        --archive \
        --no-target-directory \
        "$UMBREL_ROOT/.umbrel-$RELEASE" "/home/umbrel/.umbrel-$RELEASE"
fi

cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 33, "description": "Configuring settings", "updateTo": "$RELEASE"}
EOF

# Checkout to the new release
cd "$UMBREL_ROOT"/.umbrel-"$RELEASE"

# Configure new install
echo "Configuring new release"
cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 40, "description": "Configuring new release", "updateTo": "$RELEASE"}
EOF

BITCOIN_NETWORK="mainnet"
[[ -f "$UMBREL_ROOT/.env" ]] && source "$UMBREL_ROOT/.env"
NETWORK=$BITCOIN_NETWORK ./scripts/configure

# Stop existing containers
echo "Stopping existing containers"
cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 70, "description": "Removing old containers", "updateTo": "$RELEASE"}
EOF
cd "$UMBREL_ROOT"
./scripts/stop

# Overlay home dir structure with new dir tree
echo "Overlaying $UMBREL_ROOT/ with new directory tree"
rsync -av \
    --include-from="$UMBREL_ROOT/.umbrel-$RELEASE/scripts/update/.updateinclude" \
    --exclude-from="$UMBREL_ROOT/.umbrel-$RELEASE/scripts/update/.updateignore" \
    "$UMBREL_ROOT"/.umbrel-"$RELEASE"/ \
    "$UMBREL_ROOT"/

# Fix permissions
echo "Fixing permissions"
chown -R 1000:1000 "$UMBREL_ROOT"/
chmod -R 700 "$UMBREL_ROOT"/tor/data/*

# Update SD card installation on Umbrel OS by temporarily
# removing the bind-mount
if [[ ! -z "${UMBREL_OS:-}" ]]; then
    if mountpoint -q /home/umbrel/umbrel ; then
        echo "/home/umbrel/umbrel is bind-mounted" 
        echo "Removing bind-mount to update installation on the SD card"
        cd /home/umbrel

        # We lazy unmount here because regular unmount wouldn't be possible as
        # karen is watching /home/umbrel/umbrel/events/signals, and thus the
        # storage will be busy
        umount --lazy /home/umbrel/umbrel
        echo "Successfully removed the bind-mount"
        sync
        sleep 1

        echo "Replacing /home/umbrel/umbrel on SD card with the new release"
        rsync -av \
            --delete \
            "/home/umbrel/.umbrel-${RELEASE}/" \
            "/home/umbrel/umbrel/"
        rm -rf "/home/umbrel/.umbrel-${RELEASE}"
        echo "Fixing permissions"
        chown -R 1000:1000 "/home/umbrel/umbrel/"

        echo "Remounting /mnt/data/umbrel to /home/umbrel/umbrel"
        mount --bind /mnt/data/umbrel /home/umbrel/umbrel
        echo "Successfully mounted"
        sync
        sleep 1
    else
        echo "No bind mount found at /home/umbrel/umbrel"
        echo "Removing temporary release directory"
        [[ -d "/home/umbrel/.umbrel-${RELEASE}" ]] && rm -rf "/home/umbrel/.umbrel-${RELEASE}"
    fi
fi

# Start updated containers
echo "Starting new containers"
cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 80, "description": "Starting new containers", "updateTo": "$RELEASE"}
EOF
cd "$UMBREL_ROOT"
./scripts/start
