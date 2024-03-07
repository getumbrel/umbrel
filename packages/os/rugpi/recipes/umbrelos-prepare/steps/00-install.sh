#!/bin/bash

set -euo pipefail

mv /etc/resolv.conf /etc/resolv.conf.original
echo "nameserver 1.1.1.1" > /etc/resolv.conf

mkdir -p /var/log/apt

# SystemD uses this file to detect that it runs in Docker. This will prevent `reboot`
# from working as it should and may also lead to a bunch of other problems.
rm -f /.dockerenv
