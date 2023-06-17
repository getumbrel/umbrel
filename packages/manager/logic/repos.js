const path = require('path');
const constants = require('utils/const.js');
const diskService = require('services/disk.js');
const diskLogic = require('logic/disk.js');
const NodeError = require('models/errors.js').NodeError;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const REPO_MANIFEST_FILENAME = "umbrel-app-store.yml";

// Given a repo url, return the repo folder name
// Use '-' as a slug
function slug(repoUrl) {
  // Replace all non alpha-numeric characters with hyphen
  return repoUrl.replace(/[^a-zA-Z0-9]/g, "-");
}

function fullUrl(str) {
  const repoUrl = str.split('#')[0];

  if(str.includes('://') || str.includes('@')) {
    return repoUrl;
  }

  // We'll assume github.com
  return `https://github.com/${repoUrl}`;
}

async function transformRepo(repoUrl) {
  if(repoUrl === constants.UMBREL_APP_STORE_REPO.url) {
    return constants.UMBREL_APP_STORE_REPO;
  }

  const id = slug(repoUrl);

  const repoYamlPath = path.join(constants.REPOS_DIR, id, REPO_MANIFEST_FILENAME);
  const repo = await diskService.readYamlFile(repoYamlPath);

  repo.url = repoUrl;

  return repo;
}

function filterMapFulfilled(list) {
  return list.filter(settled => settled.status === 'fulfilled').map(settled => settled.value);
}

async function all(user) {
  const repos = await Promise.allSettled(user.repos.map(repoUrl => transformRepo(repoUrl)));

  return filterMapFulfilled(repos);
}

async function add(repoUrl) {
  try {
    await diskLogic.deleteRepoUpdateStatusFile();
  } catch (error) {
    throw new NodeError('Could not delete repo update status file');
  }

  try {
    await diskLogic.writeSignalFile('repo-add', repoUrl);
  } catch (error) {
    throw new NodeError('Could not write the signal file');
  }

  const start = (new Date()).getTime();
  const maxWait = 30 * 1000;
  while((new Date()).getTime() - start < maxWait) {
    let result;
    try {
      result = await diskLogic.readRepoUpdateStatusFile();
    } catch(e) {
      // The status file may not exist yet...
      console.error(e);

      continue;
    }

    if(result.url === repoUrl) {
      if(result.state === 'error') {
        throw new NodeError(result.description);
      }
      else if(result.state === 'success') {
        return;
      }
      else {
        // The process is still running...
      }
    }

    await delay(1000);
  }

  throw new NodeError(`Failed to add: ${repoUrl} as we timed out`);
};

async function remove(repoUrl) {
  try {
    await diskLogic.writeSignalFile('repo-remove', repoUrl);
  } catch (error) {
    throw new NodeError('Could not write the signal file');
  }
};

module.exports = {
  slug,
  fullUrl,
  all,
  add,
  remove
};

