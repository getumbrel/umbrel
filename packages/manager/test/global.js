const chai = require('chai');
const chaiHttp = require('chai-http');
const server = require('../app.js');

chai.use(chaiHttp);
chai.should();

global.expect = chai.expect;
global.assert = chai.assert;

before(() => {
  global.requester = chai.request(server).keepOpen();
});

global.reset = () => {
  global.Lightning.reset();
  global.WalletUnlocker.reset();
};

after(() => {
  global.requester.close();
});
