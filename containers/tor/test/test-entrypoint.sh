#!/bin/bash

docker-compose -f docker-compose.entrypoint.yml up --detach web
docker-compose -f docker-compose.entrypoint.yml up --detach tor

echo
echo "Hostname:"
cat ./data/web2/hostname
