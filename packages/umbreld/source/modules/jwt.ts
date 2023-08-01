import jwt from 'jsonwebtoken'

const ONE_MINUTE = 60
const ONE_HOUR = 60 * ONE_MINUTE
const ONE_DAY = 24 * ONE_HOUR
const ONE_WEEK = 7 * ONE_DAY

const JWT_ALGORITHM = 'HS256'

const validateSecret = (secret: string) => {
	const hexRegex = /^[0-9a-fA-F]+$/
	if (secret.length !== 64 || !hexRegex.test(secret)) {
		throw new Error('Invalid JWT secret, expected 256bit hex string')
	}

	return true
}

export async function sign(secret: string) {
	validateSecret(secret)
	const payload = {loggedIn: true}
	const token = jwt.sign(payload, secret, {expiresIn: ONE_WEEK, algorithm: JWT_ALGORITHM})

	return token
}

export async function verify(token: string, secret: string) {
	validateSecret(secret)
	const payload = jwt.verify(token, secret, {algorithms: [JWT_ALGORITHM]})

	if (payload.loggedIn !== true) throw new Error('Invalid JWT')

	return true
}
