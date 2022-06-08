[![Umbrel App Auth](https://static.getumbrel.com/github/github-banner-umbrel-app-auth.svg)](https://github.com/getumbrel/umbrel-app-auth)

[![Docker Build](https://img.shields.io/github/workflow/status/getumbrel/umbrel-app-auth/Docker%20build%20on%20push?color=%235351FB)](https://github.com/getumbrel/umbrel-app-auth/actions?query=workflow%3A"Docker+build+on+push")
[![Docker Pulls](https://img.shields.io/docker/pulls/getumbrel/app-auth?color=%235351FB)](https://hub.docker.com/repository/registry-1.docker.io/getumbrel/app-auth/tags?page=1)


# ☂️ App Auth

App-auth is a simple authentication and redirection system for Umbrel apps. It ensures (where applicable) that apps are password (and OTP) protected. It runs by-default as a containerized service.

## 🚀 Getting started

If you are looking to run Umbrel on your hardware, you do not need to run this service on it's own. Just download [Umbrel OS](https://github.com/getumbrel/umbrel-os/releases) and you're good to go.

## 🛠 Running app-auth

Make sure [`umbrel-manager`](https://github.com/getumbrel/umbrel-manager) are running and available.

### Development and testing
```sh
cd $UMBREL_ROOT/deps/app-auth/test
./test.sh
```

### Environment variables (dev/testing)
The following environment variables are set in `.env` file of the project's root:

| Variable | Description | Default |
| ------------- | ------------- | ------------- |
| `PORT` | Web server port within container | `2000` |
| `UMBREL_AUTH_SECRET` | A shared secret for manager, app-auth and app-proxy | `umbrel` |
| `MANAGER_IP` | Umbrel's manager IP | `10.21.21.4` |
| `MANAGER_PORT` | Umbrel's manager container port | `9005` |
