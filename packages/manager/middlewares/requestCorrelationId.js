const UUID = require('utils/UUID.js');
const constants = require('utils/const.js');
const createNamespace = require('continuation-local-storage').createNamespace;
const apiRequest = createNamespace(constants.REQUEST_CORRELATION_NAMESPACE_KEY);

function addCorrelationId(req, res, next) {
  apiRequest.bindEmitter(req);
  apiRequest.bindEmitter(res);
  apiRequest.run(function () {
    apiRequest.set(constants.REQUEST_CORRELATION_ID_KEY, UUID.create());
    next();
  });
}

module.exports = addCorrelationId;
