[![Umbrel App Proxy](https://static.getumbrel.com/github/github-banner-umbrel-app-proxy.svg)](https://github.com/getumbrel/umbrel-app-proxy)

[![Docker Build](https://img.shields.io/github/workflow/status/getumbrel/umbrel-app-proxy/Docker%20build%20on%20push?color=%235351FB)](https://github.com/getumbrel/umbrel-app-proxy/actions?query=workflow%3A"Docker+build+on+push")
[![Docker Pulls](https://img.shields.io/docker/pulls/getumbrel/app-proxy?color=%235351FB)](https://hub.docker.com/repository/registry-1.docker.io/getumbrel/app-proxy/tags?page=1)


# ☂️ App Proxy

App-proxy is a transparent HTTP proxy to add authentication to Umbrel apps. Every HTTP request and Websocket connection goes through the proxy and each request has the session token checked for validity. The session token is set via [App-auth](https://github.com/getumbrel/umbrel/tree/master/deps/app-auth). It runs by-default as a containerized service.

## 🚀 Getting started

If you are looking to run Umbrel on your hardware, you do not need to run this service on it's own. Just download [Umbrel OS](https://github.com/getumbrel/umbrel-os/releases) and you're good to go.

## 🛠 Running app-proxy

Make sure [`umbrel-manager`](https://github.com/getumbrel/umbrel-manager) and [`app-auth`](https://github.com/getumbrel/umbrel/tree/master/deps/app-auth) are running and available.

### Development and testing
```sh
cd $UMBREL_ROOT/deps/app-proxy/test
./test.sh docker-compose.app1.yml
```

Within the `test` directory there are several test apps to test different functionality such as Websocket and SSE with the proxy. 

### Environment variables (dev/testing)
The following environment variables are set in `.env` file of the project's root:

| Variable | Description | Default |
| ------------- | ------------- | ------------- |
| `LOG_LEVEL` | Log level for the proxy (`http-proxy-middleware`) | `info` |
| `PROXY_PORT` | HTTP proxy container port | `4000` |
| `PROXY_AUTH_ADD` | `true`/`false` as to whether the app should be protected with authentication | `true` |
| `PROXY_AUTH_WHITELIST` | A comma seperated list of paths that are whitelisted (e.g. `/public/*`) |  |
| `PROXY_AUTH_BLACKLIST` | A comma seperated list of paths that are whitelisted (e.g. `/admin/*,/api/*`) |  |
| `APP_HOST` | App's frontend container hostname/IP |  |
| `APP_PORT` | App's frontend container port |  |
| `APP_MANIFEST_FILE` | Location of app's manifest file | `/extra/umbrel-app.yml` |
| `UMBREL_AUTH_PORT` | App-auth's exposed (port-forwarded) port | `2000` |
| `UMBREL_AUTH_SECRET` | A shared secret for manager, app-auth and app-proxy | `umbrel` |
| `UMBREL_AUTH_HIDDEN_SERVICE_FILE` | Location of app-auth's Tor HS hostname | `/var/lib/tor/auth/hostname` |
| `MANAGER_IP` | Umbrel's manager IP | `10.21.21.4` |
| `MANAGER_PORT` | Umbrel's manager container port | `9005` |
