const axios = require('axios');
const semverGt = require('semver/functions/gt');
const semverSatisfies = require('semver/functions/satisfies');
const semverMinVersion = require('semver/ranges/min-version');
const encode = require('lndconnect').encode;

const diskLogic = require('logic/disk.js');
const appsLogic = require('logic/apps.js');
const constants = require('utils/const.js');
const NodeError = require('models/errors.js').NodeError;

async function getInfo() {
    try {
        const info = await diskLogic.readUmbrelVersionFile();
        return info;
    } catch (error) {
        throw new NodeError('Unable to get system information');
    }
};

async function getHiddenServiceUrl() {
    try {
        const url = await diskLogic.readHiddenService('web');
        return url;
    } catch (error) {
        throw new NodeError('Unable to get hidden service url');
    }
};

async function getElectrumConnectionDetails() {
    try {
        const address = await diskLogic.readElectrumHiddenService();
        const port = constants.ELECTRUM_PORT;
        const connectionString = `${address}:${port}:t`;
        return {
            address,
            port,
            connectionString
        };
    } catch (error) {
        throw new NodeError('Unable to get Electrum hidden service url');
    }
};

async function getBitcoinP2PConnectionDetails() {
    try {
        const address = await diskLogic.readBitcoinP2PHiddenService();
        const port = constants.BITCOIN_P2P_PORT;
        const connectionString = `${address}:${port}`;
        return {
            address,
            port,
            connectionString
        };
    } catch (error) {
        throw new NodeError('Unable to get Bitcoin P2P hidden service url');
    }
};

async function getBitcoinRPCConnectionDetails() {
    try {
        const [user, hiddenService] = await Promise.all([
          diskLogic.readUserFile(),
          diskLogic.readBitcoinRPCHiddenService(),
        ]);
        const label = encodeURIComponent(`${user.name}'s Umbrel`);
        const rpcuser = constants.BITCOIN_RPC_USER;
        const rpcpassword = constants.BITCOIN_RPC_PASSWORD;
        const address = hiddenService;
        const port = constants.BITCOIN_RPC_PORT;
        const connectionString = `btcrpc://${rpcuser}:${rpcpassword}@${address}:${port}?label=${label}`;
        return {
            rpcuser,
            rpcpassword,
            address,
            port,
            connectionString
        };
    } catch (error) {
        throw new NodeError('Unable to get Bitcoin RPC connection details');
    }
};

async function getLatestRelease() {
    const {name} = await diskLogic.readUmbrelVersionFile();
    const response = await axios.get('https://api.umbrel.com/latest-release', {
        headers: {'User-Agent': name}
    });

    return response.data;
}

// Poll for update
(async () => {
    const ONE_SECOND = 1000;
    const ONE_MINUTE = ONE_SECOND * 60;
    const ONE_HOUR = ONE_MINUTE * 60;
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    const currentVersion = (await diskLogic.readUmbrelVersionFile()).version;

    while (true) {
        try {
            const latestVersion = (await getLatestRelease()).version;
            const isNewVersionAvailable = semverGt(latestVersion, currentVersion);
            if(isNewVersionAvailable) {
                // TODO: Send realtime notification to ui
            }
        } catch (error) {
            console.log(`Error fetching latest release: ${error.message}`);
        }
        await delay(ONE_HOUR);
    }
})();

async function getAvailableUpdate() {
    try {
        const current = await diskLogic.readUmbrelVersionFile();
        const currentVersion = current.version;

        let tag = (await getLatestRelease()).version;
        let data;
        let isNewVersionAvailable = true;
        let isCompatibleWithCurrentVersion = false;

        // Try finding for a new update until there's a new version available
        // which is compatible with the currently installed version
        while (isNewVersionAvailable && !isCompatibleWithCurrentVersion) {
            const infoUrl = `https://raw.githubusercontent.com/${constants.GITHUB_REPO}/${tag}/info.json?time=${Date.now()}`;

            const latestVersionInfo = await axios.get(infoUrl);
            data = latestVersionInfo.data;

            let latestVersion = data.version;
            let requiresVersionRange = data.requires;

            // A new version is available if the latest version > local version
            isNewVersionAvailable = semverGt(latestVersion, currentVersion);

            // It's compatible with the current version if current version
            // satisfies the 'requires' condition of the new version
            isCompatibleWithCurrentVersion = semverSatisfies(currentVersion, requiresVersionRange);

            // Calculate the minimum required version
            let minimumVersionRequired = `v${semverMinVersion(requiresVersionRange)}`;

            // If the minimum required version is what we just checked for, exit
            // This usually happens when an OTA update breaking release x.y.z is made
            // that also has x.y.z as the minimum required version
            if (tag === minimumVersionRequired) {
                break;
            }

            // Update tag to the minimum required version for the next loop run
            tag = minimumVersionRequired;
        }


        if (isNewVersionAvailable && isCompatibleWithCurrentVersion) {
            return data;
        }

        return "Your Umbrel is up-to-date";
    }
    catch (error) {
        console.log(`Error getting available update: ${error.message}`);
        throw new NodeError('Unable to check for update');
    }
};

async function getUpdateStatus() {
    try {
        const status = await diskLogic.readUpdateStatusFile()
        return status;
    } catch (error) {
        throw new NodeError('Unable to get update status');
    }
}

async function startUpdate() {

    let availableUpdate;

    // Fetch available update
    try {
        availableUpdate = await getAvailableUpdate();
        if (!availableUpdate.version) {
            return availableUpdate;
        }
    } catch (error) {
        throw new NodeError('Unable to fetch latest release');
    }

    // Make sure an update is not already in progress
    const updateInProgress = await diskLogic.updateLockFileExists();
    if (updateInProgress) {
        throw new NodeError('An update is already in progress');
    }

    // Update status file with update version
    try {
        const updateStatus = await diskLogic.readUpdateStatusFile();
        updateStatus.updateTo = `v${availableUpdate.version}`;
        await diskLogic.writeUpdateStatusFile(updateStatus);
    } catch (error) {
        throw new NodeError('Could not update the update-status file');
    }

    // Write update signal file
    try {
        await diskLogic.writeUpdateSignalFile()
        return { message: "Updating to Umbrel v" + availableUpdate.version };
    } catch (error) {
        throw new NodeError('Unable to write update signal file');
    }
}

async function getBackupStatus() {
    try {
        const status = await diskLogic.readBackupStatusFile()
        return status;
    } catch (error) {
        throw new NodeError('Unable to get backup status');
    }
}

async function getRemoteTorAccessStatus() {
    try {
        const status = await diskLogic.readRemoteTorAccessStatusFile()
        return status;
    } catch (error) {
        console.error(error);
        
        throw new NodeError('Unable to get remote tor access status');
    }
}

async function getLndConnectUrls() {

    let cert;
    try {
        cert = await diskLogic.readLndCert();
    } catch (error) {
        throw new NodeError('Unable to read lnd cert file');
    }

    let macaroon;
    try {
        macaroon = await diskLogic.readLndAdminMacaroon();
    } catch (error) {
        throw new NodeError('Unable to read lnd macaroon file');
    }

    let restTorHost;
    try {
        restTorHost = await diskLogic.readLndRestHiddenService();
        restTorHost += ':8080';
    } catch (error) {
        throw new NodeError('Unable to read lnd REST hostname file');
    }
    const restTor = encode({
        host: restTorHost,
        cert,
        macaroon,
    });

    let grpcTorHost;
    try {
        grpcTorHost = await diskLogic.readLndGrpcHiddenService();
        grpcTorHost += ':10009';
    } catch (error) {
        throw new NodeError('Unable to read lnd gRPC hostname file');
    }
    const grpcTor = encode({
        host: grpcTorHost,
        cert,
        macaroon,
    });

    let restLocalHost = `${constants.DEVICE_HOSTNAME}:8080`;
    const restLocal = encode({
        host: restLocalHost,
        cert,
        macaroon,
    });

    let grpcLocalHost = `${constants.DEVICE_HOSTNAME}:10009`;
    const grpcLocal = encode({
        host: grpcLocalHost,
        cert,
        macaroon,
    });

    return {
        restTor,
        restLocal,
        grpcTor,
        grpcLocal
    };

}

async function requestDebug() {
    try {
        await diskLogic.writeSignalFile('debug');
        return "Debug requested";
    } catch (error) {
        throw new NodeError('Could not write the signal file');
    }
}

async function getDebugResult() {
  try {
    return await diskLogic.readDebugStatusFile();
  } catch (error) {
    throw new NodeError('Unable to get debug results');
  }
}

async function requestShutdown() {
    try {
        await diskLogic.shutdown();
        return "Shutdown requested";
    } catch (error) {
        throw new NodeError('Unable to request shutdown');
    }
};

async function requestReboot() {
    try {
        await diskLogic.reboot();
        return "Reboot requested";
    } catch (error) {
        throw new NodeError('Unable to request reboot');
    }
};

async function setRemoteTorAccess(enabled) {
    const user = await diskLogic.readUserFile();

    if(user.remoteTorAccess === enabled) {
        throw new NodeError(`Already turned ${enabled ? 'on' : 'off'}`);
    }

    let status = {};
    try {
        status = await diskLogic.readRemoteTorAccessStatusFile();
    } catch(error) {
        // The status file might not exist throwing an exception for the first time
        console.error(error);
    }

    if(status.state === 'running') {
        throw new NodeError('Already in progress');
    }

    try {
        await diskLogic.setRemoteTorAccess(enabled);
        return "Toggle Remote Tor Access";
    } catch (error) {
        throw new NodeError('Unable to request Remote Tor Access');
    }
};

async function status() {
    try {
      const highMemoryUsage = await diskLogic.memoryWarningStatusFileExists();
      return {
        highMemoryUsage
      };
    } catch (error) {
        throw new NodeError('Unable check system status');
    }
};

async function clearMemoryWarning() {
    try {
      await diskLogic.deleteMemoryWarningStatusFile();
      return "High memory warning dismissed"
    } catch (error) {
        throw new NodeError('Unable to dismiss high memory warning');
    }
};

async function getComputeResourceUsage(resource) {
    const user = await diskLogic.readUserFile();

    const installedApps = await appsLogic.getInstalled(user);

    const update = await diskLogic.readSystemStatusFile(resource);

    if(Array.isArray(update.breakdown)) {
        update.breakdown = update.breakdown.map(function(row){
            if(row.id === 'umbrel') return row;

            const appMetadata = installedApps.find(app => app.id === row.id)

            if(appMetadata) {
                row.name = appMetadata.name;
                row.icon = appMetadata.icon;
            }            

            return row;
        });
    }

    return update;
}

module.exports = {
    getInfo,
    getHiddenServiceUrl,
    getElectrumConnectionDetails,
    getBitcoinP2PConnectionDetails,
    getBitcoinRPCConnectionDetails,
    getAvailableUpdate,
    getUpdateStatus,
    startUpdate,
    getBackupStatus,
    getRemoteTorAccessStatus,
    getLndConnectUrls,
    requestDebug,
    getDebugResult,
    requestShutdown,
    requestReboot,
    setRemoteTorAccess,
    status,
    clearMemoryWarning,
    getComputeResourceUsage
};
