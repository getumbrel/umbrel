/* eslint-disable no-unused-vars, no-magic-numbers */
const constants = require('utils/const.js');
const NodeError = require('models/errors.js').NodeError;

function handleError(error, req, res, next) {

  // If incorrect auth was given, respond with 403 instead of 401.
  // Reasoning: sending 401 on a request such as when the user tries to 
  // change password with an incorrect password or enters an incorrect
  // password to view seed will log him out due to interceptor on front-end
  const invalidAuthErrors = ['Incorrect password', 'Missing OTP token', 'Invalid OTP token'];
  if (invalidAuthErrors.includes(error.message)) {

    return next(new NodeError(error.message, 403));
  } else {

    return next(error);
  }

}

module.exports = handleError;
