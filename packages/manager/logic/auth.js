const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { CipherSeed } = require('aezeed');
const iocane = require("iocane");
const diskLogic = require('logic/disk.js');
const appsLogic = require('logic/apps.js');
const reposLogic = require('logic/repos.js');
const diskService = require('services/disk.js');
const lndApiService = require('services/lndApi.js');
const bashService = require('services/bash.js');
const NodeError = require('models/errors.js').NodeError;
const JWTHelper = require('utils/jwt.js');
const constants = require('utils/const.js');
const UUID = require('utils/UUID.js');

const saltRounds = 10;
const SYSTEM_USER = UUID.fetchBootUUID() || 'admin';

let devicePassword = '';
let changePasswordStatus;

resetChangePasswordStatus();

function resetChangePasswordStatus() {
    changePasswordStatus = { percent: 0 };
}

async function sleepSeconds(seconds) {
    return new Promise(resolve => {
        setTimeout(resolve, seconds * constants.TIME.ONE_SECOND_IN_MILLIS);
    });
}

// Caches the password.
function cachePassword(password) {
    devicePassword = password;
}

// Gets the cached the password.
function getCachedPassword() {
    return devicePassword;
}

// Sets system password
const setSystemPassword = async password => {
  await diskLogic.writeStatusFile('password', password);
  await diskLogic.writeSignalFile('change-password');
}

// Change the dashboard and system password.
async function changePassword(currentPassword, newPassword, jwt) {
    resetChangePasswordStatus();
    changePasswordStatus.percent = 1; // eslint-disable-line no-magic-numbers

    try {
      // update user file
      const user = await diskLogic.readUserFile();
      const credentials = hashCredentials(SYSTEM_USER, newPassword);

      // re-encrypt seed with new password
      const decryptedSeed = await iocane.createSession().decrypt(user.seed, currentPassword);
      const encryptedSeed = await iocane.createSession().encrypt(decryptedSeed, newPassword);

      // update user file
      await diskLogic.writeUserFile({ ...user, password: credentials.password, seed: encryptedSeed });

      // update system password
      await setSystemPassword(newPassword);

      changePasswordStatus.percent = 100;
      complete = true;

      // cache the password for later use
      cachePassword(newPassword);
    } catch (error) {
      changePasswordStatus.percent = 100;
      changePasswordStatus.error = true;

      throw new Error('Unable to change password');
    }
}

function getChangePasswordStatus() {
    return changePasswordStatus;
}

// Returns an object with the hashed credentials inside.
function hashCredentials(username, password) {
    const hash = bcrypt.hashSync(password, saltRounds);

    return { password: hash, username, plainTextPassword: password };
}

// Returns true if the user is registered otherwise false.
async function isRegistered() {
    try {
        await diskLogic.readUserFile();

        return { registered: true };
    } catch (error) {
        return { registered: false };
    }
}

// Derives the root umbrel seed and persists it to disk to be used for
// determinstically deriving further entropy for any other Umbrel service.
async function deriveUmbrelSeed(user) {
  if (await diskLogic.umbrelSeedFileExists()) {
    return;
  }
  const mnemonic = (await seed(user)).seed.join(' ');
  const {entropy} = CipherSeed.fromMnemonic(mnemonic);
  const umbrelSeed = crypto
    .createHmac('sha256', entropy)
    .update('umbrel-seed')
    .digest('hex');
  return diskLogic.writeUmbrelSeedFile(umbrelSeed);
}

// Sets the LND password to a hardcoded password if it's locked so we can
// auto unlock it in future
async function removeLndPasswordIfLocked(currentPassword, jwt) {
  const lndStatus = await lndApiService.getStatus();

  if (!lndStatus.data.unlocked) {
    console.log('LND is locked on login, attempting to change password...');
    try {
      await lndApiService.changePassword(currentPassword, constants.LND_WALLET_PASSWORD, jwt);
      console.log('Sucessfully changed LND password!');
    } catch (e) {
      console.log('Failed to change LND password!');
    }
  }
}

// Migrates the internal LND seed over to the new Lightning app
async function migrateExistingLndSeedToApp(user) {
    try {
        // Check if seed should be migrated
        console.log('[LND Seed Migration] Checking if seed should be migrated...');
        const stateFilePath = path.join(constants.APP_DATA_DIR, 'lightning/data/lightning/state.json');
        let state;
        try {
            state = await diskService.readJsonFile(stateFilePath);
        } catch {
            console.log('[LND Seed Migration] Lightning app not installed, skipping migration.');
            return;
        }
        if(state.seedMigrated !== false) {
            console.log('[LND Seed Migration] Seed doesn\'t need to be migrated.');
            return;
        }
        if(state.seed.length !== 0) {
            console.log('[LND Seed Migration] Error: Refusing to migrate, seed already exists!');
            return;
        }

        console.log('[LND Seed Migration] Attempting to migrate LND seed...');

        // Decrypt local seed
        console.log('[LND Seed Migration] Decrypting seed...');
        const decryptedSeed = await seed(user);

        // Update state
        console.log('[LND Seed Migration] Updating state...');
        const updatedState = {
            ...state,
            seed: decryptedSeed.seed,
            seedMigrated: true,
        };
        await diskService.writeJsonFile(stateFilePath, updatedState);
        console.log('[LND Seed Migration] Sucessfully migrated!');
    } catch (error) {
        console.log(`[LND Seed Migration] Error: "${error.message}"`);
    }
}


// Log the user into the device. Caches the password if login is successful. Then returns jwt.
async function login(user) {
    try {
        const jwt = await JWTHelper.generateJWT(user.username);

        // Cache plain text password
        // cachePassword(user.plainTextPassword);
        cachePassword(user.password);

        deriveUmbrelSeed(user)

        // This is only needed temporarily to update hardcoded passwords
        // on existing users without requiring them to change their password
        setSystemPassword(user.password);

        // This is only needed temporarily to remove the user set LND wallet
        // password for old users and change it to a hardcoded one so we can
        // auto unlock it in the future.
        removeLndPasswordIfLocked(user.password, jwt);

        // This is only needed temporarily to migrate the LND seed encrypted in
        // old users user.json file to a plain text version in the Lightning app
        migrateExistingLndSeedToApp(user);

        return { jwt: jwt };

    } catch (error) {
        throw new NodeError('Unable to generate JWT');
    }
}

async function getInfo() {
    try {
        const user = await diskLogic.readUserFile();

        // Append array of repo objects
        user.communityAppRepos = (await reposLogic.all(user)).filter(repo => {
            return repo.id !== constants.UMBREL_APP_STORE_REPO.id;
        });

        // Remove sensitive info
        delete user.password;
        delete user.seed;
        user.otpEnabled = Boolean(user.otpUri);
        delete user.otpUri;

        // Remove other internal properties
        delete user.repos;
        delete user.appOrigin;
        delete user.installedApps;

        return user;
    } catch (error) {
        console.error(error);

        throw new NodeError('Unable to get account info');
    }
};

async function seed(user) {

    //Decrypt mnemonic seed
    try {
        const { seed } = await diskLogic.readUserFile();

        const decryptedSeed = await iocane.createSession().decrypt(seed, user.plainTextPassword);

        return { seed: decryptedSeed.split(",") };

    } catch (error) {
        throw new NodeError('Unable to decrypt mnemonic seed');
    }
}

// Registers the the user to the device. Returns an error if a user already exists.
async function register(user) {
    if ((await isRegistered()).registered) {
        throw new NodeError('User already exists', 400); // eslint-disable-line no-magic-numbers
    }

    // Just create a fake seed for now so we don't require one from the user
    // and all existing logic that expects a seed will continue to work.
    const seed = CipherSeed.random().toMnemonic().split(' ');

    //Encrypt mnemonic seed for storage
    let encryptedSeed;
    try {
        encryptedSeed = await iocane.createSession().encrypt(seed.join(), user.plainTextPassword);
    } catch (error) {
        throw new NodeError('Unable to encrypt mnemonic seed');
    }

    //save user
    try {
        await diskLogic.writeUserFile({
            name: user.name,
            password: user.password,
            // To aid in debugging since we know if this prop is set
            // the seed is not important
            unusedSeed: true,
            seed: encryptedSeed,
            repos: [ constants.UMBREL_APP_REPO_URL ],
            // By default, remote access via Tor is disabled
            remoteTorAccess: false
        });
    } catch (error) {
        throw new NodeError('Unable to register user');
    }

    //update system password
    try {
        await setSystemPassword(user.plainTextPassword);
    } catch (error) {
        throw new NodeError('Unable to set system password');
    }

    //derive Umbrel seed
    try {
        await deriveUmbrelSeed(user);
    } catch (error) {
        throw new NodeError('Unable to create Umbrel seed');
    }

    //generate JWt
    let jwt;
    try {
        jwt = await JWTHelper.generateJWT(user.username);
    } catch (error) {
        await diskLogic.deleteUserFile();
        throw new NodeError('Unable to generate JWT');
    }

    //return token
    return { jwt: jwt };
}

// Generate and return a new jwt token.
async function refresh(user) {
    try {
        const jwt = await JWTHelper.generateJWT(user.username);

        return { jwt: jwt };
    } catch (error) {
        throw new NodeError('Unable to generate JWT');
    }
}


module.exports = {
    changePassword,
    getCachedPassword,
    getChangePasswordStatus,
    hashCredentials,
    isRegistered,
    getInfo,
    seed,
    login,
    register,
    refresh,
};
