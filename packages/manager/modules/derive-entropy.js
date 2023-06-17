const {promisify} = require('util');
const readFile = promisify(require('fs').readFile);
const crypto = require('crypto');

const constants = require('utils/const.js');

const deriveEntropy = async indentifier => {
  const umbrel_seed = await readFile(constants.UMBREL_SEED_FILE);

  return crypto
    .createHmac('sha256', umbrel_seed)
    .update(indentifier)
    .digest('hex');
};

module.exports = deriveEntropy;