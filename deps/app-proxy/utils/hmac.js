const crypto = require('crypto');

function sign(input, secret) {
	return crypto
		.createHmac('sha256', secret)
		.update(input)
		.digest('base64');
};

function verify(input, secret, signature){
	const inputSignature = Buffer.from( sign(input, secret) );
	const testSignature = Buffer.from( signature );

	return inputSignature.length === testSignature.length && crypto.timingSafeEqual(inputSignature, testSignature);
};

module.exports = {
	sign,
	verify
};