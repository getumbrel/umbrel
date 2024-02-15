const jwt = require("jsonwebtoken");

const JWT_ALGORITHM = "HS256";

const secret = process.env.JWT_SECRET;

function validate(token) {
  if (typeof token !== "string") return false;

  console.log(`Validating token: ${token.substr(0, 12)} ...`);

  const payload = jwt.verify(token, secret, {
    algorithms: [JWT_ALGORITHM],
  });

  return payload.proxyToken === true;
}

module.exports = {
  validate,
};
