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

cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 33, "description": "Configuring settings", "updateTo": "$RELEASE"}
EOF

# Checkout to the new release
cd "$UMBREL_ROOT"/.umbrel-"$RELEASE"

# Update RPC Password in docker-compose.yml
# Get gnu sed
gnused=sed
if [[ "$(uname)" == "Darwin" ]]; then
  if ! command -v gsed >/dev/null 2>&1; then
    echo "Error: This script requires gnu-sed!"
    echo "Install it with:"
    echo "  brew install gnu-sed"
    exit 1
  fi
  gnused=gsed
fi

echo "Updating RPC Password in docker-compose.yml"
RPCPASS=$(cat "$UMBREL_ROOT"/secrets/rpcpass.txt)
$gnused -i "s/RPCPASS/${RPCPASS}/g;" docker-compose.yml

# echo "Setting regtest"
# $gnused -i 's/mainnet/regtest/g; ' docker-compose.yml
# $gnused -i "s/RPCPORT/18443/g;" docker-compose.yml

echo "Setting mainnet"
$gnused -i "s/RPCPORT/8332/g;" docker-compose.yml

if [[ "$HOSTNAME" != "umbrel" ]]; then
  echo "Changing hostname to http://$HOSTNAME.local"
  $gnused -i "s/umbrel.local/${HOSTNAME}.local/g;" docker-compose.yml
fi


# Pull new images
echo "Pulling new images"
cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 40, "description": "Downloading new Docker images", "updateTo": "$RELEASE"}
EOF
cd "$UMBREL_ROOT"/.umbrel-"$RELEASE"
docker-compose pull

# Stop existing containers
echo "Stopping existing containers"
cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 70, "description": "Removing old containers", "updateTo": "$RELEASE"}
EOF
cd "$UMBREL_ROOT"
docker-compose down

# Overlay home dir structure with new dir tree
echo "Overlaying $UMBREL_ROOT/ with new directory tree"
rsync -av "$UMBREL_ROOT"/.umbrel-"$RELEASE"/ \
    --exclude-from="$UMBREL_ROOT/.umbrel-$RELEASE/bin/update/.updateignore" \
    "$UMBREL_ROOT"/

# Fix permissions
echo "Fixing permissions"
chown -R 1000:1000 "$UMBREL_ROOT"/
chmod -R 700 "$UMBREL_ROOT"/tor/data/*

# Start updated containers
echo "Starting new containers"
cat <<EOF > "$UMBREL_ROOT"/statuses/update-status.json
{"state": "installing", "progress": 80, "description": "Starting new containers", "updateTo": "$RELEASE"}
EOF
cd "$UMBREL_ROOT"
docker-compose up --detach --remove-orphans
