const hmac = require("../../utils/hmac.js");

describe('hmac', () => {
  it('should sign the message', () => {
    assert.equal("4oCtD/Y2Xfb8J/tvCw9mrsRmMekbirseumiW4JrFahI=", hmac.sign("hello world", "my-secret-123"));
    assert.equal("qENA22U3zGY2ZhBPh9Tes+Fjt/SS8pjvL6d2Z0ZMTJk=", hmac.sign("https://xkcd.com/386/", "my-secret-123"));

    assert.equal("+fSwPHNg4EtsNpso1Iope7g3A7pPbTZubygel/9WdYc=", hmac.sign("https://xkcd.com/386/", "another-secret"));
  });

  it('should verify the signature for a message', () => {
    assert.isTrue(hmac.verify("https://xkcd.com/386/", "my-secret-123", "qENA22U3zGY2ZhBPh9Tes+Fjt/SS8pjvL6d2Z0ZMTJk="));
    assert.isTrue(hmac.verify("https://xkcd.com/386/", "another-secret", "+fSwPHNg4EtsNpso1Iope7g3A7pPbTZubygel/9WdYc="));

    assert.isFalse(hmac.verify("https://xkcd.com/386/something/random", "another-secret", "+fSwPHNg4EtsNpso1Iope7g3A7pPbTZubygel/9WdYc="));
  });
});
