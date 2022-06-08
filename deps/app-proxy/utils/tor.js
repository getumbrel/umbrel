const fs = require('fs').promises;

const CONSTANTS = require('../utils/const.js');

async function authHsUrl() {
	// Here is technically a race condition
	// As the auth hs url may not yet be generated
	try {
		return (await fs.readFile(CONSTANTS.UMBREL_AUTH_HIDDEN_SERVICE_FILE, "utf-8")).trim();
	} catch(e) {
		return "not-yet-generated.onion";
	}
}

module.exports = {
	authHsUrl
};