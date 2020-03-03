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
curl "https://raw.githubusercontent.com/lncm/thebox-compose-system/master/install-box.sh" | sh
```



