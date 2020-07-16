#!/usr/bin/env bash
set -euo pipefail

RELEASE=$1
UMBREL_ROOT=$2
UMBREL_USER=$3

echo
echo "======================================="
echo "============= OTA UPDATE =============="
echo "======================================="
echo "=========== Stage: Install ============"
echo "======================================="
echo

cat <<EOF > $UMBREL_ROOT/statuses/update-status.json
{"state": "installing", "progress": 33, "description": "Configuring settings"}
EOF

# Checkout to the new release
cd $UMBREL_ROOT/.umbrel-$RELEASE

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
RPCPASS=$(cat $UMBREL_ROOT/secrets/rpcpass.txt)
$gnused -i "s/RPCPASS/${RPCPASS}/g;" docker-compose.yml

echo "Setting regtest"
$gnused -i 's/mainnet/regtest/g; ' docker-compose.yml
$gnused -i "s/RPCPORT/18443/g;" docker-compose.yml

# Pull new images
echo "Pulling new images"
cat <<EOF > $UMBREL_ROOT/statuses/update-status.json
{"state": "installing", "progress": 40, "description": "Downloading new Docker images"}
EOF
docker-compose --file $UMBREL_ROOT/.umbrel-$RELEASE/docker-compose.yml pull

# Stop existing containers
echo "Stopping existing containers"
cat <<EOF > $UMBREL_ROOT/statuses/update-status.json
{"state": "installing", "progress": 70, "description": "Removing old containers"}
EOF
su - $UMBREL_USER -c "cd $UMBREL_ROOT; docker-compose down"

# Overlay home dir structure with new dir tree
echo "Overlaying $UMBREL_ROOT/ with new directory tree"
rsync -av $UMBREL_ROOT/.umbrel-$RELEASE/ \
    --exclude-from="$UMBREL_ROOT/.umbrel-$RELEASE/bin/update/.updateignore" \
    $UMBREL_ROOT/
    
# Fix permissions
echo "Fixing permissions"
chown -R $UMBREL_USER:$UMBREL_USER $UMBREL_ROOT/

# Start updated containers
echo "Starting new containers"
cat <<EOF > $UMBREL_ROOT/statuses/update-status.json
{"state": "installing", "progress": 80, "description": "Starting new containers"}
EOF
su - $UMBREL_USER -c "cd $UMBREL_ROOT; docker-compose up --detach --remove-orphans"