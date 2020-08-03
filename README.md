[![Umbrel](https://static.getumbrel.com/github/github-banner-umbrel.svg)](https://github.com/getumbrel/umbrel)

[![Version](https://img.shields.io/github/v/release/getumbrel/umbrel?color=%235351FB&label=version)](https://github.com/getumbrel/umbrel/releases)
[![Chat](https://img.shields.io/badge/chat%20on-telegram-%235351FB)](https://t.me/getumbrel)

[![Twitter](https://img.shields.io/twitter/follow/getumbrel?style=social)](https://twitter.com/getumbrel)
[![Reddit](https://img.shields.io/reddit/subreddit-subscribers/getumbrel?label=Subscribe%20%2Fr%2Fgetumbrel&style=social)](https://reddit.com/r/getumbrel)

# ☂️ Umbrel

This is the master respository of Umbrel and contains the framework for orchestration of all containerized services running on [Umbrel OS](https://github.com/getumbrel/umbrel-os).

It is platform and architecture-agnostic, thus can be used to directly spin up instances of Umbrel without installing the [Umbrel OS](https://github.com/getumbrel/umbrel-os) since all orchestrated services use multi-architecture Docker images.

We run it on Raspbery Pis (ARMv7) as a part of [Umbrel OS](https://github.com/getumbrel/umbrel-os), Ubuntu (x64) for [testnet.getumbrel.com](https://testnet.getumbrel.com) and macOS (x64) for local development.

## 🚀 Getting started

If you're looking to run Umbrel on:

- A Raspberry Pi 3 or 4 (recommended) - [Download Umbrel OS](https://github.com/getumbrel/umbrel-os)
- Anything else (experimental) - [Install Umbrel](#-installation)

## 🎹 Services orchestrated

- [`Umbrel Dashboard`](https://github.com/getumbrel/umbrel-dashboard)
- [`Umbrel Manager`](https://github.com/getumbrel/umbrel-manager)
- [`Umbrel Middleware`](https://github.com/getumbrel/umbrel-middleware)
- [`Bitcoin Core`](https://github.com/getumbrel/docker-bitcoind)
- [`LND`](https://github.com/getumbrel/docker-lnd)
- [`Tor`](https://github.com/getumbrel/docker-tor)
- [`Nginx`](https://github.com/nginx/nginx)
- [`LND Neutrino Switch`](https://github.com/lncm/docker-lnd-neutrino-switch)


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

## 🛠 Installation

### Requirements

- [Docker](https://docs.docker.com/engine/install)
- [Python 3.0+](https://www.python.org/downloads)
- [Docker Compose](https://docs.docker.com/compose/install/#install-using-pip) (installed via python3 pip)

Ensure that your account is [correctly permissioned to use docker](https://docs.docker.com/engine/install/linux-postinstall/#manage-docker-as-a-non-root-user).

### Step 1. Run this from your home directory (if installing on dedicated hardware)

> It will clone this repo while preserving home directory's existing structure.

```bash
curl -L https://github.com/getumbrel/umbrel/archive/v0.1.6-beta.3.tar.gz | tar -xz --strip-components=1
```

### Step 2. Configure

```bash
# To configure Umbrel for mainnet, run:
./scripts/configure

# For testnet, run:
TESTNET=1 ./scripts/configure

# For regtest, run:
REGTEST=1 ./scripts/configure
```

### Step 3. Run Umbrel

```bash
sudo ./scripts/start
```

---

### ⚡️ Don't be too reckless

> Umbrel is still in early development and things are expected to break every now and then. We **DO NOT** recommend running it on the mainnet with real money just yet, unless you want to be really *#reckless*.

## ❤️ Contributing

We welcome and appreciate new contributions.

If you're a developer looking to help but not sure where to begin, check out [these issues](https://github.com/getumbrel/umbrel/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) that have specifically been marked as being friendly to new contributors.

If you're looking for a bigger challenge, before opening a pull request please [create an issue](https://github.com/getumbrel/umbrel/issues/new/choose) or [join our community chat](https://t.me/getumbrel) to get feedback, discuss the best way to tackle the challenge, and to ensure that there's no duplication of work.

---

[![License](https://img.shields.io/github/license/getumbrel/umbrel?color=%235351FB)](https://github.com/getumbrel/umbrel/blob/master/LICENSE)

[getumbrel.com](https://getumbrel.com)
