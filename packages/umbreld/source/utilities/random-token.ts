import crypto from 'node:crypto'

const randomToken = (bitLength) => crypto.randomBytes(bitLength / 8).toString('hex')

export default randomToken
