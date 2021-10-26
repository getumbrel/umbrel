[![Umbrel](https://static.getumbrel.com/github/github-banner-umbrel.svg)](https://github.com/getumbrel/umbrel)

[![Version](https://img.shields.io/github/v/release/getumbrel/umbrel?color=%235351FB&label=version)](https://github.com/getumbrel/umbrel/releases)
[![Community Chat](https://img.shields.io/badge/community%20chat-telegram-%235351FB)](https://t.me/getumbrel)
[![Developer Chat](https://img.shields.io/badge/dev%20chat-keybase-%235351FB)](https://keybase.io/team/getumbrel)

[![Twitter](https://img.shields.io/twitter/follow/getumbrel?style=social)](https://twitter.com/getumbrel)
[![Reddit](https://img.shields.io/reddit/subreddit-subscribers/getumbrel?label=Subscribe%20%2Fr%2Fgetumbrel&style=social)](https://reddit.com/r/getumbrel)

# ☂️ Umbrel — a personal server for everyone
> ⚠️ Umbrel is currently in beta and is not considered secure. Please see [SECURITY.md](SECURITY.md) for more details.

[![Umbrel](https://static.getumbrel.com/github/umbrel-github-hero.png)](https://getumbrel.com)

This is the master repository of Umbrel and contains the framework for orchestration of all containerized services running on [Umbrel OS](https://github.com/getumbrel/umbrel-os).

It is platform and architecture-agnostic, thus can be used to directly spin up instances of Umbrel without installing the [Umbrel OS](https://github.com/getumbrel/umbrel-os) since all orchestrated services use multi-architecture Docker images.

We run it on Raspberry Pis (ARMv8) as a part of [Umbrel OS](https://github.com/getumbrel/umbrel-os), Ubuntu (x64) for [testnet.getumbrel.com](https://testnet.getumbrel.com) and macOS (x64) for local development.

## 🚀 Getting started

If you're looking to run Umbrel on:

- A Raspberry Pi 4 with at least 4GB RAM (recommended) - [Download Umbrel OS](https://github.com/getumbrel/umbrel-os)
- Anything else (**not recommended** as it's experimental at the moment) - [Install Umbrel](#-installation)

## 🛠 Installation

[Umbrel OS for Raspberry Pi](https://github.com/getumbrel/umbrel-os) is the easiest and the **recommended** way to run Umbrel. If you don't have a Raspberry Pi, you can manually install Umbrel on any hardware running a Linux-based operating system such as Ubuntu, Debian, etc by following the instructions below, but please note it's not the recommended way to run Umbrel as it's still very experimental.

### Installation Requirements

- 4GB RAM and 600GB+ free space (for mainnet)
- [Docker](https://docs.docker.com/engine/install)
- [Python 3.0+](https://www.python.org/downloads)
- [Docker Compose](https://docs.docker.com/compose/install)
- [fswatch](https://emcrisostomo.github.io/fswatch/), [jq](https://stedolan.github.io/jq/), [rsync](https://linuxize.com/post/how-to-use-rsync-for-local-and-remote-data-transfer-and-synchronization/#installing-rsync), [curl](https://curl.haxx.se/docs/install.html) (`sudo apt-get install fswatch jq rsync curl`)

Make sure your User ID is `1000` (verify it by running `id -u`) and ensure that your account is [correctly permissioned to use docker](https://docs.docker.com/engine/install/linux-postinstall/#manage-docker-as-a-non-root-user).

### Step 1. Download Umbrel

> Run this in an empty directory where you want to install Umbrel. If using an external storage such as an SSD or HDD, run this inside an empty directory on that drive.

```bash
curl -L https://github.com/getumbrel/umbrel/archive/v0.4.6.tar.gz | tar -xz --strip-components=1
```

### Step 2. Run Umbrel

```bash
# To use Umbrel on mainnet, run:
sudo ./scripts/start

# The following environment settings can only be set
# during first run of the start script and will be persisted through
# any updates

# For testnet, run:
sudo NETWORK=testnet ./scripts/start

# For regtest, run:
sudo NETWORK=regtest ./scripts/start

# For umbrel to listen on port 12345 instead of 80, run:
sudo NGINX_PORT=12345 ./scripts/start
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
- [`Electrs`](https://github.com/romanz/electrs)


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

## 📜 License

Umbrel is licensed under the PolyForm Noncommercial 1.0.0 license. TL;DR — You're free to use, fork, modify, and redestribute Umbrel for personal and nonprofit use under the same license. If you're interested in using Umbrel for commercial purposes, such as selling plug-and-play home servers with Umbrel, etc — please reach out to us at partner@getumbrel.com.

[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-%235351FB)](https://github.com/getumbrel/umbrel/blob/master/LICENSE.md)

[getumbrel.com](https://getumbrel.com)
