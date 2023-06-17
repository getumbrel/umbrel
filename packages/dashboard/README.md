[![Umbrel Dashboard](https://static.getumbrel.com/github/github-banner-umbrel-dashboard.svg)](https://github.com/getumbrel/umbrel-dashboard)

[![Version](https://img.shields.io/github/v/release/getumbrel/umbrel-dashboard?color=%235351FB&label=version)](https://github.com/getumbrel/umbrel-dashboard/releases)
[![Docker Build](https://img.shields.io/github/workflow/status/getumbrel/umbrel-dashboard/Docker%20build%20on%20push?color=%235351FB)](https://github.com/getumbrel/umbrel-dashboard/actions?query=workflow%3A"Docker+build+on+push")
[![Docker Pulls](https://img.shields.io/docker/pulls/getumbrel/dashboard?color=%235351FB)](https://hub.docker.com/repository/registry-1.docker.io/getumbrel/dashboard/tags?page=1)
[![Community Chat](https://img.shields.io/badge/community%20chat-telegram-%235351FB)](https://t.me/getumbrel)
[![Developer Chat](https://img.shields.io/badge/dev%20chat-keybase-%235351FB)](https://keybase.io/team/getumbrel)

[![Twitter](https://img.shields.io/twitter/follow/getumbrel?style=social)](https://twitter.com/getumbrel)
[![Reddit](https://img.shields.io/reddit/subreddit-subscribers/getumbrel?label=Subscribe%20%2Fr%2Fgetumbrel&style=social)](https://reddit.com/r/getumbrel)


# ☂️ dashboard

Dashboard is the web-based user interface of [Umbrel OS](https://github.com/getumbrel/umbrel-os) and is accessible at `http://umbrel.local`. It runs by-default as a containerized service.

## 🚀 Getting started

If you are looking to run Umbrel on your hardware, you do not need to run this service on it's own. Just download [Umbrel OS](https://github.com/getumbrel/umbrel-os/releases) and you're good to go.

## 🛠 Running dashboard

Make sure [`umbrel-manager`](https://github.com/getumbrel/umbrel-manager) is running and available. Alternatively, if you have an Umbrel running already and you only want to make changes to the dashboard, you can connect to it directly without running `umbrel-manager`.

### Step 1. Install dependencies
```sh
yarn
```

### Step 2. Set environment variables
The following environment variables are set in `.env` file of the project's root:

| Variable | Description | Default |
| ------------- | ------------- | ------------- |
| `VUE_APP_MANAGER_API_URL` | URL of [`umbrel-manager`](https://github.com/getumbrel/umbrel-manager) API | `http://localhost:3006` |

If you want to change the local development environment (e.g. to use your local Umbrel instance), create the `.env.development` with the following content:

```sh
VUE_APP_MANAGER_API_URL=http://umbrel.local/manager-api
```

### Step 3. Run dashboard
```sh
yarn serve
```

Dashboard should now be accessible at `http://localhost:8080`.

> If your local dashboard can't get past loading in the web browser, you will need to install a CORS unblocking extension in your browser to make it work. For example, [here's one for Chrome](https://chrome.google.com/webstore/detail/cors-unblock/lfhmikememgdcahcdlaciloancbhjino?hl=en).

## Building dashboard
To build dashboard for production, run:
```sh
yarn build
```
Built code will be inside `/dist`.

---

### ⚡️ Don't be too reckless

> Umbrel is still in an early stage and things are expected to break every now and then. We **DO NOT** recommend running it on the mainnet with real money just yet, unless you want to be really *#reckless*.

## ❤️ Contributing

We welcome and appreciate new contributions!

If you're a developer looking to help but not sure where to begin, check out [these issues](https://github.com/getumbrel/umbrel-dashboard/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) that have specifically been marked as being friendly to new contributors.

If you're looking for a bigger challenge, before opening a pull request please [create an issue](https://github.com/getumbrel/umbrel-dashboard/issues/new/choose) or [join our community chat](https://t.me/getumbrel) to get feedback, discuss the best way to tackle the challenge, and to ensure that there's no duplication of work.

## 📜 License

Umbrel (and Umbrel Dashboard) is licensed under the PolyForm Noncommercial 1.0.0 license. TL;DR — You're free to use, fork, modify, and redestribute Umbrel for personal and nonprofit use under the same license. If you're interested to use Umbrel for commercial purposes, such as selling plug-and-play home servers with Umbrel, etc — please reach out to us at partner@getumbrel.com.

[![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-%235351FB)](https://github.com/getumbrel/umbrel/blob/master/LICENSE.md)

[getumbrel.com](https://getumbrel.com)
