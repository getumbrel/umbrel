#!/bin/bash

set -euo pipefail

install -m 644 "${RECIPE_DIR}/files/hostname" "/etc/"
install -m 644 "${RECIPE_DIR}/files/hosts" "/etc/"