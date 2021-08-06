#!/usr/bin/env bash
set -euo pipefail

app="$1"
app_data_dir="$2"

# Fix file permissions to match that which would exist when
# The grafana user creates the folder in a volume
chmod 777 "${app_data_dir}/data/grafana"
chown 472:0 "${app_data_dir}/data/grafana"