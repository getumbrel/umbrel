function removeCookie(req, cookieName) {
	const allCookies = {...req.cookies, ...req.signedCookies};

	delete(allCookies[cookieName]);

	return Object.keys(allCookies).map((key) => {
		return `${key}=${allCookies[key]}`
	}).join("; ");
}

module.exports = {
	removeCookie
};