const { createProxyMiddleware } = require("http-proxy-middleware");
const { StatusCodes } = require("http-status-codes");
const url = require("url");

const expressUtils = require("./express.js");
const authUtils = require("./auth.js");
const torUtils = require("./tor.js");
const CONSTANTS = require("./const.js");
const safeHandler = require("./safe_handler.js");

function stripUmbrelCookie(proxyReq, req) {
  const cookies = expressUtils.removeCookie(req, CONSTANTS.UMBREL_COOKIE_NAME);
  if (cookies.trim().length === 0) {
    // "the user agent sends a Cookie request header to the origin server if it has cookies"
    // More info: https://datatracker.ietf.org/doc/html/rfc2109#section-4.3.4
    proxyReq.removeHeader("cookie");
  } else {
    proxyReq.setHeader("cookie", cookies);
  }
}

function onProxyReq(proxyReq, req, res, config) {
  // "Value may be undefined if the socket is destroyed (for example, if the client disconnected)."
  // More details here: https://nodejs.org/api/net.html#socketremoteaddress
  if (req.socket.remoteAddress === undefined) {
    return res.end();
  }

  // If we don't trust the upstream, we'll set the x-forwarded headers
  // Upstream could be a proxy and therefore trusted
  // So we'll accept the incoming x-forwarded headers
  if (!CONSTANTS.PROXY_TRUST_UPSTREAM) {
    proxyReq.setHeader("x-forwarded-proto", req.protocol);
    proxyReq.setHeader("x-forwarded-host", req.headers.host);
    proxyReq.setHeader("x-forwarded-for", req.socket.remoteAddress);
  }

  // Remove Umbrel proxy token from proxied request
  stripUmbrelCookie(proxyReq, req);
}

function onProxyReqWs(proxyReq, req, socket, options, head) {
  stripUmbrelCookie(proxyReq, req);
}

function onError(err, req, res, target) {
  // ENOTFOUND = The proxy could not reach the target (check APP_HOST and APP_PORT)
  // ETIMEDOUT = The proxy could reach the target, but the target was too slow to respond (potentially PROXY_TIMEOUT is too low)

  console.error(`Proxy error: ${err.message}`);

  if (typeof res.status === "function") {
    res.status(StatusCodes.BAD_GATEWAY).render("pages/error", {
      app: CONSTANTS.APP,
      err,
    });
  }
}

function proxy() {
  const proxyTarget = `${CONSTANTS.APP_PROTOCOL}://${CONSTANTS.APP_HOST}:${CONSTANTS.APP_PORT}`;

  const proxyConfig = {
    onProxyReq: onProxyReq,
    onProxyReqWs: onProxyReqWs,
    onError: onError,
    target: proxyTarget,
    // Don't change the origin
    // Pass through the origin ('host' header) from the browser
    changeOrigin: false,
    // Add websocket support, but this option assumes that
    // an initial http request is made before the websocket connection
    ws: true,
    // If this is true, this will chain the x-forwarded header values
    // Many applications don't handle multiple header values (e.g. BTC Pay Server)
    xfwd: false,
    logLevel: CONSTANTS.LOG_LEVEL,
    proxyTimeout: CONSTANTS.PROXY_TIMEOUT,
    // The proxy shouldn't follow redirect
    // The browser should, therefore this must be off
    followRedirects: false,
  };

  return createProxyMiddleware(proxyConfig);
}

function apply(app) {
  const middleware = proxy();

  app.use(
    safeHandler(async (req, res, next) => {
      const authorized = await authUtils.isAuthorized({
        cookieHeader: req.headers.cookie,
        pathname: req.path,
      });

      if (!authorized) {
        const origin = req.hostname.endsWith(".onion") ? "tor" : "host";

        // Get the raw query string
        // This could be null if there is no query string
        let query = url.parse(req.url).query;
        if (typeof query == "string") {
          query = `?${query}`;
        } else {
          query = "";
        }

        const searchParams = new URLSearchParams({
          origin: origin,
          app: CONSTANTS.APP.id,
          path: `${req.path}${query}`,
        });

        // If request came over Tor
        // Then redirect to auth HS hosted on Tor
        if (origin === "tor") {
          const authHsUrl = await torUtils.authHsUrl();

          return res.redirect(
            `${req.protocol}://${authHsUrl}/?${searchParams.toString()}`
          );
        } else {
          return res.redirect(
            `${req.protocol}://${req.hostname}:${
              CONSTANTS.UMBREL_AUTH_PORT
            }/?${searchParams.toString()}`
          );
        }
      }

      middleware(req, res, next);
    })
  );

  return middleware;
}

module.exports = {
  proxy,
  apply,
};
