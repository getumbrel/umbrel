const { createProxyMiddleware } = require('http-proxy-middleware');
const { StatusCodes } = require('http-status-codes');
const url = require('url');

const expressUtils = require('../utils/express.js');
const tokenUtils = require('../utils/token.js');
const torUtils = require('../utils/tor.js');
const CONSTANTS = require('../utils/const.js');
const safeHandler = require("../utils/safe_handler.js");

function onProxyReq(proxyReq, req, res, config) {
	// Remove umbrel session cookie from proxied request
	const cookies = expressUtils.removeCookie(req, CONSTANTS.UMBREL_COOKIE_NAME);
	if(cookies.trim().length === 0) {
		// "the user agent sends a Cookie request header to the origin server if it has cookies"
		// More info: https://datatracker.ietf.org/doc/html/rfc2109#section-4.3.4
		proxyReq.removeHeader('cookie');
	} else {
		proxyReq.setHeader('cookie', cookies);
	}	
}

function onError(err, req, res, target) {
	// ENOTFOUND = The proxy could not reach the target (check APP_HOST and APP_PORT)
	// ETIMEDOUT = The proxy could reach the target, but the target was too slow to respond (potentially PROXY_TIMEOUT is too low)

	res.status(StatusCodes.BAD_GATEWAY).render('pages/error', {
		app: CONSTANTS.APP,
		err
	});
}

function proxy() {
	const proxyTarget = `${CONSTANTS.APP_PROTOCOL}://${CONSTANTS.APP_HOST}:${CONSTANTS.APP_PORT}`;

	const proxyConfig = {
		onProxyReq: onProxyReq,
		onError: onError,
		target: proxyTarget,
		// Don't change the origin
		// Pass through the origin ('host' header) from the browser
		changeOrigin: false,
		// Add websocket support, but this option assumes that 
		// an initial http request is made before the websocket connection
		ws: true,
		// Add x-forward headers (e.g. X-Forwarded-For)
		xfwd: true,
		logLevel: CONSTANTS.LOG_LEVEL,
		proxyTimeout: CONSTANTS.PROXY_TIMEOUT,
		// The proxy shouldn't follow redirect
		// The browser should, therefore this must be off
		followRedirects: false
	};

	return createProxyMiddleware(proxyConfig);
}

function whitelist() {
	return function (req, res, next){
		req.ignoreAuth = true;

		next();
	};
}

function blacklist() {
	return function (req, res, next){
		req.ignoreAuth = false;

		next();
	};
}

function apply(app) {
	if(CONSTANTS.PROXY_AUTH_ADD) {
		if(CONSTANTS.PROXY_AUTH_WHITELIST.length > 0) app.use(CONSTANTS.PROXY_AUTH_WHITELIST, whitelist());
		if(CONSTANTS.PROXY_AUTH_BLACKLIST.length > 0) app.use(CONSTANTS.PROXY_AUTH_BLACKLIST, blacklist());
	}

	const middleware = proxy();

	app.use(safeHandler(async (req, res, next) => {
		// If route is part of the auth whitelist
		// Then we ignore handling auth
		if(CONSTANTS.PROXY_AUTH_ADD && req.ignoreAuth !== true) {
			const token = req.signedCookies[CONSTANTS.UMBREL_COOKIE_NAME];

			// token could be false if hmac fails (ie. someone tampered with the token)
			if(typeof(token) !== "string" || ! await tokenUtils.validate(token)) {
				const origin = req.hostname.endsWith(".onion") ? "tor" : "host";

				// Get the raw query string
				// This could be null if there is no query string
				let query = url.parse(req.url).query;
				if(typeof(query) == "string") {
					query = `?${query}`
				} else {
					query = '';
				}

				const searchParams = new URLSearchParams({
					origin: origin,
					app: CONSTANTS.APP.id,
					path: `${req.path}${query}`
				});

				// If request came over Tor
				// Then redirect to auth HS hosted on Tor
				if(origin === "tor") {
					const authHsUrl = await torUtils.authHsUrl();
					
					return res.redirect(`${req.protocol}://${authHsUrl}/?${searchParams.toString()}`);
				} else {
					return res.redirect(`${req.protocol}://${req.hostname}:${CONSTANTS.UMBREL_AUTH_PORT}/?${searchParams.toString()}`);
				}	
			}
		}
		
		middleware(req, res, next);
	}));

	return middleware;
}

module.exports = {
	proxy,
	whitelist,
	blacklist,
	apply
}