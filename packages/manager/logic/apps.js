const diskService = require('services/disk.js');
const diskLogic = require('logic/disk.js');
const reposLogic = require('logic/repos.js');
const NodeError = require('models/errors.js').NodeError;
const deriveEntropy = require('modules/derive-entropy');
const constants = require('utils/const.js');
const semver = require('semver');
const path = require('path');

const APP_MANIFEST_FILENAME = "umbrel-app.yml";
const APP_MANIFEST_SUPPORTED_VERSION = '1.1';

function isValidAppManifest(app) {
  return typeof(app) === "object" && typeof(app.id) === "string";
}

// Using the active repo id and app id
// Return the app's manifest file (as an object)
async function getAppManifest(folder, appId, manifestFilename) {
  let app;
  try {
    const appYamlPath = path.join(folder, appId, manifestFilename);
    app = await diskService.readYamlFile(appYamlPath);
  } catch(e) {
    throw new NodeError(`Failed to parse ${appId} manifest file`);
  }

  // Check that app object looks like an app...
  if(! isValidAppManifest(app))
  {
    throw new NodeError(`Invalid ${appId} manifest file`);
  }

  return app;
}

async function addAppMetadata(apps) {
  // Do all hidden service lookups concurrently
  await Promise.all(apps.map(async app => {
    try {
      app.hiddenService = await diskLogic.readHiddenService(`app-${app.id}`);
    } catch(e) {
      app.hiddenService = '';
    }
  }));

  // Derive all passwords concurrently
  await Promise.all(apps.filter(app => app.deterministicPassword).map(async app => {
    try {
      app.defaultPassword = await deriveEntropy(`app-${app.id}-seed-APP_PASSWORD`);
    } catch(e) {
      app.defaultPassword = '';
    }
  }));
  
  apps = apps.map((app) => {
    // Set app update defaults
    app.update = { version: "", releaseNotes: "" }

    // Set an icon property if it doesn't exist
    // Default to using Umbrel gallery assets
    if(app.icon === undefined) {
      app.icon = `${constants.UMBREL_GALLERY_ASSETS_BASE_URL}/${app.id}/icon.svg`;
    }

    app.gallery = app.gallery.map(image => {
      if(image.startsWith('http://') || image.startsWith('https://')) {
        return image;
      }

      return `${constants.UMBREL_GALLERY_ASSETS_BASE_URL}/${app.id}/${image}`;
    });

    return app;
  });

  return apps;
}

// Filter to only 'fulfilled' promises and return value
function filterMapFulfilled(list) {
  return list.filter(settled => settled.status === 'fulfilled').map(settled => settled.value);
}

async function getInstalled(user) {
  let apps = await Promise.allSettled(user.installedApps.map(appId => getAppManifest(constants.APP_DATA_DIR, appId, APP_MANIFEST_FILENAME)));

  apps = filterMapFulfilled(apps);

  // Map some metadata onto each app object
  apps = await addAppMetadata(apps);

  // Check available app updates
  apps = await Promise.all(apps.map(async (app) => {

    // sanity check
    if (!user.appOrigin || !user.appOrigin[app.id]) {
      return app;
    }
    
    // get repo path of the app
    const appRepoPath = path.join(constants.REPOS_DIR, reposLogic.slug(user.appOrigin[app.id]));
    try {
      // get app's manifest in its repo
      const appInAppStore = await getAppManifest(appRepoPath, app.id, APP_MANIFEST_FILENAME);
      // check version
      if (app.version != appInAppStore.version) {
        app.update.version = appInAppStore.version;
        app.update.releaseNotes = appInAppStore.releaseNotes;
      }
    }
    catch(e) {
      console.error("Error comparing version of the app", e);
    }

    return app;
  }));

  return apps;
} 

async function get(query) {
  const user = await diskLogic.readUserFile();

  if(query.installed) {
    return getInstalled(user);
  }

  const repos = await reposLogic.all(user);
  const repo = repos.find(repo => {
    return repo.id === query.repo;
  });

  if(repo === undefined) {
    throw new NodeError(`Unable to locate repo: ${query.repo}`);
  }
  
  let apps = [];

  // Read all app yaml files from a given app repo
  const activeAppRepoFolder = path.join(constants.REPOS_DIR, reposLogic.slug(repo.url));

  let appIds = [];
  try {
    // Ignore dot/hidden folders
    appIds = (await diskService.listDirsInDir(activeAppRepoFolder)).filter(folder => folder[0] !== '.');
  } catch(e) {
    console.error(`Error reading directory: ${activeAppRepoFolder}`, e);
  }
  
  try {
    let appsInRepo = await Promise.allSettled(appIds.map(appId => getAppManifest(activeAppRepoFolder, appId, APP_MANIFEST_FILENAME)));

    appsInRepo = filterMapFulfilled(appsInRepo);

    // Map some metadata onto each app object
    apps = await addAppMetadata(appsInRepo);
  } catch(e) {
    console.error(`Error reading app manifest`, e);
  }

  // If the repo is a community app store
  // We need to check if the app id is prefixed (or namespaced) with the repo id
  // (defined inside of the umbrel-app-store.yml)
  if(repo.id !== constants.UMBREL_APP_STORE_REPO.id) {
    apps = apps.filter(app => {
      return app.id.startsWith(`${repo.id}-`);
    });
  }

  return apps;
}

async function find(id){
  const user = await diskLogic.readUserFile();

  // Loop through the repos to find the app
  for (const repoUrl of user.repos) {
    const appYamlPath = path.join(constants.REPOS_DIR, reposLogic.slug(repoUrl), id, APP_MANIFEST_FILENAME);
    if(await diskLogic.fileExists(appYamlPath)) {
      const activeAppRepoFolder = path.join(constants.REPOS_DIR, reposLogic.slug(repoUrl));
      return await getAppManifest(activeAppRepoFolder, id, APP_MANIFEST_FILENAME);
    }
  }

  return null;
}

async function isValidAppId(id) {
  return (await find(id)) !== null;
}

async function canInstallOrUpdateApp(id) {
  const app = await find(id);

  // Now check the app's manifest version
  return semver.lte(semver.coerce(app.manifestVersion), semver.coerce(APP_MANIFEST_SUPPORTED_VERSION));
}

async function install(id) {
  if(! await isValidAppId(id)) {
    throw new NodeError('Invalid app id');
  }

  if(! await canInstallOrUpdateApp(id)) {
    throw new NodeError('This app requires a newer version of Umbrel. Please update your Umbrel to install it.');
  }

  try {
    await diskLogic.writeSignalFile(`app-install-${id}`);
  } catch (error) {
    throw new NodeError('Could not write the signal file');
  }
};

async function update(id) {
  if(! await isValidAppId(id)) {
    throw new NodeError('Invalid app id');
  }

  if(! await canInstallOrUpdateApp(id)) {
    throw new NodeError('Unsupported app manifest version. Please update your Umbrel.');
  }

  try {
    await diskLogic.writeSignalFile(`app-update-${id}`);
  } catch (error) {
    throw new NodeError('Could not write the signal file');
  }
};

async function uninstall(id) {
  try {
    await diskLogic.writeSignalFile(`app-uninstall-${id}`);
  } catch (error) {
    throw new NodeError('Could not write the signal file');
  }
};

module.exports = {
  get,
  install,
  uninstall,
  update,
  getInstalled
};
