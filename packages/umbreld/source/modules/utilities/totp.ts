import crypto from 'node:crypto'
import {URL} from 'node:url'

import {totp} from 'notp'
// @ts-expect-error no @types/thirty-two available
import base32 from 'thirty-two'

export function generateUri(label: string, issuer: string) {
	const secret = crypto.randomBytes(32)
	const encodedSecret = base32.encode(secret).toString('utf8').replace(/=/g, '')
	const uri = `otpauth://totp/${label}?secret=${encodedSecret}&period=30&digits=6&algorithm=SHA1&issuer=${issuer}`

	return uri
}

export function verify(uri: string, token: string) {
	const parsedUri = new URL(uri)
	const secret = base32.decode(parsedUri.searchParams.get('secret'))
	const period = Number(parsedUri.searchParams.get('period'))
	const isValid = totp.verify(token, secret, {window: 10, time: period})

	return Boolean(isValid)
}

// Only used in tests
export function generateToken(uri: string) {
	const parsedUri = new URL(uri)
	const secret = base32.decode(parsedUri.searchParams.get('secret'))
	const period = Number(parsedUri.searchParams.get('period'))
	return totp.gen(secret, {time: period})
}
