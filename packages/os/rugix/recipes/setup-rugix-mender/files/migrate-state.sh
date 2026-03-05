#!/bin/bash

set -euo pipefail

# We check whether the old `umbrel-os` directory still exists. If it does not, then the
# migration has been completed, and we have nothing further to do.
if [ ! -d "/run/rugix/mounts/data/umbrel-os" ]; then
    echo "State has already been migrated."
    exit 0
fi

# We simply always copy `/data/ssh` here as it is small.
if  [ ! -d "/data/ssh" ] && [ -d "/run/rugix/mounts/data/ssh" ]; then
    rm -rf /data/ssh.tmp
    cp -rp /run/rugix/mounts/data/ssh /data/ssh.tmp
    # This ensures that the copy is atomic.
    mv -T /data/ssh.tmp /data/ssh
fi

# Remove the existing `umbrel-os` symlink/directory and replace with migrated state.
rm -rf /data/umbrel-os

if [ "$RUGIX_REQUIRES_COMMIT" == "false" ]; then
    # System has previously been committed. Perform the migration now.
    # Remove old SSH host keys.
    rm -rf /run/rugix/mounts/data/ssh
    # Atomically move the old `umbrel-os` directory to the new place.
    mv -T /run/rugix/mounts/data/umbrel-os /run/rugix/mounts/data/state/default/persist/data/umbrel-os
else
    # State has not been migrated but system has also not been committed. Make sure that
    # the `/data/umbrel-os` symlink exists such that the old state is used.
    ln -s /run/rugix/mounts/data/umbrel-os /data/umbrel-os
fi
