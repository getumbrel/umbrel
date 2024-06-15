import jwt from 'jsonwebtoken'

const ONE_MINUTE = 60
const ONE_HOUR = 60 * ONE_MINUTE
const ONE_DAY = 24 * ONE_HOUR
const ONE_WEEK = 7 * ONE_DAY

const JWT_ALGORITHM = 'HS256'

type jwtPayload = {
	loggedIn: boolean
}

const validateSecret = (secret: string) => {
	const hexRegex = /^[0-9a-fA-F]+$/
	if (secret.length !== 64 || !hexRegex.test(secret)) {
		throw new Error('Invalid JWT secret, expected 256bit hex string')
	}

	return true
}

export async function sign(secret: string) {
	validateSecret(secret)
	const payload: jwtPayload = {loggedIn: true}
	const token = jwt.sign(payload, secret, {expiresIn: ONE_WEEK, algorithm: JWT_ALGORITHM})

	return token
}

export async function verify(token: string, secret: string) {
	validateSecret(secret)
	const payload = jwt.verify(token, secret, {algorithms: [JWT_ALGORITHM]}) as jwtPayload

	if (payload.loggedIn !== true) throw new Error('Invalid JWT')

	return true
}

// TODO: Only used for legacy auth server verification, we'll want to refactor this.
// We create a JWT with the same key but a different payload.
// This token will be stored in a cookie so it can travel across ports/apps.
// The main login JWT is stored in local storage so it doesn't get leaked to apps
// on different ports. Since this JWT does not include the loggedIn payload,
// if it's leaked to an app they can't use it make authenticated API requests.
// This token only lets you through the app proxy and nothing else.
export async function signProxyToken(secret: string) {
	validateSecret(secret)
	const payload = {proxyToken: true}
	const token = jwt.sign(payload, secret, {expiresIn: ONE_WEEK, algorithm: JWT_ALGORITHM})

	return token
}

export async function verifyProxyToken(token: string, secret: string) {
	validateSecret(secret)
	const payload = jwt.verify(token, secret, {algorithms: [JWT_ALGORITHM]}) as any

	if (payload.proxyToken !== true) throw new Error('Invalid JWT')

	return true
}
