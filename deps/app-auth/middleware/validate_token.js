const url = require('url');

const hmacUtils = require('../utils/hmac.js');
const tokenUtils = require('../utils/token.js');
const hostResolution = require('../utils/host_resolution.js');
const CONSTANTS = require('../utils/const.js');

const APP_PROXY_AUTH_TOKEN_PATH = "/umbrel_/api/v1/auth/token";

function getQueryParam(req, key) {
	const value = req.query[key];

	if(typeof(value) !== "string" || value.trim().length == 0) {
		throw new Error(`'${key}' is missing`);
	}

	return value;
}

async function redirectState(token, req) {
	const app = getQueryParam(req, "app");
	const origin = getQueryParam(req, "origin");
	const path = getQueryParam(req, "path");

	// app ids are only allowed alpha-numeric characters
	// plus the hyphen (-)
	const appSanitised = app.replace(/[^a-zA-Z0-9-]/gm, "");

	// This builds up a url as to where
	// We're going to redirect/POST to
	const redirectUrl = url.format({
		protocol: req.protocol,
		host: await hostResolution.host(req, appSanitised, origin),
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