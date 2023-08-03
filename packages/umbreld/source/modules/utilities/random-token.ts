import crypto from 'node:crypto'

function randomToken(bitLength: number) {
	return crypto.randomBytes(bitLength / 8).toString('hex')
}

export default randomToken
