#!/usr/bin/env bash

export BLESKOMAT_SERVER_ADMIN_PASSWORD=$(npm run generate:adminPasswordHash -- "$APP_PASSWORD")

exec "/usr/src/app/docker-entrypoint.sh $@"