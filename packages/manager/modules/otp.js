const crypto = require('crypto');
const {URL} = require('url');
const {totp} = require('notp');
const base32 = require('thirty-two');

const generateUri = () => {
  const secret = crypto.randomBytes(32);
  const encodedSecret = base32.encode(secret).toString('utf8').replace(/=/g,'');
  const uri = `otpauth://totp/Umbrel?secret=${encodedSecret}&period=30&digits=6&algorithm=SHA1&issuer=getumbrel.com`;

  return uri;
};

const verify = (uri, token) => {
  const parsedUri = new URL(uri);
  const secret = base32.decode(parsedUri.searchParams.get('secret'));
  const period = parsedUri.searchParams.get('period');
  const isValid = totp.verify(token, secret, {window: 6, time: period});

  return Boolean(isValid);
};

module.exports = {
  generateUri,
  verify,
};
