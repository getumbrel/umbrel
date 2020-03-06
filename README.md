# The Box Compose System

## Abstract

This is a basic framework for orchestration of the box services for running a full lightning and bitcoin node.

## How to use

### Step 1

Ensure you have the [latest docker](https://docs.docker.com/install/linux/docker-ce/ubuntu/) installed, python3, and docker-compose (installed from python3 pip).

### Step 2

Ensure that your account is permissioned for docker.

### Step 3

Run this from your home directory. This clones this repo into your home directory, as well as preserving the existing structure.

```bash
# Ideally you should run this in $HOME as the docker-compose presets are in home
# This will not overwrite any other files but you should segment this in its 
# own account
curl "https://raw.githubusercontent.com/lncm/thebox-compose-system/master/install-box.sh" | sh
# OR wget (if this works better)
wget -qO- "https://raw.githubusercontent.com/lncm/thebox-compose-system/master/install-box.sh" | sh
```

### Running

```bash
# Build containers in build/ always
docker-compose up -d --build
# verify the containers
docker ps -a

# Additional node: You should have a way of creating a wallet. Currently this container does not have a create wallet container.
# For the unlock script to work, put the unlock password in secrets/lnd-password.txt
```




