# Developing apps for Umbrel

If you can code in any language, you already know how to develop an app for Umbrel. There is no restriction on the kind of programming languages, frameworks or databases that you can use. Apps run inside isolated Docker containers, and the only requirement (for now) is that they should have a web-based UI.

> Some server apps might not have a UI as they only provide the user with connection info for their client apps. In that case, the app should serve a simple web page with all the connection info, steps, QR code, and such because the user never has CLI access on Umbrel.

To keep this tutorial short and easy, we won't go into the app development itself, and will instead focus on packaging (or "porting") an existing app.

Let's straightaway jump into action by packaging [BTC RPC Explorer](https://github.com/janoside/btc-rpc-explorer), a Node.js based blockchain explorer, for Umbrel.

There are 4 steps:

1. [Containerizing the app using Docker](#1-containerizing-the-app-using-docker)
2. [Packaging the app for Umbrel](#2-packaging-the-app-for-umbrel)
3. [Testing the app on Umbrel](#3-testing-the-app-on-umbrel)
    1. [Testing on Umbrel development environment (Linux or macOS)](#31-testing-the-app-on-umbrel-development-environment)
    2. [Testing on Umbrel OS (Raspberry Pi 4)](#32-testing-on-umbrel-os-raspberry-pi-4)
4. [Submitting the app](#4-submitting-the-app)

## 1. Containerizing the app using Docker

1\. Let's start by cloning BTC RPC Explorer on our system:

```sh
git clone https://github.com/janoside/btc-rpc-explorer.git btc-rpc-explorer
cd  btc-rpc-explorer
```

2\. Next, we'll create a `Dockerfile` in the app's directory:

```Dockerfile
FROM node:12-buster-slim AS builder

WORKDIR /build
RUN apt-get update
RUN apt-get install -y python3 build-essential
RUN npm ci --production

FROM node:12-buster-slim

USER 1000
WORKDIR /data
COPY --from=builder /build .
EXPOSE 3002
CMD [ "npm", "start" ]
```

> We recommend using `debian-buster-slim` (or a flavor of it, such as `node:12-buster-slim`, `python:3-buster-slim`, etc) as the base image for better performace, reliability and faster downloads of your app, unless you have a vey strong reason for not using it.

3\. We're now ready to build the Docker image of BTC RPC Explorer. Umbrel supports ARM 32bit, ARM 64bit and AMD x86 architectures, so we'll use `docker buildx` to build, tag, and push multi-architecture Docker images of our app to Docker Hub.

```sh
docker buildx build --platform linux/amd64,linux/arm64,linux/arm/v7 --tag getumbrel/btc-rpc-explorer:v1.0.0 --output "type=registry" .
```

> You need to enable ["experimental features"](https://docs.docker.com/engine/reference/commandline/cli/#experimental-features) in Docker to user `docker buildx`.

___

## 2. Packaging the app for Umbrel

1\. Let's fork the [getumbrel/umbrel](https://github.com/getumbrel/umbrel) repo on GitHub, clone our fork locally, create a new branch for our app, and then switch to it:

```sh
git clone https://github.com/<username>/umbrel.git umbrel
cd umbrel
git branch btc-rpc-explorer
git checkout btc-rpc-explorer
```

2\. It's now time to decide an ID for our app. An app ID should only contain lowercase alphabets + dashes. Ideally it should be the name of the app. `btc-rpc-explorer` makes the perfect sense for our app, so we'll go with it.

We'll now switch to the apps directory and create a new directory for our app by the name of our chosen app ID.

```sh
cd apps
mkdir btc-rpc-explorer
cd btc-rpc-explorer
```

3\. We'll now create a `docker-compose.yml` file in this directory to define our application.

> New to Docker Compose? It's a simple tool for defining and running Docker applications that can have multiple containers. Follow along the tutorial, we promise it's not hard if you already understand the basics of Docker.

Let's copy-paste the following template `docker-compose.yml` file in a text editor and edit it according to our app.

```yml
version: '3.7'
x-logging: &default-logging
    driver: journald
    options:
        tag: "umbrel-app {{.Name}}"

services:
        # Replace <app-id> with the app ID of your app. App IDs
        # can only contain lowercase alphabets and dashes.
        <app-id>-web:
              container_name: <app-id>
              # Replace <docker-image> with your app's image and tag
              image: <docker-image>
              logging: *default-logging
              restart: on-failure
              stop_grace_period: 1m
              ports:
                  # Replace <port> with the port that your app's web server
                  # is listening inside the Docker container. If you need to
                  # expose more ports, add them below.
                  - <port>:<port>
              volumes:
                  # Uncomment to mount data directories inside the Docker
                  # container to store persistent data at path /data
                  # - ${DATA_DIR}/foo:/foo
                  # - ${DATA_DIR}/bar:/bar
                  
                  # Uncomment to mount LND's data directory as read-only
                  # inside the Docker container at path /.lnd
                  # - ${LND_DATA_DIR}:/.lnd:ro
                  
                  # Uncomment to mount Bitcoin Core's data directory as 
                  # read-only inside the Docker container at path /.bitcoin
                  # - ${BITCOIN_DATA_DIR}:/.bitcoin:ro
              environment:
                  # Pass any environment variables to your app for configuration
                  # Here are all the environment variables that allow you to
                  # connect to Bitcoin Core, LND, Electrum server and a Tor proxy
                  #
                  # Bitcoin Core environment variables
                  # $BITCOIN_NETWORK - Can be "mainnet", "testnet" or "regtest"
                  # $BITCOIN_HOST - Local IP of Bitcoin Core
                  # $BITCOIN_P2P_PORT - P2P port
                  # $BITCOIN_RPC_PORT - RPC port
                  # $BITCOIN_RPC_USER - RPC username
                  # $BITCOIN_RPC_PASS - RPC password
                  # $BITCOIN_RPC_AUTH - RPC auth string
                  #
                  # LND environment variables
                  # $LND_HOST - Local IP of LND
                  # $LND_GRPC_PORT - gRPC Port of LND
                  # $LND_REST_PORT - REST Port of LND
                  # $LND_TLS_CERT - Hex encoded TLS certificate
                  # $LND_ADMIN_MACROON - Hex encoded admin.macroon
                  #
                  # Electrum server environment variables
                  # $ELECTRUM_HOST - Local IP of Electrum server
                  # $ELECTRUM_PORT - Port of Electrum server
                  #
                  # Tor proxy environment variables
                  # $TOR_PROXY_HOST - Local IP of Tor proxy
                  # $TOR_PROXY_PORT - Port of Tor proxy

        # If your app has more Docker containers, such as a
        # database container, etc you can define these services below
        # <app-id>-db:
        
networks:
  default:
    external:
      name: umbrel_net
```

4\. For our app, we'll update `<app-id>` with `btc-rpc-explorer`, `<docker-image>` with `getumbrel/btc-rpc-explorer:v1.0.0`, and `<port>` with `3002`. Since BTC RPC Explorer doesn't need to store any persistent data and doesn't require access to Bitcoin Core's or LND's data directories, we can remove the entire `volumes` block.

BTC RPC Explorer is an application with a single Docker container, so we don't need to define any other additional services (such as a database service, etc) in the compose file.

> If BTC RPC Explorer would have required any default configuration files, we would have created a new `data` directory in the same directory as the `docker-compose.yml` file. We'd have then placed the configuration files inside it, and uncommented the `- ${DATA_DIR}:/data` volume mount in `docker-compose.yml` to make the files available in the `/data` directory inside the container.

Updated `docker-compose.yml` file:

```yml
version: '3.7'
x-logging: &default-logging
    driver: journald
    options:
        tag: "umbrel-app {{.Name}}"

services:
        btc-rpc-explorer-web:
              container_name: btc-rpc-explorer
              image: getumbrel/btc-rpc-explorer:v1.0.0
              logging: *default-logging
              restart: on-failure
              stop_grace_period: 1m
              ports:
                  - 3002:3002
              environment:

networks:
  default:
    external:
      name: umbrel_net
```

5\. Next, let's set the environment variables required by our app to connect to Bitcoin Core, Electrum server, and for app-related configuration ([as required by the app](https://github.com/janoside/btc-rpc-explorer/blob/master/.env-sample)).

So the final version of `docker-compose.yml` would be:

```yml
version: '3.7'
x-logging: &default-logging
    driver: journald
    options:
        tag: "umbrel-app {{.Name}}"

services:
        btc-rpc-explorer-web:
              container_name: btc-rpc-explorer
              image: getumbrel/btc-rpc-explorer:v1.0.0
              logging: *default-logging
              restart: on-failure
              stop_grace_period: 1m
              ports:
                  - 3002:3002
              environment:
                  # Bitcoin Core environment variables
                  BTCEXP_BITCOIND_HOST: $BITCOIN_HOST
                  BTCEXP_BITCOIND_PORT: $BITCOIN_RPC_PORT
                  BTCEXP_BITCOIND_USER: $BITCOIN_RPC_USER
                  BTCEXP_BITCOIND_PASS: $BITCOIN_RPC_PASS

                  # Electrum environment variables
                  BTCEXP_ELECTRUMX_SERVERS: tcp://${ELECTRUM_HOST}:${ELECTRUM_PORT}
                  
                  # App Config
                  BTCEXP_HOST: 0.0.0.0
                  DEBUG: "btcexp:*,electrumClient"
                  BTCEXP_ADDRESS_API: electrumx
                  BTCEXP_SLOW_DEVICE_MODE: "true"
                  BTCEXP_NO_INMEMORY_RPC_CACHE: "true"
                  BTCEXP_PRIVACY_MODE: "true"
                  BTCEXP_NO_RATES: "true"
                  BTCEXP_RPC_ALLOWALL: "false"
                  BTCEXP_BASIC_AUTH_PASSWORD: ""

networks:
  default:
    external:
      name: umbrel_net
```

6\. We're pretty much done here. The next step is to commit the changes, push it to our fork's branch, and test out the app on Umbrel.

```sh
git add .
git commit -m "Add BTC RPC Explorer"
git push origin btc-rpc-explorer
```

___

## 3. Testing the app on Umbrel

### 3.1 Testing the app on Umbrel development environment

Umbrel development environment ([`umbrel-dev`](https://github.com/getumbrel/umbrel-dev)) is a lightweight regtest instance of Umbrel that runs inside a virtual machine on your system. It's currently only compatible with Linux or macOS, so if you're on Windows, you may skip this section and directly test your app on a Raspberry Pi 4 running [Umbrel OS](https://github.com/getumbrel/umbrel-os).

1\. First, we'll install [Homebrew](https://brew.sh) and [Virtual Box](https://www.virtualbox.org) on our system.

2\. Now let's install `umbrel-dev` and initialize it:

```sh
brew install lukechilds/tap/umbrel-dev

mkdir umbrel-dev
cd umbrel-dev

umbrel-dev init
```

3\. It's time to boot the `umbrel-dev` virtual machine:

```sh
umbrel-dev boot
```

After the VM has booted, we can verify if the Umbrel dashboard is accessible at http://umbrel-dev.local in our browser to make sure everything is running fine.

4\. Now let's switch the Umbrel installation on `umbrel-dev` to our fork and branch. In the same directory where we setup `umbrel-dev`, we'll run:

```sh
cd getumbrel/umbrel
git add remote <username> https://github.com/<username>/umbrel.git
git fetch <username>
git checkout <username>/btc-rpc-explorer
```

5\. Next, we'll SSH into the VM:

```sh
umbrel-dev ssh
```

6\. And finally, it's time to install our app:

```sh
scripts/app install btc-rpc-explorer
```

That's it! Our app should now be accessible at http://umbrel-dev.local:3002

> If you need to make any changes in your app's compose file while you're testing the app on `umbrel-dev`, you can directly edit it at `getumbrel/umbrel/apps/btc-rpc-explorer/docker-compose.yml` inside your `umbrel-dev` directory, test it on the fly, and commit + push the changes once you're done.

7\. To test uninstall, we can run:

```sh
scripts/app uninstall btc-rpc-explorer
```

To shutdown the `umbrel-dev` virtual machine after testing, we'll run:

```sh
umbrel-dev shutdown
```

### 3.2 Testing on Umbrel OS (Raspberry Pi 4)

1\. We'll first install and run Umbrel OS on a Raspberry Pi 4. [Full instructions can be found here](https://getumbrel.com/#start). After installation, we'll set it up on http://umbrel.local, and then SSH into the Pi:

```sh
ssh umbrel@umbrel.local
```

Password `moneyprintergobrrr`

2\. Next, we'll switch the Umbrel installation to our fork and branch:

```sh
sudo scripts/update/update --repo <username>/umbrel#btc-rpc-explorer
```

3\. Once the installation has updated, it's time to test our app:

```sh
scripts/app install btc-rpc-explorer
```

The app should now be accessible at http://umbrel.local:3002

4\. To uninstall:

```sh
scripts/app uninstall btc-rpc-explorer
```

___

## 4. Submitting the app

We're now ready to open a pull request on the main [getumbrel/umbrel](https://github.com/getumbrel/umbrel) repo and submit our app.

\[WIP\]


## FAQs

1. **How to push app updates?**

    Every time you release a new version of your app, you should build, tag and push the new Docker images to Docker Hub. Then open a new PR on our main repo (getumbrel/umbrel) with your up-to-date docker image. For now, app updates will be bundled together in the Umbrel release. In the future, you'll be able to ship updates independently as soon as you make a new release.

2. **How will users install/uninstall apps?**

    Users will install and uninstall the apps via dedicated UI in their dashboard. They will not use the `scripts/app` CLI directly as it's only meant for development use.

3. **If I submit an app, will my PR be merged for sure?**

    For now, we're only accepting app submissions from developers who have received an invitation from us. Over time, we'll allow anyone to submit their app.

    > Need an invite to submit your app? Get in touch with [@mayankchhabra](https://t.me/mayankchhabra) or [@lukechilds](https://t.me/lukechilds) on Telegram.

4. **I need help with something else?**

    Join our [developer chat](https://keybase.io/team/getumbrel) on Keybase, or get in touch with [@mayankchhabra](https://t.me/mayankchhabra) or [@lukechilds](https://t.me/lukechilds) on Telegram.
