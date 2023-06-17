const express = require('express');
const router = express.Router();

// const applicationLogic = require('logic/application.js');
const authLogic = require('logic/auth.js');
const diskLogic = require('logic/disk.js');
const sessionLogic = require('logic/session.js');

const auth = require('middlewares/auth.js');
const incorrectPasswordAuthHandler = require('middlewares/incorrectPasswordAuthHandler.js');

const constants = require('utils/const.js');
const safeHandler = require('utils/safeHandler');
const validator = require('utils/validator.js');

const otp = require('modules/otp');

const COMPLETE = 100;

// Endpoint to change your name.
router.post('/name', auth.jwt, safeHandler(async (req, res) => {
    const newName = req.body.newName;
    validator.isString(newName);

    const user = await diskLogic.readUserFile();
    await diskLogic.writeUserFile({ ...user, name: newName });
    return res.status(constants.STATUS_CODES.OK).json({ message: 'Name updated successfully' });   
}));

// Endpoint to change your password.
router.post('/change-password', auth.convertReqBodyToBasicAuth, auth.basic, incorrectPasswordAuthHandler, safeHandler(async (req, res, next) => {
    // Use password from the body by default. Basic auth has issues handling special characters.
    const currentPassword = req.body.password;
    const newPassword = req.body.newPassword;

    const jwt = await authLogic.refresh(req.user);

    try {
        validator.isString(currentPassword);
        validator.isMinPasswordLength(currentPassword);
        validator.isString(newPassword);
        validator.isMinPasswordLength(newPassword);
        if (newPassword === currentPassword) {
            throw new Error('The new password must not be the same as existing password');
        }
    } catch (error) {
        return next(error);
    }

    const status = await authLogic.getChangePasswordStatus();

    // return a conflict if a change password process is already running
    if (status.percent > 0 && status.percent !== COMPLETE) {
        return res.status(constants.STATUS_CODES.CONFLICT).json();
    }

    try {
        // start change password process in the background and immediately return
        await authLogic.changePassword(currentPassword, newPassword, jwt.jwt);
        return res.status(constants.STATUS_CODES.OK).json();
    } catch (error) {
        return next(error);
    }
}));

// Returns the current status of the change password process.
router.get('/change-password/status', auth.jwt, safeHandler(async (req, res) => {
    const status = await authLogic.getChangePasswordStatus();

    return res.status(constants.STATUS_CODES.OK).json(status);
}));

// Registered does not need auth. This is because the user may not be registered at the time and thus won't always have
// an auth token.
router.get('/registered', safeHandler((req, res) =>
    authLogic.isRegistered()
        .then(registered => res.json(registered))
));

// Endpoint to register a password with the device. Wallet must not exist. This endpoint is authorized with basic auth
// or the property password from the body.
router.post('/register', auth.convertReqBodyToBasicAuth, auth.register, safeHandler(async (req, res, next) => {

    try {
        validator.isString(req.body.name);
        validator.isString(req.user.plainTextPassword);
        validator.isMinPasswordLength(req.user.plainTextPassword);
    } catch (error) {
        return next(error);
    }

    const user = req.user;

    //add name to user obj
    user.name = req.body.name;

    const jwt = await authLogic.register(user);
    const token = await sessionLogic.create();

    return res.umbrelSessionCookie(token).json(jwt);
}));

router.post('/login', auth.convertReqBodyToBasicAuth, auth.basic, safeHandler(async (req, res) => {
    const jwt = await authLogic.login(req.user);
    const token = await sessionLogic.create();

    return res.umbrelSessionCookie(token).json({...jwt, token});
}));

router.post('/logout', auth.jwt, safeHandler(async (req, res) => {
    await sessionLogic.deleteAll();

    return res.status(constants.STATUS_CODES.OK).json();
}));

router.get('/info', auth.jwt, safeHandler(async (req, res) => {
    const info = await authLogic.getInfo();

    return res.status(constants.STATUS_CODES.OK).json(info);
}));

router.get('/token', safeHandler(async (req, res) => {
    const isValid = await sessionLogic.isValid(req.query.token);

    return res.status(constants.STATUS_CODES.OK).json({
        isValid
    });
}));

router.post('/seed', auth.convertReqBodyToBasicAuth, auth.basic, incorrectPasswordAuthHandler, safeHandler(async (req, res) => {
    const seed = await authLogic.seed(req.user);

    return res.json(seed);
}));

router.post('/refresh', auth.jwt, safeHandler((req, res) =>
    authLogic.refresh(req.user)
        .then(jwt => res.json(jwt))
));

// Gets a new random OTP uri
router.get('/otpUri', auth.jwt, safeHandler(async (req, res) => {
    const otpUri = otp.generateUri();

    return res.status(constants.STATUS_CODES.OK).json(otpUri);
}));

// Enables OTP
router.post('/otp/enable', auth.jwt, safeHandler(async (req, res) => {
    const {otpToken, otpUri} = req.body;

    // Verify provided OTP token matched provided OTP uri
    if(!otp.verify(otpUri, otpToken)) {
        throw new Error('Invalid OTP Token');
    }

    // Insert otpUri into the user file
    diskLogic.updateUserFile(userData => {
        userData.otpUri = otpUri;
        return userData;
    });

    return res.status(constants.STATUS_CODES.OK).json();
}));

// Disables OTP
router.post('/otp/disable', auth.jwt, safeHandler(async (req, res) => {
    const {otpToken} = req.body;

    // Read OTP uri on disk
    const {otpUri} = await diskLogic.readUserFile();

    // Verify provided OTP token
    if(!otp.verify(otpUri, otpToken)) {
        throw new Error('Invalid OTP Token');
    }

    // Remove OTP entry from user file
    diskLogic.updateUserFile(userData => {
        delete userData.otpUri;
        return userData;
    });

    return res.status(constants.STATUS_CODES.OK).json();
}));

// Set wallpaper
router.post('/wallpaper', auth.jwt, safeHandler(async (req, res) => {
    const {wallpaper} = req.body;

    // Save wallpaper in user file
    diskLogic.updateUserFile(userData => ({...userData, wallpaper}));

    return res.status(constants.STATUS_CODES.OK).json();
}));

// Get wallpaper (public)
router.get('/wallpaper', safeHandler(async (req, res) => {
    let wallpaper = null;
    try {
        ({wallpaper} = await diskLogic.readUserFile());
    } catch {}

    return res.json(wallpaper);
}));


module.exports = router;
