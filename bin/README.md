# Over-The-Air (OTA) Updates
How over-the-air updates work on Umbrel.

## Execution Flow

1. New developments across the any/entire fleet of Umbrel's services (bitcoind, lnd, dashboard, middleware, etc) are made, which maintain their own independent version-control and release-schedule. Subsequently, their new docker images are built, tagged and pushed to Docker Hub.

2. The newly built and tagged images are updated in the main repository's (i.e. this repo) [`docker-compose.yml`](https://github.com/getumbrel/umbrel/blob/ota-updates/docker-compose.yml) file.

3. Any new developments to the main repository (i.e. this repo) are made, eg. adding a new directory or a new config file.

4. To prepare a new release of Umbrel, called `vX.Y.Z`, a PR is opened that updates the [`info.json`](https://github.com/getumbrel/umbrel/blob/ota-updates/info.json) file to:

```json
{
    "version": "X.Y.Z",
    "name": "Umbrel vX.Y.Z",
    "notes": "This release contains a number of bug fixes and new features.",
    "requires": ">=A.B.C" 
}
```

5. Once the PR is merged, the master branch is immediately tagged `vX.Y.Z` and released on GitHub.

6. Thus the new `info.json` will automatically be available at `https://raw.githubusercontent.com/getumbrel/umbrel/master/info.json`. This is what triggers the OTA update.

6. When the user opens his [`umbrel-dashboard`](https://github.com/getumbrel/umbrel-dashboard), it periodically polls [`umbrel-manager`](https://github.com/getumbrel/umbrel-manager) to check for new updates.

7. `umbrel-manager` fetches the latest `info.json` from umbrel's main repo's master branch using `GET https://raw.githubusercontent.com/getumbrel/umbrel/master/info.json`, compares it's `version` with the `version` of the local `$UMBREL_ROOT/info.json` file, and exits if both the versions are same.

8. If fetched `version` > local `version`, `umbrel-manager` checks if local `version` satisfies the `requires` condition in the fetched `info.json`.

9. If not, `umbrel-manager` computes the minimum satisfactory version, called `L.M.N`, required for update. Eg, for `"requires": ">=1.2.2"` the minimum satisfactory version would be `1.2.2`. `umbrel-manager` then makes a `GET` request to `https://raw.githubusercontent.com/getumbrel/umbrel/vL.M.N/info.json` and repeats step 8 and 9 until local `version` < fetched `version` **AND** local `version` fulfills the fetched `requires` condition. 

10. `umbrel-manager` then returns the satisfying `info.json` to `umbrel-dashboard`.

11. `umbrel-dashboard` then alerts the user regarding the available update, and after the user consents, it makes a `POST` request to `umbrel-manager` to start the update process.

12. `umbrel-manager` adds the `updateTo` key to `$UMBREL_ROOT/statuses/update-status.json` (a file used to continuosly update the user with the update status and progress) with the update release tag. 

```json
{
    ...
    "updateTo": "vX.Y.Z"
    ...
}
``` 

13. `umbrel-manager` then creates an update signal file on the mounted host OS volume (`$UMBREL_ROOT/events/signals/update`) and returns `OK` to the `umbrel-dashboard`.

14. [`karen`](https://github.com/getumbrel/umbrel/blob/master/karen) is triggered (obviously) as soon as `$UMBREL_ROOT/events/signals/update` is touched/updated, and immeditaly runs the `update` trigger script [`$UMBREL_ROOT/events/triggers/update`](https://github.com/getumbrel/umbrel/blob/ota-updates/events/triggers/update) as root.

15. `$UMBREL_ROOT/events/triggers/update` clones release `vX.Y.Z` from github in `$UMBREL_ROOT/.umbrel-vX.Y.Z`.

16. `$UMBREL_ROOT/events/triggers/update` then executes all of the following update scripts from the new release `$UMBREL_ROOT/.umbrel-vX.Y.Z` one-by-one:

- [`$UMBREL_ROOT/.umbrel-vX.Y.Z/bin/update/00-run.sh`](https://github.com/getumbrel/umbrel/blob/ota-updates/bin/update/00-run.sh): Pre-update preparation script (does things like making a backup)
- [`$UMBREL_ROOT/.umbrel-vX.Y.Z/bin/update/01-run.sh`](https://github.com/getumbrel/umbrel/blob/ota-updates/bin/update/01-run.sh): Install update script (installs the update)
- [`$UMBREL_ROOT/.umbrel-vX.Y.Z/bin/update/02-run.sh`](https://github.com/getumbrel/umbrel/blob/ota-updates/bin/update/02-run.sh): Post-update script (used to run unit-tests to make sure the update was successfully installed)
- [`$UMBREL_ROOT/.umbrel-vX.Y.Z/bin/update/03-run.sh`](https://github.com/getumbrel/umbrel/blob/ota-updates/bin/update/03-run.sh): Success script (runs after the updated has been successfully downloaded and installeed)

All of the above scripts continuosly update `$UMBREL_ROOT/statuses/update-status.json` with the progress of update, which the dashboard periodically fetches every 2s via `umbrel-manager` to keep the user updated.

### Further improvements

- Catch any error during the update and restore from the backup
- Restore from backup on power-failure
