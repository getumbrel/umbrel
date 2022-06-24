const manager = require('./manager.js');

async function validate(token) {
	if(typeof(token) !== "string") return false;

	console.log(`Validating token: ${token.substr(0, 12)} ...`);

	try {
		const info = await manager.account.token(token);

		return info.status === 200 && info.data.isValid === true;
	} catch (e) {
		console.error(e);
	}

	return false;
}

module.exports = {
	validate
};