/* eslint-disable id-length */

function readFromEnvOrTerminate(key) {
	const value = process.env[key];

	if(typeof(value) !== "string" || value.trim().length === 0) {
		console.error(`The env. variable '${key}' is not set. Terminating...`);

		process.exit(0);
	}

	return value;
}

const DEFAULT_UMBREL_APP_REPO_URL = 'https://github.com/getumbrel/umbrel-apps.git';

module.exports = {
  REQUEST_CORRELATION_NAMESPACE_KEY: 'umbrel-manager-request',
  REQUEST_CORRELATION_ID_KEY: 'reqId',
  DEVICE_HOSTNAME: process.env.DEVICE_HOSTNAME || 'umbrel.local',
  USER_FILE: process.env.USER_FILE || '/db/user.json',
  SIGNAL_DIR: process.env.SIGNAL_DIR || '/signals',
  STATUS_DIR: process.env.STATUS_DIR || '/statuses',
  APP_DATA_DIR: process.env.APP_DATA_DIR || '/app-data',
  REPOS_DIR: process.env.REPOS_DIR || '/repos',
  SESSIONS_DIR: process.env.SESSIONS_DIR || '/db/sessions',
  TOR_HIDDEN_SERVICE_DIR: process.env.TOR_HIDDEN_SERVICE_DIR || '/var/lib/tor',
  SHUTDOWN_SIGNAL_FILE: process.env.SHUTDOWN_SIGNAL_FILE || '/signals/shutdown',
  REBOOT_SIGNAL_FILE: process.env.REBOOT_SIGNAL_FILE || '/signals/reboot',
  REMOTE_TOR_ACCESS_SIGNAL_FILE: process.env.REMOTE_TOR_ACCESS_SIGNAL_FILE || '/signals/remote-tor-access',
  JWT_PUBLIC_KEY_FILE: process.env.JWT_PUBLIC_KEY_FILE || '/db/jwt-public-key/jwt.pem',
  JWT_PRIVATE_KEY_FILE: process.env.JWT_PRIVATE_KEY_FILE || '/db/jwt-private-key/jwt.key',
  UMBREL_SEED_FILE: process.env.UMBREL_SEED_FILE || '/db/umbrel-seed/seed',
  UMBREL_DASHBOARD_HIDDEN_SERVICE_FILE: process.env.UMBREL_DASHBOARD_HIDDEN_SERVICE_FILE || '/var/lib/tor/web/hostname',
  ELECTRUM_HIDDEN_SERVICE_FILE: process.env.ELECTRUM_HIDDEN_SERVICE_FILE || '/var/lib/tor/electrum/hostname',
  ELECTRUM_PORT: process.env.ELECTRUM_PORT || 50001,
  BITCOIN_P2P_HIDDEN_SERVICE_FILE: process.env.BITCOIN_P2P_HIDDEN_SERVICE_FILE || '/var/lib/tor/bitcoin-p2p/hostname',
  BITCOIN_P2P_PORT: process.env.BITCOIN_P2P_PORT || 8333,
  BITCOIN_RPC_HIDDEN_SERVICE_FILE: process.env.BITCOIN_RPC_HIDDEN_SERVICE_FILE || '/var/lib/tor/bitcoin-rpc/hostname',
  BITCOIN_RPC_PORT: process.env.BITCOIN_RPC_PORT || 8332,
  BITCOIN_RPC_USER: process.env.BITCOIN_RPC_USER || 'umbrel',
  BITCOIN_RPC_PASSWORD: process.env.BITCOIN_RPC_PASSWORD || 'moneyprintergobrrr',
  LND_REST_HIDDEN_SERVICE_FILE: process.env.LND_REST_HIDDEN_SERVICE_FILE || '/var/lib/tor/lnd-rest/hostname',
  LND_GRPC_HIDDEN_SERVICE_FILE: process.env.LND_GRPC_HIDDEN_SERVICE_FILE || '/var/lib/tor/lnd-grpc/hostname',
  LND_CERT_FILE: process.env.LND_CERT_FILE || '/lnd/tls.cert',
  LND_ADMIN_MACAROON_FILE: process.env.LND_ADMIN_MACAROON_FILE || '/lnd/data/chain/bitcoin/mainnet/admin.macaroon',
  LND_WALLET_PASSWORD: process.env.LND_WALLET_PASSWORD || 'moneyprintergobrrr',
  GITHUB_REPO: process.env.GITHUB_REPO || 'getumbrel/umbrel',
  UMBREL_VERSION_FILE: process.env.UMBREL_VERSION_FILE || '/info.json',
  UPDATE_STATUS_FILE: process.env.UPDATE_STATUS_FILE || '/statuses/update-status.json',
  UPDATE_SIGNAL_FILE: process.env.UPDATE_SIGNAL_FILE || '/signals/update',
  UPDATE_LOCK_FILE: process.env.UPDATE_LOCK_FILE || '/statuses/update-in-progress',
  BACKUP_STATUS_FILE: process.env.BACKUP_STATUS_FILE || '/statuses/backup-status.json',
  REMOTE_TOR_ACCESS_STATUS_FILE: process.env.REMOTE_TOR_ACCESS_STATUS_FILE || '/statuses/remote-tor-access-status.json',
  DEBUG_STATUS_FILE: process.env.DEBUG_STATUS_FILE || "/statuses/debug-status.json",
  REPO_UPDATE_STATUS_FILE: process.env.REPO_UPDATE_STATUS_FILE || "/statuses/repo-update-status.json",
  TOR_PROXY_IP: process.env.TOR_PROXY_IP || '192.168.0.1',
  TOR_PROXY_PORT: process.env.TOR_PROXY_PORT || 9050,
  IS_UMBREL_OS: process.env.IS_UMBREL_OS === 'true',
  UMBREL_COOKIE_NAME: "UMBREL_SESSION",
  UMBREL_AUTH_SECRET: readFromEnvOrTerminate("UMBREL_AUTH_SECRET"),
  UMBREL_APP_REPO_URL: process.env.UMBREL_APP_REPO_URL || DEFAULT_UMBREL_APP_REPO_URL,
  UMBREL_APP_STORE_REPO: {
    id: "umbrel",
    name: "Umbrel",
    url: process.env.UMBREL_APP_REPO_URL || DEFAULT_UMBREL_APP_REPO_URL
  },
  UMBREL_GALLERY_ASSETS_BASE_URL: process.env.UMBREL_GALLERY_ASSETS_BASE_URL || 'https://getumbrel.github.io/umbrel-apps-gallery',
  STATUS_CODES: {
    ACCEPTED: 202,
    BAD_GATEWAY: 502,
    CONFLICT: 409,
    FORBIDDEN: 403,
    OK: 200,
    UNAUTHORIZED: 401
  },
  TIME: {
    FIVE_MINUTES_IN_MILLIS: 5 * 60 * 1000,
    ONE_DAY_IN_MILLIS: 24 * 60 * 60 * 1000,
    ONE_SECOND_IN_MILLIS: 1000,
    ONE_HOUR_IN_MILLIS: 60 * 60 * 1000,
    NINETY_MINUTES_IN_MILLIS: 90 * 60 * 1000,
    HOURS_IN_TWO_DAYS: 47,
  }
};
