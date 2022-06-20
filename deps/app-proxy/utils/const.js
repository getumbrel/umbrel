const yaml = require('js-yaml');
const fs   = require('fs');

const APP_MANIFEST_FILE = process.env.APP_MANIFEST_FILE || "/extra/umbrel-app.yml";
const CUSTOM_DOTENV_FILE = process.env.CUSTOM_DOTENV_FILE || "/data/.env.app_proxy";

if(fs.existsSync(CUSTOM_DOTENV_FILE)) {
	require('dotenv').config({
		path: CUSTOM_DOTENV_FILE,
		override: true
	});
}

function readUmbrelAppManifest() {
	try {
		return yaml.load(fs.readFileSync(APP_MANIFEST_FILE, 'utf8'));
	} catch (e) {
		console.error("Failed to open app manifest file", e);

		process.exit(0);
	}
}

function readFromEnvOrTerminate(key) {
	const value = process.env[key];

	if(typeof(value) !== "string" || value.trim().length === 0) {
		console.error(`The env. variable '${key}' is not set. Terminating...`);

		process.exit(0);
	}

	return value;
}

function cleanHttpPaths(str) {
	return str.split(/[, ]+/)
		.map(path => path.trim())
		.filter(path => path.length > 0);
}

module.exports = Object.freeze({
	UMBREL_COOKIE_NAME: "UMBREL_SESSION",

	LOG_LEVEL: process.env.LOG_LEVEL || "info",

	PROXY_PORT: parseInt(process.env.PROXY_PORT) || 4000,
	PROXY_TIMEOUT: parseInt(process.env.PROXY_TIMEOUT) || 0, // milliseconds or 0 for disabled
	PROXY_AUTH_ADD: (typeof(process.env.PROXY_AUTH_ADD) === "string") ? (process.env.PROXY_AUTH_ADD === "true") : true,
	PROXY_AUTH_WHITELIST: cleanHttpPaths(process.env.PROXY_AUTH_WHITELIST || ""),
	PROXY_AUTH_BLACKLIST: cleanHttpPaths(process.env.PROXY_AUTH_BLACKLIST || ""),

	APP: readUmbrelAppManifest(),
	APP_PROTOCOL: process.env.APP_PROTOCOL || "http",
	APP_HOST: readFromEnvOrTerminate("APP_HOST"),
	APP_PORT: parseInt(readFromEnvOrTerminate("APP_PORT")),

	UMBREL_AUTH_HIDDEN_SERVICE_FILE: process.env.UMBREL_AUTH_HIDDEN_SERVICE_FILE || "/var/lib/tor/auth/hostname",

	UMBREL_AUTH_SECRET: readFromEnvOrTerminate("UMBREL_AUTH_SECRET"),
	UMBREL_AUTH_PORT: parseInt(process.env.UMBREL_AUTH_PORT) || 2000,

	MANAGER_IP: readFromEnvOrTerminate("MANAGER_IP"),
	MANAGER_PORT: parseInt(process.env.MANAGER_PORT) || 3006,
});