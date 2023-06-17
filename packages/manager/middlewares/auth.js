const passport = require('passport');
const passportJWT = require('passport-jwt');
const passportHTTP = require('passport-http');
const bcrypt = require('bcrypt');
const diskLogic = require('logic/disk.js');
const authLogic = require('logic/auth.js');
const NodeError = require('models/errors.js').NodeError;
const UUID = require('utils/UUID.js');
const rsa = require('node-rsa');
const otp = require('modules/otp');

const JwtStrategy = passportJWT.Strategy;
const BasicStrategy = passportHTTP.BasicStrategy;
const ExtractJwt = passportJWT.ExtractJwt;

const JWT_AUTH = 'jwt';
const REGISTRATION_AUTH = 'register';
const BASIC_AUTH = 'basic';

const SYSTEM_USER = UUID.fetchBootUUID() || 'admin';

const b64encode = str => Buffer.from(str, 'utf-8').toString('base64');
const b64decode = b64 => Buffer.from(b64, 'base64').toString('utf-8');

async function generateJWTKeys() {
  const key = new rsa({ b: 512 }); // eslint-disable-line id-length

  const privateKey = key.exportKey('private');
  const publicKey = key.exportKey('public');

  await diskLogic.writeJWTPrivateKeyFile(privateKey);
  await diskLogic.writeJWTPublicKeyFile(publicKey);
}

async function createJwtOptions() {
  await generateJWTKeys();
  const pubKey = await diskLogic.readJWTPublicKeyFile();

  return {
    jwtFromRequest: ExtractJwt.fromAuthHeaderWithScheme('jwt'),
    secretOrKey: pubKey,
    algorithm: 'RS256'
  };
}

passport.serializeUser(function (user, done) {
  return done(null, SYSTEM_USER);
});

passport.use(BASIC_AUTH, new BasicStrategy(function (username, password, next) {
  password = b64decode(password);
  const user = {
    username: SYSTEM_USER,
    password,
    plainTextPassword: password
  };
  return next(null, user);
}));

createJwtOptions().then(function (data) {
  const jwtOptions = data;

  passport.use(JWT_AUTH, new JwtStrategy(jwtOptions, function (jwtPayload, done) {
    return done(null, { username: SYSTEM_USER });
  }));
});

passport.use(REGISTRATION_AUTH, new BasicStrategy(function (username, password, next) {
  password = b64decode(password);
  const credentials = authLogic.hashCredentials(SYSTEM_USER, password);

  return next(null, credentials);
}));

// Override the authorization header with password that is in the body of the request if basic auth was not supplied.
function convertReqBodyToBasicAuth(req, res, next) {
  if (req.body.password && !req.headers.authorization) {
    // We need to Base64 encode because Passport breaks on ":" characters
    const password = b64encode(req.body.password);
    req.headers.authorization = 'Basic ' + Buffer.from(SYSTEM_USER + ':' + password).toString('base64');
  }

  next();
}

function basic(req, res, next) {
  passport.authenticate(BASIC_AUTH, { session: false }, function (error, user) {

    async function handleCompare(equal) {
      if (!equal) {
        return next(new NodeError('Incorrect password', 401)); // eslint-disable-line no-magic-numbers
      }

      // Check if we have 2FA enabled
      const userData = await diskLogic.readUserFile();
      if (userData.otpUri) {

        // Return an error if no OTP token is provided
        if (!req.body.otpToken) {
          return next(new NodeError('Missing OTP token', 401)); // eslint-disable-line no-magic-numbers
        }

        // Return an error if provided OTP token is invalid
        if(!otp.verify(userData.otpUri, req.body.otpToken)) {
          return next(new NodeError('Invalid OTP token', 401)); // eslint-disable-line no-magic-numbers
        }
      }

      req.logIn(user, function (err) {
        if (err) {
          return next(new NodeError('Unable to authenticate', 401)); // eslint-disable-line no-magic-numbers
        }

        return next(null, user);
      });
    }

    if (error || user === false) {
      return next(new NodeError('Invalid state', 401)); // eslint-disable-line no-magic-numbers
    }

    diskLogic.readUserFile()
      .then(userData => {
        const storedPassword = userData.password;

        bcrypt.compare(user.password, storedPassword)
          .then(handleCompare)
          .catch(next);
      })
      .catch(() => next(new NodeError('No user registered', 401))); // eslint-disable-line no-magic-numbers
  })(req, res, next);
}

function jwt(req, res, next) {
  passport.authenticate(JWT_AUTH, { session: false }, function (error, user) {
    if (error || user === false) {
      return next(new NodeError('Invalid JWT', 401)); // eslint-disable-line no-magic-numbers
    }
    req.logIn(user, function (err) {
      if (err) {
        return next(new NodeError('Unable to authenticate', 401)); // eslint-disable-line no-magic-numbers
      }

      return next(null, user);
    });
  })(req, res, next);
}

async function accountJWTProtected(req, res, next) {
  const isRegistered = await authLogic.isRegistered();
  if (isRegistered.registered) {
    passport.authenticate(JWT_AUTH, { session: false }, function (error, user) {
      if (error || user === false) {
        return next(new NodeError('Invalid JWT', 401)); // eslint-disable-line no-magic-numbers
      }
      req.logIn(user, function (err) {
        if (err) {
          return next(new NodeError('Unable to authenticate', 401)); // eslint-disable-line no-magic-numbers
        }

        return next(null, user);
      });
    })(req, res, next);
  } else {
    return next(null, 'not-registered');
  }
}

function register(req, res, next) {
  passport.authenticate(REGISTRATION_AUTH, { session: false }, function (error, user) {
    if (error || user === false) {
      return next(new NodeError('Invalid state', 401)); // eslint-disable-line no-magic-numbers
    }
    req.logIn(user, function (err) {
      if (err) {
        return next(new NodeError('Unable to authenticate', 401)); // eslint-disable-line no-magic-numbers
      }

      return next(null, user);
    });
  })(req, res, next);
}

module.exports = {
  basic,
  convertReqBodyToBasicAuth,
  jwt,
  register,
  accountJWTProtected,
};
