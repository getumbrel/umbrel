const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');

const CONSTANTS = require('../utils/const.js');

async function getTorHostname(app) {
	const torHostnameFile = path.join(CONSTANTS.TOR_PATH, `app-${app}`, "hostname");

	return (await fs.readFile(torHostnameFile, "utf-8")).trim();
}

async function getAppPort(app) {
	const appManifestFile = path.join(CONSTANTS.APP_DATA_PATH, app, 'umbrel-app.yml');
	const appManifestYaml = await fs.readFile(appManifestFile, "utf-8");
	const appManifest = yaml.load(appManifestYaml, 'utf8');

	return appManifest.port;
}

async function host(req, app, origin) {
	try {
		switch(origin) {
			case "tor":
				return (await getTorHostname(app));
			case "host":
				const appPort = (await getAppPort(app));

				return `${req.hostname}:${appPort}`;
		}
	} catch (e) {
		throw new Error("Failed to determine host");
	}

	throw new Error("Unsupported origin");
}

module.exports = {
	host
};