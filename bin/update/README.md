# Over-The-Air (OTA) Updates
How over-the-air updates work on Umbrel.

## Execution Flow

1. New developments across the any/entire fleet of Umbrel's services (bitcoind, lnd, dashboard, middleware, etc) are made, which maintain their own independent version-control and release-schedule. Subsequently, their new docker images are built, tagged and pushed to Docker Hub.

2. The newly built and tagged images are updated in the main repository's (i.e. this repo) [`docker-compose.yml`](https://github.com/mayankchhabra/umbrel/blob/ota-updates/docker-compose.yml) file.

3. Any new developments to the main repository (i.e. this repo) are made, eg. adding a new directory or a new config file.

4. To prepare a new release of Umbrel, called `vX.Y.Z`, a PR is opened that updates the [`info.json`](https://github.com/mayankchhabra/umbrel/blob/ota-updates/info.json) file to:

```
{
    "version": "X.Y.Z",
    "name": "Umbrel vX.Y.Z",
    "notes": "This release contains a number of bug fixes and new features."
    "requires": "A.B.C" 
}
```

5. Once the PR is merged, the master branch is immediately tagged `vX.Y.Z` and released on GitHub.

6. Thus the new `info.json` will automatically be available at `https://raw.githubusercontent.com/getumbrel/umbrel/master/info.json`. This is what triggers the OTA update.

6. When the user opens his [`umbrel-dashboard`](https://github.com/getumbrel/umbrel-dashboard), it periodically polls [`umbrel-manager`](https://github.com/getumbrel/umbrel-manager) to check for new updates.

7. `umbrel-manager` fetches the latest `info.json` from umbrel's main repo's master branch using `GET https://raw.githubusercontent.com/getumbrel/umbrel/master/info.json`, compares it's `version` with the `version` of the local `$HOME/info.json` file, and exits if both the versions are same.

8. If fetched `version` > local `version`, `umbrel-manager` checks if local `version` >= `requires` in the fetched `info.json`.

9. If not, umbrel-manager makes a `GET` request to `https://raw.githubusercontent.com/getumbrel/umbrel/vX.Y.Z/info.json` and repeats step 8 and 9 until local `version` >= `requires`. 

10. `umbrel-manager` then returns the satisfactory `info.json` to `umbrel-dashboard`.

11. `umbrel-dashboard` then alerts the user regarding the new update, and after the user consents, it makes a `POST` request to `umbrel-manager` to start the update process.

14. `umbrel-manager` creates a signal file on the mounted host OS volume (`$HOME/statuses/start-updated`) with the version `X.Y.Z`, and returns `200 OK` to the `umbrel-dashboard`.

15. [`fswatch`](https://github.com/emcrisostomo/fswatch), a file monitoring tool that's continuosly monitoring the `$HOME/statuses/start-update` file notices the change, and immeditaly runs [`$HOME/bin/update/start.sh`](https://github.com/mayankchhabra/umbrel/blob/ota-updates/bin/update/start.sh) as root.

16. `$HOME/bin/update/start.sh` clones release `vX.Y.Z` from github in `/tmp/umbrel-vX.Y.Z`.

17. `$HOME/bin/update/start.sh` then executes all of the following update scripts from the new release `/tmp/umbrel-vX.Y.Z` one-by-one:

- [`/tmp/umbrel-vX.Y.Z/bin/update/00-run.sh`](https://github.com/mayankchhabra/umbrel/blob/ota-updates/bin/update/00-run.sh): Pre-update preparation script (does things like make a backup)
- [`/tmp/umbrel-vX.Y.Z/bin/update/01-run.sh`](https://github.com/mayankchhabra/umbrel/blob/ota-updates/bin/update/01-run.sh): Install update script (installs the update)
- [`/tmp/umbrel-vX.Y.Z/bin/update/02-run.sh`](https://github.com/mayankchhabra/umbrel/blob/ota-updates/bin/update/02-run.sh): Post-update script (used to run unit-tests to make sure the update was successfully installed)
- [`/tmp/umbrel-vX.Y.Z/bin/update/03-run.sh`](https://github.com/mayankchhabra/umbrel/blob/ota-updates/bin/update/03-run.sh): Success script (runs after the updated has been successfully downloaded and installeed)

All of the above scripts continuosly update `$HOME/bin/update/status.json` with the progress of upgrade, which the dashboard periodically fetches every 2s via `umbrel-manager` to notify the user on the progress of update.
