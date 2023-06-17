const camelizeKeys = require('camelize-keys');

function camelCaseRequest(req, res, next) {
  if (req && req.body) {
    req.body = camelizeKeys(req.body, '_');
  }
  next();
}

module.exports = {
  camelCaseRequest,
};
