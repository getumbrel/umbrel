#!/usr/bin/env bash
set -euo pipefail

cd ./update
UPDATE_INSTALL_SCRIPTS=$(ls *-run.sh)

for script in $UPDATE_INSTALL_SCRIPTS; do
    if [ -x $script ]; then
        echo "Begin $script"
        # ./$script $RELEASE $UMBREL_ROOT $UMBREL_USER
        echo "End $script"
    fi
done

# echo $RUN_SCRIPTS