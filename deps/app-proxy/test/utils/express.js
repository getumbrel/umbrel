const httpMocks = require('node-mocks-http');

const express = require("../../utils/express.js");

describe('express', () => {
  it('should remove a cookie from the request that doesn\'t exist', () => {
    const req = httpMocks.createRequest({
      method: 'GET',
      protocol: "http",
      headers: {
        host: "bitcoin.org:4444"
      },
      cookies: {
        session: "abc123"
      },
      signedCookies: {
        csrf: "a_value.das384jfdjsi4r2hf29f"
      }
    });

    const cookieHeader = express.removeCookie(req, "abc");

    assert.equal("session=abc123; csrf=a_value.das384jfdjsi4r2hf29f", cookieHeader);
  });

  it('should remove a cookie from the request that doesn\'t exist where there are no cookies', () => {
    const req = httpMocks.createRequest({
      method: 'GET',
      protocol: "http",
      headers: {
        host: "bitcoin.org:4444"
      },
      cookies: {},
      signedCookies: {}
    });

    const cookieHeader = express.removeCookie(req, "does_not_exist");

    assert.equal("", cookieHeader);
  });

  it('should remove a cookie from the request where the cookie exists', () => {
    const req = httpMocks.createRequest({
      method: 'GET',
      protocol: "http",
      headers: {
        host: "bitcoin.org:4444"
      },
      cookies: {
        session: "abc123",
        another_cookie: "some_value"
      },
      signedCookies: {
        csrf: "a_value.das384jfdjsi4r2hf29f"
      }
    });

    const cookieHeader = express.removeCookie(req, "session");

    assert.equal("another_cookie=some_value; csrf=a_value.das384jfdjsi4r2hf29f", cookieHeader);
  });
});
