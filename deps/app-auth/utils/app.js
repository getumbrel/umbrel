const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');

const CONSTANTS = require('../utils/const.js');

async function getBasicInfo(app){
	try {
		const manifestFile = path.join(CONSTANTS.APP_DATA_PATH, app, 'umbrel-app.yml');
		const manifestYaml = await fs.readFile(manifestFile, "utf-8");
		const manifest = yaml.load(manifestYaml, 'utf8');

		return {
			id: manifest.id,
			name: manifest.name
		};
	} catch(e) {
		throw new Error("App not found");
	}
}

// App IDs are only allowed
// Alpha-numeric characters with hyphens
function sanitiseId(appId){
	return appId.replace(/[^a-zA-Z0-9-]/g, "");
}

module.exports = {
	getBasicInfo,
	sanitiseId
};