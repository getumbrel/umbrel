#!/bin/sh

# Install the docker-compose box to the current working directory
# Pre-requisites: git

git init
git remote add origin https://github.com/lncm/thebox-compose-system.git
git fetch
git reset origin/master
git checkout -t origin/master
git reset --hard
