const path = require('path');

const constants = require('utils/const.js');
const diskService = require('services/disk.js');

async function deleteUserFile() {
  return await diskService.deleteFile(constants.USER_FILE);
}

async function deleteItemsInDir(directory) {
  return await diskService.deleteItemsInDir(directory);
}

async function deleteFoldersInDir(directory) {
  await diskService.deleteFoldersInDir(directory);
}

async function fileExists(path) {
  return diskService.readUtf8File(path)
    .then(() => Promise.resolve(true))
    .catch(() => Promise.resolve(false));
}

async function getBuildDetails(appsToLaunch) {

  const details = [];

  for (const applicationName of Object.keys(appsToLaunch)) {
    const application = {};
    application.name = applicationName;
    const path = constants.WORKING_DIRECTORY + '/' + application.name + '/'
      + appsToLaunch[application.name].version + '/';
    application.ymlPath = path + application.name + '.yml';
    application.digestsPath = path + 'digests.json';
    details.push(application);
  }

  return details;
}

async function listVersionsForApp(app) {
  return await diskService.listDirsInDir(constants.WORKING_DIRECTORY + '/' + app);
}

async function moveFoldersToDir(fromDir, toDir) {
  await diskService.moveFoldersToDir(fromDir, toDir);
}

async function writeAppVersionFile(application, json) {
  return diskService.writeJsonFile(constants.WORKING_DIRECTORY + '/' + application, json);
}

async function readUserFile() {
  const defaultProperties = {
    name: "",
    password: "",
    seed: "",
    installedApps: [],
    repos: [ constants.UMBREL_APP_REPO_URL ],
    wallpaper: null,
    // By default, remote access via Tor is disabled
    remoteTorAccess: false
  };
  const userFile = await diskService.readJsonFile(constants.USER_FILE);
  return {...defaultProperties, ...userFile};
}

function readSettingsFile() {
  return diskService.readJsonFile(constants.SETTINGS_FILE);
}

function writeSettingsFile(json) {
  return diskService.writeJsonFile(constants.SETTINGS_FILE, json);
}

async function writeUserFile(json) {
  return diskService.writeJsonFile(constants.USER_FILE, json);
}

// Accept a function to apply a transformation to the user file
async function updateUserFile(update) {
  const userData = await readUserFile();
  const updatedUserData = update(userData);

  return writeUserFile(updatedUserData);
}

async function writeUmbrelSeedFile(umbrelSeed) {
  return diskService.ensureWriteFile(constants.UMBREL_SEED_FILE, umbrelSeed);
}

async function umbrelSeedFileExists(umbrelSeed) {
  return diskService.readFile(constants.UMBREL_SEED_FILE)
    .then(() => Promise.resolve(true))
    .catch(() => Promise.resolve(false));
}

function settingsFileExists() {
  return diskService.readJsonFile(constants.SETTINGS_FILE)
    .then(() => Promise.resolve(true))
    .catch(() => Promise.resolve(false));
}

function hiddenServiceFileExists() {
  return diskService.readUtf8File(constants.UMBREL_DASHBOARD_HIDDEN_SERVICE_FILE)
    .then(() => Promise.resolve(true))
    .catch(() => Promise.resolve(false));
}

async function readAppVersionFile(application) {
  return diskService.readJsonFile(constants.WORKING_DIRECTORY + '/' + application);
}

function readElectrumHiddenService() {
  return diskService.readUtf8File(constants.ELECTRUM_HIDDEN_SERVICE_FILE);
}

function readBitcoinP2PHiddenService() {
  return diskService.readUtf8File(constants.BITCOIN_P2P_HIDDEN_SERVICE_FILE);
}

function readBitcoinRPCHiddenService() {
  return diskService.readUtf8File(constants.BITCOIN_RPC_HIDDEN_SERVICE_FILE);
}

function readLndRestHiddenService() {
  return diskService.readUtf8File(constants.LND_REST_HIDDEN_SERVICE_FILE);
}

function readLndGrpcHiddenService() {
  return diskService.readUtf8File(constants.LND_GRPC_HIDDEN_SERVICE_FILE);
}

function readLndCert() {
  return diskService.readUtf8File(constants.LND_CERT_FILE);
}

function readLndAdminMacaroon() {
  return diskService.readFile(constants.LND_ADMIN_MACAROON_FILE);
}

function readUmbrelVersionFile() {
  return diskService.readJsonFile(constants.UMBREL_VERSION_FILE);
}

function readUpdateStatusFile() {
  return diskService.readJsonFile(constants.UPDATE_STATUS_FILE);
}

function writeUpdateStatusFile(json) {
  return diskService.writeJsonFile(constants.UPDATE_STATUS_FILE, json);
}

function updateSignalFileExists(version) {
  return diskService.readUtf8File(constants.UPDATE_SIGNAL_FILE)
    .then(() => Promise.resolve(true))
    .catch(() => Promise.resolve(false));
}

function updateLockFileExists(version) {
  return diskService.readUtf8File(constants.UPDATE_LOCK_FILE)
    .then(() => Promise.resolve(true))
    .catch(() => Promise.resolve(false));
}

function writeUpdateSignalFile() {
  return diskService.writeFile(constants.UPDATE_SIGNAL_FILE, 'true');
}

function readBackupStatusFile() {
  return diskService.readJsonFile(constants.BACKUP_STATUS_FILE);
}

function readRemoteTorAccessStatusFile() {
  return diskService.readJsonFile(constants.REMOTE_TOR_ACCESS_STATUS_FILE);
}

function readJWTPrivateKeyFile() {
  return diskService.readFile(constants.JWT_PRIVATE_KEY_FILE);
}

function readJWTPublicKeyFile() {
  return diskService.readFile(constants.JWT_PUBLIC_KEY_FILE);
}

function writeJWTPrivateKeyFile(data) {
  return diskService.writeKeyFile(constants.JWT_PRIVATE_KEY_FILE, data);
}

function writeJWTPublicKeyFile(data) {
  return diskService.writeKeyFile(constants.JWT_PUBLIC_KEY_FILE, data);
}

async function shutdown() {
  await diskService.writeFile(constants.SHUTDOWN_SIGNAL_FILE, 'true');
}

async function reboot() {
  await diskService.writeFile(constants.REBOOT_SIGNAL_FILE, 'true');
}

async function setRemoteTorAccess(enabled) {
  await diskService.writeFile(constants.REMOTE_TOR_ACCESS_SIGNAL_FILE, enabled.toString());
}

// Read the contends of a file.
async function readUtf8File(path) {
  return await diskService.readUtf8File(path);
}

// Read the contents of a file and return a json object.
async function readJsonFile(path) {
  return await diskService.readJsonFile(path);
}

// Send a signal to perform a migration.
async function migration() {
  await diskService.writeFile(constants.MIGRATION_SIGNAL_FILE, 'true');
}

function readMigrationStatusFile() {
  return diskService.readJsonFile(constants.MIGRATION_STATUS_FILE);
}

async function writeMigrationStatusFile(json) {
  return diskService.writeJsonFile(constants.MIGRATION_STATUS_FILE, json);
}

// Send a signal to enable/disable SSH.
async function enableSsh(state) {
  await diskService.writeFile(constants.SSH_SIGNAL_FILE, state);
}

function readSshSignalFile() {
  return diskService.readFile(constants.SSH_SIGNAL_FILE);
}

function readDebugStatusFile() {
  return diskService.readJsonFile(constants.DEBUG_STATUS_FILE);
}

function readRepoUpdateStatusFile() {
  return diskService.readJsonFile(constants.REPO_UPDATE_STATUS_FILE);
}

async function deleteRepoUpdateStatusFile() {
  const statusFile = constants.REPO_UPDATE_STATUS_FILE;
  if(await fileExists(statusFile)) {
    return diskService.deleteFile(constants.REPO_UPDATE_STATUS_FILE);
  }
}

// TODO: Transition all logic to use this signal function
function writeSignalFile(signalFile, contents = 'true') {
  if(!/^[0-9a-zA-Z-_]+$/.test(signalFile)) {
    throw new Error('Invalid signal file characters');
  }

  const signalFilePath = path.join(constants.SIGNAL_DIR, signalFile);
  return diskService.writeFile(signalFilePath, contents);
}

// TODO: Transition all logic to use this status function
function writeStatusFile(statusFile, contents) {
  if(!/^[0-9a-zA-Z-_]+$/.test(statusFile)) {
    throw new Error('Invalid signal file characters');
  }

  const statusFilePath = path.join(constants.STATUS_DIR, statusFile);
  return diskService.writeFile(statusFilePath, contents);
}

function readSystemStatusFile(resource) {
  const statusFilePath = path.join(constants.STATUS_DIR, `${resource}-status.json`);
  return diskService.readJsonFile(statusFilePath)
    .catch(() => null);
}

function statusFileExists(statusFile) {
  if(!/^[0-9a-zA-Z-_]+$/.test(statusFile)) {
    throw new Error('Invalid signal file characters');
  }

  const statusFilePath = path.join(constants.STATUS_DIR, statusFile);
  return diskService.readUtf8File(statusFilePath)
    .then(() => Promise.resolve(true))
    .catch(() => Promise.resolve(false));
}

function deleteStatusFile(statusFile) {
  if(!/^[0-9a-zA-Z-_]+$/.test(statusFile)) {
    throw new Error('Invalid signal file characters');
  }

  const statusFilePath = path.join(constants.STATUS_DIR, statusFile);
  return diskService.deleteFile(statusFilePath);
}

function readHiddenService(id) {
  if(!/^[0-9a-zA-Z-_]+$/.test(id)) {
    throw new Error('Invalid hidden service ID');
  }
  const hiddenServiceFile = path.join(constants.TOR_HIDDEN_SERVICE_DIR, id, 'hostname');
  return diskService.readUtf8File(hiddenServiceFile);
}

function memoryWarningStatusFileExists() {
  return statusFileExists('memory-warning');
}

function deleteMemoryWarningStatusFile() {
  return deleteStatusFile('memory-warning');
}

module.exports = {
  deleteItemsInDir,
  deleteUserFile,
  deleteFoldersInDir,
  moveFoldersToDir,
  fileExists,
  getBuildDetails,
  listVersionsForApp,
  readSettingsFile,
  readUserFile,
  writeAppVersionFile,
  writeSettingsFile,
  writeUserFile,
  updateUserFile,
  writeUmbrelSeedFile,
  umbrelSeedFileExists,
  settingsFileExists,
  hiddenServiceFileExists,
  readAppVersionFile,
  readElectrumHiddenService,
  readBitcoinP2PHiddenService,
  readBitcoinRPCHiddenService,
  readLndRestHiddenService,
  readLndGrpcHiddenService,
  readLndCert,
  readLndAdminMacaroon,
  readUmbrelVersionFile,
  readUpdateStatusFile,
  writeUpdateStatusFile,
  writeUpdateSignalFile,
  updateSignalFileExists,
  updateLockFileExists,
  readBackupStatusFile,
  readRemoteTorAccessStatusFile,
  readJWTPrivateKeyFile,
  readJWTPublicKeyFile,
  writeJWTPrivateKeyFile,
  writeJWTPublicKeyFile,
  shutdown,
  reboot,
  setRemoteTorAccess,
  readUtf8File,
  readJsonFile,
  writeMigrationStatusFile,
  readMigrationStatusFile,
  migration,
  enableSsh,
  readSshSignalFile,
  readDebugStatusFile,
  readRepoUpdateStatusFile,
  deleteRepoUpdateStatusFile,
  writeSignalFile,
  writeStatusFile,
  readHiddenService,
  memoryWarningStatusFileExists,
  deleteMemoryWarningStatusFile,
  readSystemStatusFile,
};
