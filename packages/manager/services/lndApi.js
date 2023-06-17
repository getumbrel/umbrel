const axios = require('axios');

// axios requires http
const lnapiUrl = process.env.MIDDLEWARE_API_URL || 'http://localhost';
const lnapiPort = process.env.MIDDLEWARE_API_PORT || 3005;

async function changePassword(currentPassword, newPassword, jwt) {

  const headers = {
    headers: {
      Authorization: 'JWT ' + jwt,
    }
  };

  const body = {
    currentPassword,
    newPassword,
  };

  return axios
    .post(lnapiUrl + ':' + lnapiPort + '/v1/lnd/wallet/changePassword', body, headers);
}

async function initializeWallet(password, seed, jwt) {
  const headers = {
    headers: {
      Authorization: 'JWT ' + jwt,
    }
  };

  const body = {
    password,
    seed,
  };

  return axios
    .post(lnapiUrl + ':' + lnapiPort + '/v1/lnd/wallet/init', body, headers);
}

async function getBitcoindAddresses(jwt) {

  const headers = {
    headers: {
      Authorization: 'JWT ' + jwt,
    }
  };

  return axios
    .get(lnapiUrl + ':' + lnapiPort + '/v1/bitcoind/info/addresses', headers);
}

async function getStatus() {
  return axios.get(lnapiUrl + ':' + lnapiPort + '/v1/lnd/info/status');
}

module.exports = {
  changePassword,
  initializeWallet,
  getBitcoindAddresses,
  getStatus,
};
