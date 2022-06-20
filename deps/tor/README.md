[![Umbrel Tor](https://static.getumbrel.com/github/github-banner-umbrel-tor.svg)](https://github.com/getumbrel/umbrel-tor)

[![Docker Build](https://img.shields.io/github/workflow/status/getumbrel/umbrel-tor/Docker%20build%20on%20push?color=%235351FB)](https://github.com/getumbrel/umbrel-tor/actions?query=workflow%3A"Docker+build+on+push")
[![Docker Pulls](https://img.shields.io/docker/pulls/getumbrel/tor?color=%235351FB)](https://hub.docker.com/repository/registry-1.docker.io/getumbrel/tor/tags?page=1)


# ☂️ Tor

A simple Docker image for Tor

## 🛠 Build Tor Docker image

### Build
```sh
docker build -t getumbrel/tor .
```

### Run
```sh
docker run --rm -u 1000:1000 -e HOME=/tmp getumbrel/tor
```