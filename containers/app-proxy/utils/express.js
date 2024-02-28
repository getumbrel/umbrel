function removeCookie(req, cookieName) {
	const allCookies = req.headers.cookie || "";

	// Split on '; ' (where space is optional)
	// More details re http cookie delimter:
	// https://www.rfc-editor.org/rfc/rfc6265#section-4.2.1
	const cookiePairs = allCookies.split(/; */g).filter(pair => pair.length > 0);

	// Filter out cookie and re-join
	// to build http cookie string
	// (using cookie delimiter)
	return cookiePairs.filter(pair => ! pair.startsWith(`${cookieName}=`)).join("; ");
}

module.exports = {
	removeCookie
};