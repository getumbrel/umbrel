function readFromEnvOrTerminate(key) {
	const value = process.env[key];

	if(typeof(value) !== "string" || value.trim().length === 0) {
		console.error(`The env. variable '${key}' is not set. Terminating...`);

		process.exit(0);
	}

	return value;
}

module.exports = Object.freeze({
	UMBREL_COOKIE_NAME: "UMBREL_SESSION",

	LOG_LEVEL: process.env.LOG_LEVEL || "info",

	PORT: parseInt(process.env.PORT) || 2000,

	UMBREL_AUTH_SECRET: readFromEnvOrTerminate("UMBREL_AUTH_SECRET"),

	TOR_PATH: process.env.TOR_PATH || "/var/lib/tor",
	APP_DATA_PATH: process.env.APP_DATA_PATH || "/app-data",

	MANAGER_IP: readFromEnvOrTerminate("MANAGER_IP"),
	MANAGER_PORT: parseInt(readFromEnvOrTerminate("MANAGER_PORT")),

	DASHBOARD_IP: readFromEnvOrTerminate("DASHBOARD_IP"),
	DASHBOARD_PORT: parseInt(readFromEnvOrTerminate("DASHBOARD_PORT")),
});