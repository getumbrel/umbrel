const chai = require('chai');
const chaiHttp = require('chai-http');

chai.use(chaiHttp);
chai.should();

global.expect = chai.expect;
global.assert = chai.assert;

before(() => {
  
});

global.reset = () => {
  
};

after(() => {

});
