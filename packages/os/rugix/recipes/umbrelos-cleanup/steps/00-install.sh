#!/bin/bash

set -euo pipefail

mv /etc/resolv.conf.original /etc/resolv.conf
rm -rf /var/log
# ldconfig's cache of library inode numbers and ctimes differs on every build.
# ldconfig rebuilds it when needed.
rm -f /var/cache/ldconfig/aux-cache
