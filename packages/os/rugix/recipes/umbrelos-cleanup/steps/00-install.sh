#!/bin/bash

set -euo pipefail

mv /etc/resolv.conf.original /etc/resolv.conf
rm -rf /var/log
# ldconfig's cache of library inode numbers and ctimes differs on every build.
# ldconfig rebuilds it when needed.
rm -f /var/cache/ldconfig/aux-cache
# Installing packages in the earlier recipes rebuilds man-db's index, a GDBM
# database sized by the build host filesystem's st_blksize, so it would make
# the image differ between build hosts. man-db.timer rebuilds it on the device.
find /var/cache/man -name index.db -delete
