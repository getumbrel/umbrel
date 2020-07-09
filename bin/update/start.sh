#!/bin/bash -e

UMBREL_PATH=$(dirname $(readlink -f $0))
RELEASE="v$(cat $UMBREL_PATH/statuses/start-update)"
UMBREL_USER=umbrel

echo "==== OTA UPDATE ===== | STAGE: DOWNLOAD"

if [ -z $(grep '[^[:space:]]' $UMBREL_PATH/statuses/start-update) ] ;then
    echo "Empty start update signal file. Version not found"
    exit 1
fi

# Make sure an update is not in progress
[ -f "$UMBREL_PATH/statuses/update-in-progress" ] && exit 2;

echo "Creating lock"
touch $UMBREL_PATH/statuses/update-in-progress

# Cleanup just in case there's temp stuff lying around from previous update
echo "Cleaning up any previous mess"
[ -d /tmp/umbrel-$RELEASE ] && rm -rf /tmp/umbrel-$RELEASE

# Update status file
cat <<EOF > $UMBREL_PATH/bin/update/status.json
{"state": "installing", "progress": 10, "description": "Downloading Umbrel $RELEASE"}
EOF

# Clone new release
echo "Downloading Umbrel $RELEASE"

cd /tmp/umbrel-$RELEASE
wget -qO- "https://raw.githubusercontent.com/mayankchhabra/umbrel/$RELEASE/install-box.sh"
./install-box.sh

cd bin/update

echo "Running update install scripts of the new release"
for i in {00..99}; do
    if [ -x ${i}-run.sh ]; then
        echo "Begin ${i}-run.sh"
        ./${i}-run.sh $RELEASE $UMBREL_PATH $UMBREL_USER
        echo "End ${i}-run.sh"
    fi
done

echo "Deleting cloned repository"
[ -d /tmp/umbrel-$RELEASE ] && rm -rf /tmp/umbrel-$RELEASE

echo "Deleting update signal file"
rm -f $UMBREL_PATH/statuses/start-update

echo "Removing lock"
rm -f $UMBREL_PATH/statuses/update-in-progress

exit 0