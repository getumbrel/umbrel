const url = require('url');

const hmacUtils = require('../utils/hmac.js');
const tokenUtils = require('../utils/token.js');
const expressUtils = require('../utils/express.js');
const appUtils = require("../utils/app.js");
const hostResolution = require('../utils/host_resolution.js');
const CONSTANTS = require('../utils/const.js');

const APP_PROXY_AUTH_TOKEN_PATH = "/umbrel_/api/v1/auth/token";

async function redirectState(token, req) {
	const app = expressUtils.getQueryParam(req, "app");
	const origin = expressUtils.getQueryParam(req, "origin");
	const path = expressUtils.getQueryParam(req, "path");

	// app ids are only allowed alpha-numeric characters
	// plus the hyphen (-)
	const appIdSanitised = appUtils.sanitiseId(app);

	// This builds up a url as to where
	// We're going to redirect/POST to
	const redirectUrl = url.format({
		protocol: req.protocol,
		host: await hostResolution.host(req, appIdSanitised, origin),
		pathname: APP_PROXY_AUTH_TOKEN_PATH
	});

	return {
		url: redirectUrl,
		params: {
			"r": path,
			"token": token,
			"signature": hmacUtils.sign(token, CONSTANTS.UMBREL_AUTH_SECRET)
		}
	};
}

async function redirect(res, token, req) {
	res.render("pages/redirect", await redirectState(token, req));
}

function mw () {
	return async function (req, res, next) {
		const token = req.signedCookies[CONSTANTS.UMBREL_COOKIE_NAME];

		// If we already have a valid token
		// Then the user doesn't need to login again
		// We can redirect to the app with the token
		if(await tokenUtils.validate(token)) {
			await redirect(res, token, req);
		} else {
			next();
		}
	};
}

module.exports = {
	mw,
	redirect,
	redirectState
};