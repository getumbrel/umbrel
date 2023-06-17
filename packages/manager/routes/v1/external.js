const express = require('express');
const router = express.Router();

const auth = require('middlewares/auth.js');

const constants = require('utils/const.js');
const safeHandler = require('utils/safeHandler');

const {SocksProxyAgent} = require('socks-proxy-agent');
const axios = require('axios');

const agent = new SocksProxyAgent(`socks5h://${constants.TOR_PROXY_IP}:${constants.TOR_PROXY_PORT}`);

router.get('/price', auth.jwt, safeHandler(async(req, res) => {
  // Default to USD
  const currency = req.query.currency || "USD";
  const response = await axios({
    url: `https://min-api.cryptocompare.com/data/price?fsym=BTC&tsyms=${currency}`,
    httpsAgent: agent,
    method: 'GET'
  });

  if (response.data) {
    return res.status(constants.STATUS_CODES.OK).json(response.data);
  }

  return res.status(constants.STATUS_CODES.BAD_GATEWAY).json();
}));

module.exports = router;
