#!/usr/bin/env sh

# Set password
sed -i 's/$APP_PASSWORD/'${APP_PASSWORD}'/' /data/thubConfig.yaml

exec npm start
