require('module-alias/register');
require('module-alias').addPath('.');
require('dotenv').config();

const express = require('express');
const path = require('path');
const morgan = require('morgan');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const passport = require('passport');

// Keep requestCorrelationId middleware as the first middleware. Otherwise we risk losing logs.
const requestCorrelationMiddleware = require('middlewares/requestCorrelationId.js'); // eslint-disable-line id-length
const camelCaseReqMiddleware = require('middlewares/camelCaseRequest.js').camelCaseRequest;
const errorHandleMiddleware = require('middlewares/errorHandling.js');
require('middlewares/auth.js');

const logger = require('utils/logger.js');

const ping = require('routes/ping.js');
const account = require('routes/v1/account.js');
const system = require('routes/v1/system.js');
const external = require('routes/v1/external.js');
const apps = require('routes/v1/apps.js');
const communityAppStores = require('routes/v1/community-app-stores.js');
const constants = require('utils/const.js');

const app = express();

// Define custom response method for setting
// the Umbrel auth/session cookie
app.response.umbrelSessionCookie = function (token) {
  return this.cookie(constants.UMBREL_COOKIE_NAME, token, {
    httpOnly: true,
    signed: true,
    sameSite: "lax"
  });
};

app.use(cookieParser(constants.UMBREL_AUTH_SECRET));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(passport.initialize());
app.use(passport.session());

app.use(requestCorrelationMiddleware);
app.use(camelCaseReqMiddleware);
app.use(morgan(logger.morganConfiguration));

app.use('/ping', ping);
app.use('/v1/account', account);
app.use('/v1/system', system);
app.use('/v1/external', external);
app.use('/v1/apps', apps);
app.use('/v1/community-app-stores', communityAppStores);

app.use(errorHandleMiddleware);
app.use((req, res) => {
  res.status(404).json(); // eslint-disable-line no-magic-numbers
});

module.exports = app;
