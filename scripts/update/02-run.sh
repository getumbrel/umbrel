#!/usr/bin/env bash
set -euo pipefail

RELEASE=$1
UMBREL_ROOT=$2

./check-memory "${RELEASE}" "${UMBREL_ROOT}" "notfirstrun"

echo
echo "======================================="
echo "=============== UPDATE ================"
echo "======================================="
echo "========= Stage: Post-update =========="
echo "======================================="
echo

# Nothing here for now
