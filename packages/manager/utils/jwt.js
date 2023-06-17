const jwt = require('jsonwebtoken');
const diskLogic = require('logic/disk.js');

// Environmental variables are Strings, the expiry will be interpreted as milliseconds if not converted to int.
// eslint-disable-next-line no-magic-numbers
const expiresIn = process.env.JWT_EXPIRATION ? parseInt(process.env.JWT_EXPIRATION) : 3600;

async function generateJWT(account) {

  const jwtPrivateKey = await diskLogic.readJWTPrivateKeyFile();

  const jwtPubKey = await diskLogic.readJWTPublicKeyFile();

  // eslint-disable-next-line object-shorthand
  const token = await jwt.sign({ id: account }, jwtPrivateKey, { expiresIn: expiresIn, algorithm: 'RS256' });

  await jwt.verify(token, jwtPubKey, function (error) {
    if (error) {
      return Promise.reject(new Error('Error generating JWT token.'));
    }
  });

  return token;
}

module.exports = {
  generateJWT,
};
