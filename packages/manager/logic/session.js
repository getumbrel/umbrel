const fs = require('fs').promises;
const crypto = require('crypto');
const path = require('path');
const NodeError = require('../models/errors.js').NodeError;

const constants = require('utils/const.js');


// Create sessions dir if it doesn't exist on startup
fs.stat(constants.SESSIONS_DIR).catch(() => fs.mkdir(constants.SESSIONS_DIR));

function getFullPath(token) {
	const sessionFilename = `${token}.session`;

	return path.join(constants.SESSIONS_DIR, sessionFilename);
}

async function isValid(token) {
	const tokenSanitised = token.replace(/[^a-zA-Z0-9-]/gm, "");

	try {
		await fs.access(getFullPath(tokenSanitised));

		return true;
	} catch (e) {
		return false;
	}
}

async function create() {
	try {
		const token = crypto.randomBytes(32).toString('hex');

		await fs.writeFile(getFullPath(token), "", 'utf8');

		return token;
	} catch (error) {
        throw new NodeError('Unable to generate token');
    }
}

async function deleteAll() {
	try {
		// Delete all tokens in the session directory
		// Only delete files with ext .session
		const files = await fs.readdir(constants.SESSIONS_DIR);
		for (const file of files) {
			if(file.endsWith(".session")) {
				await fs.unlink(path.join(constants.SESSIONS_DIR, file));
			}
		}
	} catch (error) {
        throw new NodeError('Unable to delete tokens');
    }
}

module.exports = {
    isValid,
    create,
    deleteAll
};