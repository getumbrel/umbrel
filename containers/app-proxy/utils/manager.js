const axios = require('axios');
const package = require('../package.json');

const CONSTANTS = require('./const.js');

const axiosInstance = axios.create({
	baseURL: `${CONSTANTS.APP_PROTOCOL}://${CONSTANTS.MANAGER_IP}:${CONSTANTS.MANAGER_PORT}`,
	headers: {
		common: {
			"User-Agent": `${package.name}/${package.version}`
		}
	}
});

const account = {
	login: async function(body) {
		return axiosInstance.post('/v1/account/login', body);
	},
	token: async function(token) {
		return axiosInstance.get('/v1/account/token', {
			params: {
				token
			}
		});
	}
};

module.exports = {
	account
};
