const tokenUtils = require("./token.js");
const CONSTANTS = require("./const.js");

function parseCookieHeader(header) {
  const out = {};
  if (!header) return out;
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value;
    }
  }
  return out;
}

function normalisePath(pathname) {
  let path = typeof pathname === "string" && pathname.length > 0 ? pathname : "/";
  path = path.split("?")[0] || "/";
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path;
}

function normaliseRule(rule) {
  let path = typeof rule === "string" ? rule.trim() : "";
  if (path === "" || path === "*" || path === "/*") return path;
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path;
}

// Bare paths match only that path. Use "/path/*" to match child paths, or
// "/path*" for an explicit prefix match.
function pathMatches(pathname, paths) {
  const requestPath = normalisePath(pathname);

  return paths.some((rule) => {
    const path = normaliseRule(rule);
    if (!path) return false;
    if (path === "/") return requestPath === "/";
    if (path === "*") return true;

    if (path.endsWith("/*")) {
      const basePath = normaliseRule(path.slice(0, -2));
      if (!basePath || basePath === "/") return true;
      return requestPath.startsWith(`${basePath}/`);
    }

    if (path.endsWith("*")) {
      const basePath = normaliseRule(path.slice(0, -1));
      if (!basePath || basePath === "/") return true;
      return requestPath.startsWith(basePath);
    }

    return requestPath === path;
  });
}

async function isAuthorized({ cookieHeader, pathname }) {
  if (!CONSTANTS.PROXY_AUTH_ADD) return true;

  const whitelisted = pathMatches(pathname, CONSTANTS.PROXY_AUTH_WHITELIST);
  const blacklisted = pathMatches(pathname, CONSTANTS.PROXY_AUTH_BLACKLIST);
  // Blacklist wins over whitelist (matches previous middleware ordering).
  if (whitelisted && !blacklisted) return true;

  const cookies = parseCookieHeader(cookieHeader);
  const token = cookies.UMBREL_PROXY_TOKEN;
  if (typeof token !== "string") return false;

  try {
    return await tokenUtils.validate(token);
  } catch {
    return false;
  }
}

module.exports = {
  isAuthorized,
  parseCookieHeader,
  pathMatches,
};
