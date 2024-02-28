function handleError(error, req, res, next) {
  var statusCode = error.statusCode || 500;
  var route = req.url || '';
  var message = error.message || '';

  res.status(statusCode).json(message);
}

module.exports = handleError;
