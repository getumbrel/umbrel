const httpMocks = require('node-mocks-http');

const express = require("../../utils/express.js");

describe('express', () => {
  it('should attempt to remove a cookie even if that cookie does not exist', () => {
    const req = httpMocks.createRequest({
      method: 'GET',
      protocol: "http",
      headers: {
        host: "bitcoin.org:4444",
        cookie: "session=abc123; csrf=a_value.das384jfdjsi4r2hf29f"
      }
    });

    const cookieHeader = express.removeCookie(req, "abc");

    assert.equal("session=abc123; csrf=a_value.das384jfdjsi4r2hf29f", cookieHeader);
  });

  it('should attempt to remove a cookie even if there are no cookies', () => {
    const req = httpMocks.createRequest({
      method: 'GET',
      protocol: "http",
      headers: {
        host: "bitcoin.org:4444"
      }
    });

    const cookieHeader = express.removeCookie(req, "does_not_exist");

    assert.equal("", cookieHeader);
  });

  it('should remove the cookie when the cookie exists in the request header', () => {
    const req = httpMocks.createRequest({
      method: 'GET',
      protocol: "http",
      headers: {
        host: "bitcoin.org:4444",
        cookie: "session=abc123; another_cookie=some_value;csrf=a_value.das384jfdjsi4r2hf29f"
      }
    });

    const cookieHeader = express.removeCookie(req, "session");

    assert.equal("another_cookie=some_value; csrf=a_value.das384jfdjsi4r2hf29f", cookieHeader);
  });

  it('should remove the cookie when that 1 cookie exists in the request header', () => {
    const req = httpMocks.createRequest({
      method: 'GET',
      protocol: "http",
      headers: {
        host: "bitcoin.org:4444",
        cookie: "session=abc123"
      }
    });

    const cookieHeader = express.removeCookie(req, "session");

    assert.equal("", cookieHeader);
  });

  it('should remove the cookie when that 1 cookie exists with delimiter in the request header', () => {
    const req = httpMocks.createRequest({
      method: 'GET',
      protocol: "http",
      headers: {
        host: "bitcoin.org:4444",
        cookie: "session=abc123; "
      }
    });

    const cookieHeader = express.removeCookie(req, "session");

    assert.equal("", cookieHeader);
  });
});
