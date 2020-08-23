[![Umbrel](https://static.getumbrel.com/github/github-banner-umbrel.svg)](https://github.com/getumbrel/umbrel)

[![Version](https://img.shields.io/github/v/release/getumbrel/umbrel?color=%235351FB&label=version)](https://github.com/getumbrel/umbrel/releases)
[![Chat](https://img.shields.io/badge/chat%20on-telegram-%235351FB)](https://t.me/getumbrel)

[![Twitter](https://img.shields.io/twitter/follow/getumbrel?style=social)](https://twitter.com/getumbrel)
[![Reddit](https://img.shields.io/reddit/subreddit-subscribers/getumbrel?label=Subscribe%20%2Fr%2Fgetumbrel&style=social)](https://reddit.com/r/getumbrel)

# ☂️ Umbrel

> ⚠️ Umbrel is currently in beta and is not considered secure. Please see [SECURITY.md](SECURITY.md) for more details.

This is the master respository of Umbrel and contains the framework for orchestration of all containerized services running on [Umbrel OS](https://github.com/getumbrel/umbrel-os).

It is platform and architecture-agnostic, thus can be used to directly spin up instances of Umbrel without installing the [Umbrel OS](https://github.com/getumbrel/umbrel-os) since all orchestrated services use multi-architecture Docker images.

We run it on Raspbery Pis (ARMv7) as a part of [Umbrel OS](https://github.com/getumbrel/umbrel-os), Ubuntu (x64) for [testnet.getumbrel.com](https://testnet.getumbrel.com) and macOS (x64) for local development.

## 🚀 Getting started

If you're looking to run Umbrel on:

- A Raspberry Pi 3 or 4 (recommended) - [Download Umbrel OS](https://github.com/getumbrel/umbrel-os)
- Anything else (experimental) - [Install Umbrel](#-installation)

## 🛠 Installation

### Requirements

- [Docker](https://docs.docker.com/engine/install)
- [Python 3.0+](https://www.python.org/downloads)
- [Docker Compose](https://docs.docker.com/compose/install)
- [fswatch](https://emcrisostomo.github.io/fswatch/), [jq](https://stedolan.github.io/jq/), [rsync](https://linuxize.com/post/how-to-use-rsync-for-local-and-remote-data-transfer-and-synchronization/#installing-rsync), [curl](https://curl.haxx.se/docs/install.html) (`sudo apt-get install fswatch jq rsync curl`)

Make sure your User ID is `1000` (can be verified by running `id -u`) and ensure that your account is [correctly permissioned to use docker](https://docs.docker.com/engine/install/linux-postinstall/#manage-docker-as-a-non-root-user).

### Step 1. Download

> Run this in an empty directory where you want to install Umbrel

```bash
curl -L https://github.com/getumbrel/umbrel/archive/v0.2.3.tar.gz | tar -xz --strip-components=1
```

### Step 2. Run

```bash
# To use Umbrel on mainnet, run:
sudo ./scripts/start

# For testnet, run:
sudo NETWORK=testnet ./scripts/start

# For regtest, run:
sudo NETWORK=regtest ./scripts/start
```

To stop Umbrel, run:

```bash
sudo ./scripts/stop
```

## 🎹 Services orchestrated

- [`Umbrel Dashboard`](https://github.com/getumbrel/umbrel-dashboard)
- [`Umbrel Manager`](https://github.com/getumbrel/umbrel-manager)
- [`Umbrel Middleware`](https://github.com/getumbrel/umbrel-middleware)
- [`Bitcoin Core`](https://github.com/getumbrel/docker-bitcoind)
- [`LND`](https://github.com/getumbrel/docker-lnd)
- [`Tor`](https://github.com/getumbrel/docker-tor)
- [`Nginx`](https://github.com/nginx/nginx)
- [`Neutrino Switcher`](https://github.com/lncm/docker-lnd-neutrino-switch)


**Architecture**

```
                          + -------------------- +
                          |   umbrel-dashboard   |
                          + -------------------- +
                                      |
                                      |
                              + ------------- +
                              |     nginx     |
                              + ------------- +
                                      |
                                      |
              + - - - - - - - - - - - + - - - - - - - - - - - +
              |                                               |
              |                                               |
   + ------------------ +                         + --------------------- +
   |   umbrel-manager   | < - - - jwt auth - - -  |   umbrel-middleware   |
   + ------------------ +                         + --------------------- +
                                                              |
                                                              |
                                            + - - - - - - - - + - - - - - - - - +
                                            |                                   |
                                            |                                   |
                                    + ------------- +                   + ------------- +
                                    |    bitcoind   | < - - - - - - - - |      lnd      |
                                    + ------------- +                   + ------------- +
```

---

## ⚡️ Don't be too reckless

Umbrel is still in beta development and should not be considered secure. [Read our writeup of security tradeoffs](https://github.com/getumbrel/umbrel/blob/master/SECURITY.md) that exist today.

It's recommended that you note down your 24 secret words (seed phrase) with a pen and paper, and secure it safely. If you forget your dashboard's password, or in case something goes wrong with your Umbrel, you will need these 24 words to recover your funds in the Bitcoin wallet of your Umbrel.

You're also recommended to download a backup of your payment channels regularly as it'll be required to recover your funds in the Lightning wallet of your Umbrel in case something goes wrong. You should also always download the latest backup file before installing an update.

## ❤️ Contributing

We welcome and appreciate new contributions.

If you're a developer looking to help but not sure where to begin, check out [these issues](https://github.com/getumbrel/umbrel/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) that have specifically been marked as being friendly to new contributors.

If you're looking for a bigger challenge, before opening a pull request please [create an issue](https://github.com/getumbrel/umbrel/issues/new/choose) or [join our community chat](https://t.me/getumbrel) to get feedback, discuss the best way to tackle the challenge, and to ensure that there's no duplication of work.

---

[![License](https://img.shields.io/github/license/getumbrel/umbrel?color=%235351FB)](https://github.com/getumbrel/umbrel/blob/master/LICENSE)

[getumbrel.com](https://getumbrel.com)
