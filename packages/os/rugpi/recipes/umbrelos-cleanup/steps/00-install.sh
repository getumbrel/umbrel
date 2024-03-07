#!/bin/bash

set -euo pipefail

mv /etc/resolv.conf.original /etc/resolv.conf
rm -rf /var/log
