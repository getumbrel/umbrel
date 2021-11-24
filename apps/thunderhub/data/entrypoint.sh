#!/usr/bin/env sh

# Set password
sed -i 's/masterPassword:.*/masterPassword: '${APP_PASSWORD}'/' /data/thubConfig.yaml

exec npm start
