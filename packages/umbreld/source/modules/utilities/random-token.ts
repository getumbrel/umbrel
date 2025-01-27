import randomBytes from './random-bytes.js'

async function randomToken(bitLength: number) {
	const buffer = await randomBytes(bitLength >>> 3)
	return buffer.toString('hex')
}

export default randomToken
