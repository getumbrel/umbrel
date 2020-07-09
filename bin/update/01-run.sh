#!/bin/bash -e

RELEASE=$1
UMBREL_PATH=$2
UMBREL_USER=$3

echo "==== OTA UPDATE ===== | STAGE: INSTALL UPDATE"
cat <<EOF > $UMBREL_PATH/bin/update/status.json
{"state": "installing", "progress": 33, "description": "Configuring settings"}
EOF

# Checkout to the new release
cd /tmp/umbrel-$RELEASE

echo "Removing unwanted stuff"
# Remove unwanted stuff
rm -rf bitcoin
rm -rf lnd
rm -rf db
rm -rf tor
rm -rf secrets

# Update RPC Password in docker-compose.yml
echo "Updating RPC Password in docker-compose.yml"
RPCPASS=`cat $UMBREL_PATH/secrets/rpcpass.txt`
sed -i "s/RPCPASS/${RPCPASS}/g;" docker-compose.yml

echo "Setting regtest"
sed -i 's/mainnet/regtest/g; ' docker-compose.yml
sed -i "s/RPCPORT/18443/g;" docker-compose.yml

# Pull new images
echo "Pulling new images"
cat <<EOF > $UMBREL_PATH/bin/update/status.json
{"state": "installing", "progress": 40, "description": "Downloading new Docker images"}
EOF
docker-compose --file /tmp/umbrel-$RELEASE/docker-compose.yml pull

# Stop existing containers
echo "Stopping existing containers"
cat <<EOF > $UMBREL_PATH/bin/update/status.json
{"state": "installing", "progress": 70, "description": "Removing old containers"}
EOF
su - $UMBREL_USER -c "cd $UMBREL_PATH; docker-compose --file $UMBREL_PATH/docker-compose.yml down"

# Overlay home dir structure with new dir tree
echo "Overlaying $UMBREL_PATH/ with new directory tree"
rsync -av /tmp/umbrel-$RELEASE/ \
    --exclude='.*' \
    $UMBREL_PATH/
    
#Fix permissions
echo "Fixing permissions"
chown -R $UMBREL_USER:$UMBREL_USER $UMBREL_PATH/

# Start updated containers
echo "Starting new containers"
cat <<EOF > $UMBREL_PATH/bin/update/status.json
{"state": "installing", "progress": 80, "description": "Starting new containers"}
EOF
cd $UMBREL_PATH
su - $UMBREL_USER -c "cd $UMBREL_PATH; docker-compose --file $UMBREL_PATH/docker-compose.yml up --detach --remove-orphans"