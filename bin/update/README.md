# Over-The-Air (OTA) Updates
How over-the-air updates work on Umbrel.

## Execution Flow

1. New developments across the any/entire fleet of Umbrel's services (bitcoind, lnd, dashboard, middleware, etc) are made, which maintain their own independent version-control and release-schedule. Subsequently, their new docker images are built, tagged and pushed to Docker Hub.

2. The newly built and tagged images are updated in the main repository's (this repo) [`docker-compose.yml`]().

3. Any new developments to the main repository (this repo) are made, eg. adding a new directory or a new config file.

4. To prepare a new release of Umbrel, called `vX.Y.Z`, a PR is opened that updates the [`info.json`]() file to:

```
{
    "version": "X.Y.Z",
    "name": "Umbrel vX.Y.Z",
    "notes": "This release contains a number of bug fixes and new features."
    "requires": "A.B.C" 
}
```

5. Once the PR is merged, the master branch is immediately tagged `vX.Y.Z` and released on GitHub.

6. The new `info.json` will automatically be refreshed at `https://raw.github.com/getumbrel/umbrel/master/info.json`. This is what pushes the OTA update.

6. When the user opens his [`umbrel-dashboard`](), it periodically polls [`umbrel-manager`]() to check for new updates.

7. `umbrel-manager` fetches the latest `info.json` from umbrel's main repo's master branch using `GET https://raw.github.com/getumbrel/umbrel/master/info.json`, compares it's `version` with the `version` of the local `info.json` file, and exits if both the versions are same.

8. If fetched `version` > local `version`, `umbrel-manager` checks if local `version` >= `requires` in the fetched `info.json`.

9. If not, umbrel-manager makes a `GET` request to `https://raw.github.com/getumbrel/umbrel/vX.Y.Z/info.json` and repeats step 8 (until local `version` >= `requires`). 

10. `umbrel-manager` then returns the `info.json` to `umbrel-dashboard`.

11. `umbrel-dashboard` then alerts the user regarding the new update, and after thee user consents, `umbrel-dashboard` makes a `POST` request to `umbrel-manager` to start the update process.

14. `umbrel-manager` creates a signal file on the mounted host OS volume (`/statuses/start-updated`) with the content `vX.Y.Z`, and returns `200 OK` to the `umbrel-dashboard`.

15. `fswatch`, a file monitoring tool that's continuosly monitoring the (`/statuses/start-update`) files notices the change, and immeditaly runs `./start.sh`

16. `start.sh` clones release `vX.Y.Z` from github in `/tmp/umbrel-vX.Y.Z`

17. `start.sh` then executes all of the following update scripts in `/tmp/umbrel-vX.Y.Z` one-by-one:

- `00-run.sh`: Pre-update preparation script (does things like make a backup)
- `01-run.sh`: Install update script (installs the update)
- `02-run.sh`: Post-update script (used to run unit-tests to make sure the update was successfully installed)
- `03-run.sh`: Success script (runs after the updated has been successfully downloaded and installeed)

All of the above scripts continuosly update `/bin/update/status.json` with the progress of upgrade, which the dashboard periodically fetches every 2s via `umbrel-manager` to notify the user on the progress of update.
