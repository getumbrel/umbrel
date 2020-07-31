# Docker network setup

This is the current network setup for docker-compose. You can also refer to them by name as well within the containers (eventually this will happen). An alternate mirror can be found [here](https://github.com/getumbrel/umbrel/wiki/Docker-Compose-networking).

## Default configuration

**Subnet mask:** 10.11.0.0/16 (10.11.* range for those who don't speak CIDR)

Box        | IP Address |
-----------| -----------|
tor        | 10.11.5.1  |
nginx      | 10.11.0.2  |
bitcoin    | 10.11.1.1  |
lnd        | 10.11.1.2  |
dashboard  | 10.11.0.3  |
manager    | 10.11.2.1  |
middleware  | 10.11.2.2 |
neutrino-switcher  | 10.11.5.2 |
frontail  | 10.11.3.0 |
