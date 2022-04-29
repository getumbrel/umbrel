const tor = require("../../utils/tor.js");

describe('tor', () => {
  it('should return the auth HS url', async () => {
    const url = await tor.authHsUrl();

    assert.equal("the-auth-hs-url.onion", url);
  });
});
