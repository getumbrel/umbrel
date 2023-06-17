// this safe handler is used to wrap our api methods
// so that we always fallback and return an exception if there is an error
// inside of an async function
// Mostly copied from vault/server/utils/safeHandler.js
function safeHandler(handler) {
  return async (req, res, next) => {
    try {
      return await handler(req, res, next);
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = safeHandler;
