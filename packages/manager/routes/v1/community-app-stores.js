const express = require('express');
const router = express.Router();

const reposLogic = require('logic/repos.js');

const auth = require('middlewares/auth.js');

const constants = require('utils/const.js');
const safeHandler = require('utils/safeHandler');

router.post('/add', auth.jwt, safeHandler(async (req, res) => {
    const {url} = req.body;

    const fullUrl = reposLogic.fullUrl(url);
    const result = await reposLogic.add(fullUrl);

    return res.status(constants.STATUS_CODES.OK).json({
        url: fullUrl
    });
}));

router.post('/remove', auth.jwt, safeHandler(async (req, res) => {
    const {url} = req.body;

    const fullUrl = reposLogic.fullUrl(url);
    const result = await reposLogic.remove(fullUrl);

    return res.status(constants.STATUS_CODES.OK).json(result);
}));

module.exports = router;
