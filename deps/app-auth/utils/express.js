function getQueryParam(req, key) {
	const value = req.query[key];

	if(typeof(value) !== "string" || value.trim().length == 0) {
		throw new Error(`'${key}' is missing`);
	}

	return value;
}

module.exports = {
	getQueryParam
};