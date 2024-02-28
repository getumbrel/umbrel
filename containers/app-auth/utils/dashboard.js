const axios = require('axios');
const package = require('../package.json');

const CONSTANTS = require('./const.js');

const axiosInstance = axios.create({
	baseURL: `http://${CONSTANTS.DASHBOARD_IP}:${CONSTANTS.DASHBOARD_PORT}`,
	headers: {
		common: {
			"User-Agent": `${package.name}/${package.version}`
		}
	}
});

const wallpaper = {
	get: async function(filename) {
		return axiosInstance({
			method: 'GET',
			url: `/wallpapers/${filename}`,
			responseType: 'stream'
		});
	}
};

module.exports = {
	wallpaper
};