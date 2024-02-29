#!/bin/bash

docker-compose up --detach web
docker-compose up --detach tor

echo
echo "Hostname:"
cat ./data/web/hostname