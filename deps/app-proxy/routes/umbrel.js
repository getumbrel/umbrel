const { StatusCodes } = require('http-status-codes');
const bodyParser = require('body-parser');
const express = require('express');
const validator = require('express-validator');

const router = express.Router();

const CONSTANTS = require('../utils/const.js');
const tokenUtils = require('../utils/token.js');
const hmacUtils = require('../utils/hmac.js');
const safeHandler = require("../utils/safe_handler.js");

const parseForm = bodyParser.urlencoded({ extended: false });

router.use(parseForm);

router.post("/api/v1/auth/token", [
	validator.body('token').isString(),
	validator.body('signature').isString(),
	validator.body('r').isString()
], safeHandler(async (req, res) => {
	const errors = validator.validationResult(req);
    if (! errors.isEmpty()) {
		return res.status(StatusCodes.BAD_REQUEST).json({
			errors: errors.array()
		});
    }

	const token = req.body.token;
	const signature = req.body.signature;
	const redirectTo = req.body.r;

	// Before we validate the token, lets check the hmac
	if(! hmacUtils.verify(token, CONSTANTS.UMBREL_AUTH_SECRET, signature)) {
		return res.status(StatusCodes.INTERNAL_SERVER_ERROR).send(`The signature is invalid`);
	}

	// Check that the token is valid before setting cookie...
	if(! await tokenUtils.validate(token)) {
		return res.status(StatusCodes.INTERNAL_SERVER_ERROR).send(`The token is invalid`);
	}

	res.cookie(CONSTANTS.UMBREL_COOKIE_NAME, token, {
		httpOnly: true,
		signed: true,
		sameSite: "lax"
	});

	res.redirect(redirectTo);
}));

module.exports = router;