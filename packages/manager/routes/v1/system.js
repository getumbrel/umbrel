const express = require('express');
const router = express.Router();

const systemLogic = require('logic/system.js');
const diskLogic = require('logic/disk.js');

const auth = require('middlewares/auth.js');

const constants = require('utils/const.js');
const safeHandler = require('utils/safeHandler');

router.get('/info', auth.jwt, safeHandler(async (req, res) => {
    const info = await systemLogic.getInfo();

    return res.status(constants.STATUS_CODES.OK).json(info);
}));

router.get('/status', auth.jwt, safeHandler(async (req, res) => {
    const status = await systemLogic.status();

    return res.status(constants.STATUS_CODES.OK).json(status);
}));

router.post('/clear-memory-warning', auth.jwt, safeHandler(async (req, res) => {
    const result = await systemLogic.clearMemoryWarning();

    return res.status(constants.STATUS_CODES.OK).json(result);
}));

router.get('/dashboard-hidden-service', auth.jwt, safeHandler(async (req, res) => {
    const url = await systemLogic.getHiddenServiceUrl();

    return res.status(constants.STATUS_CODES.OK).json(url);
}));

router.get('/electrum-connection-details', auth.jwt, safeHandler(async (req, res) => {
    const connectionDetails = await systemLogic.getElectrumConnectionDetails();

    return res.status(constants.STATUS_CODES.OK).json(connectionDetails);
}));

router.get('/bitcoin-p2p-connection-details', auth.jwt, safeHandler(async (req, res) => {
    const connectionDetails = await systemLogic.getBitcoinP2PConnectionDetails();

    return res.status(constants.STATUS_CODES.OK).json(connectionDetails);
}));

router.get('/bitcoin-rpc-connection-details', auth.jwt, safeHandler(async (req, res) => {
    const connectionDetails = await systemLogic.getBitcoinRPCConnectionDetails();

    return res.status(constants.STATUS_CODES.OK).json(connectionDetails);
}));

router.get('/lndconnect-urls', auth.jwt, safeHandler(async (req, res) => {
    const urls = await systemLogic.getLndConnectUrls();

    return res.status(constants.STATUS_CODES.OK).json(urls);
}));

router.get('/get-update', auth.jwt, safeHandler(async (req, res) => {
    const update = await systemLogic.getAvailableUpdate();

    return res.status(constants.STATUS_CODES.OK).json(update);
}));

// This doesn't require a JWT because we want the user to be able to query
// the update process during the Umbrel restart which will log them out.
router.get('/update-status', safeHandler(async (req, res) => {
    const update = await systemLogic.getUpdateStatus();

    return res.status(constants.STATUS_CODES.OK).json(update);
}));

router.post('/update', auth.jwt, safeHandler(async (req, res) => {
    const status = await systemLogic.startUpdate();

    return res.status(constants.STATUS_CODES.OK).json(status);
}));

router.get('/backup-status', auth.jwt, safeHandler(async (req, res) => {
    const backup = await systemLogic.getBackupStatus();

    return res.status(constants.STATUS_CODES.OK).json(backup);
}));

router.get('/remote-tor-access-status', auth.jwt, safeHandler(async (req, res) => {
    const backup = await systemLogic.getRemoteTorAccessStatus();

    return res.status(constants.STATUS_CODES.OK).json(backup);
}));

router.get('/debug-result', auth.jwt, safeHandler(async (req, res) => {
    const result = await systemLogic.getDebugResult();

    return res.status(constants.STATUS_CODES.OK).json(result);
}));

router.post('/debug', auth.jwt, safeHandler(async (req, res) => {
    const result = await systemLogic.requestDebug();

    return res.status(constants.STATUS_CODES.OK).json(result);
}));

router.post('/shutdown', auth.jwt, safeHandler(async (req, res) => {
    const result = await systemLogic.requestShutdown();

    return res.status(constants.STATUS_CODES.OK).json(result);
}));

router.post('/reboot', auth.jwt, safeHandler(async (req, res) => {
    const result = await systemLogic.requestReboot();

    return res.status(constants.STATUS_CODES.OK).json(result);
}));

router.post('/remote-tor-access', auth.jwt, safeHandler(async (req, res) => {
    const enabled = req.body.enabled === true;

    const result = await systemLogic.setRemoteTorAccess(enabled);

    return res.status(constants.STATUS_CODES.OK).json(result);
}));

router.get('/storage', auth.jwt, safeHandler(async (req, res) => {
    const update = await systemLogic.getComputeResourceUsage('storage');

    return res.status(constants.STATUS_CODES.OK).json(update);
}));

router.get('/memory', auth.jwt, safeHandler(async (req, res) => {
    const update = await systemLogic.getComputeResourceUsage('memory');

    return res.status(constants.STATUS_CODES.OK).json(update);
}));

router.get('/temperature', auth.jwt, safeHandler(async (req, res) => {
    const update = await diskLogic.readSystemStatusFile('temperature');

    return res.status(constants.STATUS_CODES.OK).json(update);
}));

router.get('/uptime', auth.jwt, safeHandler(async (req, res) => {
    const update = await diskLogic.readSystemStatusFile('uptime');

    return res.status(constants.STATUS_CODES.OK).json(update);
}));

router.get('/is-umbrel-os', auth.jwt, safeHandler(async (req, res) => {
    return res.status(constants.STATUS_CODES.OK).json(constants.IS_UMBREL_OS);
}));

router.get('/is-sd-card-failing', auth.jwt, safeHandler(async (req, res) => {
    const update = await diskLogic.readSystemStatusFile('sd-card-health');

    const failing = (update !== null) ? update : false;

    return res.status(constants.STATUS_CODES.OK).json(failing);
}));

module.exports = router;
