#!/usr/bin/env bash

export BLESKOMAT_SERVER_ADMIN_PASSWORD=$(npm run --silent generate:adminPasswordHash -- "$APP_PASSWORD" | xargs)

exec "/usr/src/app/docker-entrypoint.sh $@"