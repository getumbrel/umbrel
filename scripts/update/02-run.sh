#!/usr/bin/env bash
set -euo pipefail

RELEASE=$1
UMBREL_ROOT=$2

echo
echo "======================================="
echo "=============== UPDATE ================"
echo "======================================="
echo "========= Stage: Post-update =========="
echo "======================================="
echo

# Make Umbrel OS specific post-update changes
if [[ ! -z "${UMBREL_OS:-}" ]]; then

  # Remove dphys-swapfile since we now use our own swapfile logic
  if command -v dphys-swapfile >/dev/null 2>&1; then
    echo "Removing unused dependency \"dphys-swapfile\""
    apt-get remove -y dphys-swapfile
  fi

fi
