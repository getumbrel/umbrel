/* eslint-disable no-unused-vars, no-magic-numbers */
const logger = require('utils/logger.js');
const LndError = require('models/errors.js').LndError;

function handleError(error, req, res, next) {

  var statusCode = error.statusCode || 500;
  var route = req.url || '';
  var message = error.message || '';

  logger.error(message, route, error.stack);

  res.status(statusCode).json(message);
}

module.exports = handleError;
