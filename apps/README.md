# Umbrel App Framework

If you can code in any language, you already know how to develop an app for Umbrel. There is no restriction on the kind of programming languages, frameworks or databases that you can use. Apps run inside isolated Docker containers, and the only requirement (for now) is that they should have a web-based UI.

> Some server apps might not have a UI at all. In that case, the app should serve a simple web page listing the connection details, QR codes, setup instructions, and anything else needed for the user to connect. The user is never expected to have CLI access on Umbrel.

To keep this document short and easy, we won't go into the app development itself, and will instead focus on packaging an existing app.

Let's straightaway jump into action by packaging [BTC RPC Explorer](https://github.com/janoside/btc-rpc-explorer), a Node.js based blockchain explorer, for Umbrel.

There are 4 steps:

1. [🛳 Containerizing the app using Docker](#1-containerizing-the-app-using-docker)
1. [☂️ Packaging the app for Umbrel](#2-%EF%B8%8Fpackaging-the-app-for-umbrel)
1. [🛠 Testing the app on Umbrel](#3-testing-the-app-on-umbrel)
    1. [Testing on Umbrel development environment (Linux or macOS)](#31-testing-the-app-on-umbrel-development-environment)
    1. [Testing on Umbrel OS (Raspberry Pi 4)](#32-testing-on-umbrel-os-raspberry-pi-4)
1. [🚀 Submitting the app](#4-submitting-the-app)

___

## 1. 🛳&nbsp;&nbsp;Containerizing the app using Docker

1\. Let's start by cloning BTC RPC Explorer on our system:

```sh
git clone --branch v2.0.2 https://github.com/janoside/btc-rpc-explorer.git
cd  btc-rpc-explorer
```

2\. Next, we'll create a `Dockerfile` in the app's directory:

```Dockerfile
FROM node:12-buster-slim AS builder

WORKDIR /build
COPY . .
RUN apt-get update
RUN apt-get install -y git python3 build-essential
RUN npm ci --production

FROM node:12-buster-slim

USER 1000
WORKDIR /build
COPY --from=builder /build .
EXPOSE 3002
CMD ["npm", "start"]
```

### A good Dockerfile:

- [x] Uses `debian:buster-slim` (or its derivatives, like `node:12-buster-slim`) as the base image — resulting in less storage consumption and faster app installs as the base image is already cached on the user's Umbrel.
- [x] Uses [multi-stage builds](https://docs.docker.com/develop/develop-images/multistage-build/) for smaller image size.
- [x] Ensures development files are not included in the final image.
- [x] Has only one service per container.
- [x] Doesn't run the service as root.
- [x] Uses remote assets that are verified against a checksum.
- [x] Results in deterministic image builds.

3\. We're now ready to build the Docker image of BTC RPC Explorer. Umbrel supports both 64-bit ARM and x86 architectures, so we'll use `docker buildx` to build, tag, and push multi-architecture Docker images of our app to Docker Hub.

```sh
docker buildx build --platform linux/arm64,linux/amd64 --tag getumbrel/btc-rpc-explorer:v2.0.2 --output "type=registry" .
```

> You need to enable ["experimental features"](https://docs.docker.com/engine/reference/commandline/cli/#experimental-features) in Docker to use `docker buildx`.

___

## 2. ☂️&nbsp;&nbsp;Packaging the app for Umbrel

1\. Let's fork the [getumbrel/umbrel](https://github.com/getumbrel/umbrel) repo on GitHub, clone our fork locally, create a new branch for our app, and then switch to it:

```sh
git clone https://github.com/<username>/umbrel.git
cd umbrel
git checkout -b btc-rpc-explorer
```

2\. It's now time to decide an ID for our app. An app ID should only contain lowercase alphabetical characters and dashes, and should be humanly recognizable. For this app we'll go with `btc-rpc-explorer`.

We need to create a new subdirectory in the apps directory with same name as our app ID and move into it:

```sh
mkdir apps/btc-rpc-explorer
cd apps/btc-rpc-explorer
```

3\. We'll now create a `docker-compose.yml` file in this directory to define our application.

> New to Docker Compose? It's a simple tool for defining and running Docker applications that can have multiple containers. Follow along the tutorial, we promise it's not hard if you already understand the basics of Docker.

Let's copy-paste the following template `docker-compose.yml` file in a text editor and edit it according to our app.

```yml
version: "3.7"

services:
  web:
    image: <docker-image>:<tag>
    restart: on-failure
    stop_grace_period: 1m
    ports:
      # Replace <port> with the port that your app's web server
      # is listening inside the Docker container. If you need to
      # expose more ports, add them below.
      - <port>:<port>
    volumes:
      # Uncomment to mount your data directories inside
      # the Docker container for storing persistent data
      # - ${APP_DATA_DIR}/foo:/foo
      # - ${APP_DATA_DIR}/bar:/bar

      # Uncomment to mount LND's data directory as read-only
      # inside the Docker container at path /lnd
      # - ${LND_DATA_DIR}:/lnd:ro

      # Uncomment to mount Bitcoin Core's data directory as
      # read-only inside the Docker container at path /bitcoin
      # - ${BITCOIN_DATA_DIR}:/bitcoin:ro
    environment:
      # Pass any environment variables to your app for configuration in the form:
      # VARIABLE_NAME: value
      #
      # Here are all the Umbrel provided variables that you can pass through to
      # your app to connect to Bitcoin Core, LND, Electrum and Tor:
      #
      # Bitcoin Core environment variables
      # $BITCOIN_NETWORK - Can be "mainnet", "testnet" or "regtest"
      # $BITCOIN_IP - Local IP of Bitcoin Core
      # $BITCOIN_P2P_PORT - P2P port
      # $BITCOIN_RPC_PORT - RPC port
      # $BITCOIN_RPC_USER - RPC username
      # $BITCOIN_RPC_PASS - RPC password
      # $BITCOIN_RPC_AUTH - RPC auth string
      #
      # LND environment variables
      # $LND_IP - Local IP of LND
      # $LND_GRPC_PORT - gRPC Port of LND
      # $LND_REST_PORT - REST Port of LND
      #
      # Electrum server environment variables
      # $ELECTRUM_IP - Local IP of Electrum server
      # $ELECTRUM_PORT - Port of Electrum server
      #
      # Tor proxy environment variables
      # $TOR_PROXY_IP - Local IP of Tor proxy
      # $TOR_PROXY_PORT - Port of Tor proxy
      #
      # App specific environment variables
      # $APP_HIDDEN_SERVICE - The address of the Tor hidden service your app will be exposed at
      # $APP_DOMAIN - Local domain name of the app ("umbrel.local" on Umbrel OS)
      # $APP_PASSWORD - Unique plain text password that can be used for authentication in your app, shown to the user in the Umbrel UI
      # $APP_SEED - Unique 256 bit long hex string (128 bits of entropy) deterministically derived from user's Umbrel seed and your app's ID
  # If your app has more services, like a database container, you can define those
  # services below:
  # db:
  #   image: <docker-image>:<tag>
  #   ...

```

4\. For our app, we'll update `<docker-image>` with `getumbrel/btc-rpc-explorer`, `<tag>` with `v2.0.2`, and `<port>` with `3002`. Since BTC RPC Explorer doesn't need to store any persistent data and doesn't require access to Bitcoin Core's or LND's data directories, we can remove the entire `volumes` block.

BTC RPC Explorer is an application with a single Docker container, so we don't need to define any other additional services (like a database service, etc) in the compose file.

> If BTC RPC Explorer needed to persist some data we would have created a new `data` directory next to the `docker-compose.yml` file. We'd then mount the volume `- ${APP_DATA_DIR}/data:/data` in  `docker-compose.yml` to make the directory available at `/data` inside the container.

Updated `docker-compose.yml` file:

```yml
version: "3.7"

services:
  web:
    image: getumbrel/btc-rpc-explorer:v2.0.2
    restart: on-failure
    stop_grace_period: 1m
    ports:
      - 3002:3002
    environment:

```

5\. Next, let's set the environment variables required by our app to connect to Bitcoin Core, Electrum server, and for app-related configuration ([as required by the app](https://github.com/janoside/btc-rpc-explorer/blob/master/.env-sample)).

So the final version of `docker-compose.yml` would be:

```yml
version: "3.7"

services:
  web:
    image: getumbrel/btc-rpc-explorer:v2.0.2
    restart: on-failure
    stop_grace_period: 1m
    ports:
      - 3002:3002
    environment:
      # Bitcoin Core connection details
      BTCEXP_BITCOIND_HOST: $BITCOIN_IP
      BTCEXP_BITCOIND_PORT: $BITCOIN_RPC_PORT
      BTCEXP_BITCOIND_USER: $BITCOIN_RPC_USER
      BTCEXP_BITCOIND_PASS: $BITCOIN_RPC_PASS

      # Electrum connection details
      BTCEXP_ELECTRUMX_SERVERS: "tcp://$ELECTRUM_IP:$ELECTRUM_PORT"

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

```

6\. We're pretty much done here. The next step is to commit the changes, push it to our fork's branch, and test out the app on Umbrel.

```sh
git add .
git commit -m "Add BTC RPC Explorer"
git push origin btc-rpc-explorer
```

___

## 3. 🛠&nbsp;&nbsp;Testing the app on Umbrel

### 3.1 Testing the app on Umbrel development environment

Umbrel development environment ([`umbrel-dev`](https://github.com/getumbrel/umbrel-dev)) is a lightweight regtest instance of Umbrel that runs inside a virtual machine on your system. It's currently only compatible with Linux or macOS, so if you're on Windows, you may skip this section and directly test your app on a Raspberry Pi 4 running [Umbrel OS](https://github.com/getumbrel/umbrel-os).

1\. First, we'll install the `umbrel-dev` CLI and it's dependencies [Virtual Box](https://www.virtualbox.org) and [Vagrant](https://vagrantup.com) on our system. If you use [Homebrew](https://brew.sh) you can do that with just:

```sh
brew install lukechilds/tap/umbrel-dev gnu-sed
brew install --cask virtualbox vagrant
```

2\. Now let's initialize our development environment and boot the VM:

```sh
mkdir umbrel-dev
cd umbrel-dev
umbrel-dev init
umbrel-dev boot
```

> The first `umbrel-dev` boot usually takes a while due to the initial setup and configuration of the VM. Subsequent boots are much faster.

After the VM has booted, we can verify if the Umbrel dashboard is accessible at http://umbrel-dev.local in our browser to make sure everything is running fine.

3\. We need to switch the Umbrel installation on `umbrel-dev` to our fork and branch:

```sh
cd getumbrel/umbrel
git remote add <username> git@github.com:<username>/umbrel.git
git fetch <username> btc-rpc-explorer
git checkout <username>/btc-rpc-explorer
```

4\. And finally, it's time to install our app:

```sh
umbrel-dev app install btc-rpc-explorer
```

That's it! Our BTC RPC Explorer app should now be accessible at http://umbrel-dev.local:3002

5\. To make changes:

Edit your app files at `getumbrel/umbrel/apps/<app-id>/` and then run:

```sh
umbrel-dev reload
```

Once you're happy with your changes, just commit and push.

>Don't forget to shutdown the `umbrel-dev` virtual machine after testing with `umbrel-dev shutdown`!

### 3.2 Testing on Umbrel OS (Raspberry Pi 4)

1\. We'll first install and run Umbrel OS on a Raspberry Pi 4. [Full instructions can be found here](https://getumbrel.com/#start). After installation, we'll set it up on http://umbrel.local, and then SSH into the Pi:

```sh
ssh umbrel@umbrel.local
```

(SSH password is the same as your Umbrel's dashboard password)

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

> When testing your app, make sure to verify that any application state that needs to be persisted is in-fact being persisted in volumes.
>
> A good way to test this is to restart the app with `scripts/app stop <app-id> && scripts/app start <app-id>`. If any state is lost, it means that state should be mapped to a persistent volume.
>
> When stopping/starting the app, all data in volumes will be persisted and anything else will be discarded. When uninstalling/installing an app, even persistent data will be discarded.

___

## 4. 🚀&nbsp;&nbsp;Submitting the app

We're now ready to open a pull request on the main [getumbrel/umbrel](https://github.com/getumbrel/umbrel) repo to submit our app. Let's copy-paste the following markdown for the pull request description, fill it up with the required details, and then open a pull request.

```
# App Submission

### App name
...

### Version
...

### One line description of the app
_(max 50 characters)_

...

### Summary of the app
_(50 to 200 words)_

...

### Developer name
...

### Developer website
...

### Source code link
_(Link to your app's source code repository.)_

...

### Support link
_(Link to your Telegram support channel, GitHub issues/discussions, support portal, or any other place where users could contact you for support.)_

...

### Requires
- [ ] Bitcoin Core
- [ ] Electrum server
- [ ] LND

### 256x256 SVG icon
_(Submit an icon with no rounded corners as it will be dynamically rounded with CSS. GitHub doesn't allow uploading SVGs directly, so please upload your icon to an alternate service, like https://svgur.com, and paste the link below.)_

...

### Gallery images
_(Upload 3 to 5 high-quality gallery images (1440x900px) of your app in PNG format, or just upload 3 to 5 screenshots of your app and we'll help you design the gallery images.)_

...


### I have tested my app on:
- [ ] [Umbrel dev environment](https://github.com/getumbrel/umbrel-dev)
- [ ] [Umbrel OS on a Raspberry Pi 4](https://github.com/getumbrel/umbrel-os)
- [ ] [Custom Umbrel install on Linux](https://github.com/getumbrel/umbrel#-installation)
```

This is where the above information is used when the app goes live in the Umbrel App Store:

![Umbrel App Store Labels](https://i.imgur.com/0CorPRK.png)

**Here's our real pull request submitting the BTC RPC Explorer app — [getumbrel/umbrel#334](https://github.com/getumbrel/umbrel/pull/334).**

> After you've submitted your app, we'll review your pull request, create the required Tor hidden services for it, make some adjustments in the `docker-compose.yml` file, such as removing any port conflicts with other apps, pinning Docker images to their sha256 digests, assigning unique IP addresses to the containers, etc before merging.

🎉 Congratulations! That's all you need to do to package, test and submit your app to Umbrel. We can't wait to have you onboard!

---

## FAQs

1. **How to push app updates?**

    Every time you release a new version of your app, you should build, tag and push the new Docker images to Docker Hub. Then open a new PR on our main repo (getumbrel/umbrel) with your up-to-date docker image. For now, app updates are bundled together in the Umbrel releases. In the future, you'll be able to ship updates independently as soon as you make a new release.

1. **How do users install apps?**

    Users install apps via the Umbrel App Store. They do not use the `scripts/app` CLI directly as it's only meant for development use.

1. **I need help with something else?**

    Join our [developer chat](https://keybase.io/team/getumbrel) on Keybase, or get in touch with [@mayankchhabra](https://t.me/mayankchhabra) or [@lukechilds](https://t.me/lukechilds) on Telegram.
