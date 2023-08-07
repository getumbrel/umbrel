import {expect, afterAll, test, vi} from 'vitest'
import {createTRPCProxyClient, httpBatchLink} from '@trpc/client'

import Umbreld from '../../../../index.js'
import type {AppRouter} from '../index.js'
import * as totp from '../../../utilities/totp.js'

import temporaryDirectory from '../../../utilities/temporary-directory.js'

const directory = temporaryDirectory('auth')

await directory.createRoot()

let jwt = ''

const dataDirectory = await directory.create()
const umbreld = new Umbreld({
	dataDirectory,
	port: 0,
	logLevel: 'silent',
})
await umbreld.start()

const client = createTRPCProxyClient<AppRouter>({
	links: [
		httpBatchLink({
			url: `http://localhost:${umbreld.server.port}/trpc`,
			headers: async () => ({
				Authorization: `Bearer ${jwt}`,
			}),
		}),
	],
})

const testUserCredentials = {
	name: 'satoshi',
	password: 'moneyprintergobrrr',
}

const testTotpUri =
	'otpauth://totp/Umbrel?secret=63AU7PMWJX6EQJR6G3KTQFG5RDZ2UE3WVUMP3VFJWHSWJ7MMHTIQ&period=30&digits=6&algorithm=SHA1&issuer=getumbrel.com'

afterAll(directory.destroyRoot)

// The following tests are stateful and must be run in order

test('login throws invalid error if no user is registered', async () => {
	await expect(client.auth.login.mutate({password: testUserCredentials.password})).rejects.toThrow('Invalid login')
})

test('register creates a user to the config', async () => {
	await expect(client.auth.register.mutate(testUserCredentials)).resolves.toBe(true)
})

test('register throws error if username is not supplied', async () => {
	await expect(
		client.auth.register.mutate({
			password: testUserCredentials.password,
		}),
	).rejects.toThrow(/invalid_type.*name/s)
})

test('register throws error if password is not supplied', async () => {
	await expect(
		client.auth.register.mutate({
			name: testUserCredentials.name,
		}),
	).rejects.toThrow(/invalid_type.*password/s)
})

test('register throws error if password is below min length', async () => {
	await expect(
		client.auth.register.mutate({
			name: testUserCredentials.name,
			password: 'rekt',
		}),
	).rejects.toThrow('Password must be atleast 6 characters')
})

test('register throws an error if the user is already registered', async () => {
	await expect(client.auth.register.mutate(testUserCredentials)).rejects.toThrow(
		'Attempted to register when user is already registered',
	)
})

test('login throws an error for invalid credentials', async () => {
	await expect(client.auth.login.mutate({password: 'usdtothemoon'})).rejects.toThrow('Invalid login')
})

test('login throws an error if password is not supplied', async () => {
	await expect(client.auth.login.mutate({})).rejects.toThrow(/invalid_type.*password/s)
})

test("renewToken throws if we're not logged in", async () => {
	await expect(client.auth.renewToken.mutate(testUserCredentials)).rejects.toThrow('Invalid token')
})

test('login returns a token', async () => {
	const token = await client.auth.login.mutate(testUserCredentials)
	expect(typeof token).toBe('string')
	jwt = token
})

test("renewToken returns a new token when we're logged in", async () => {
	const token = await client.auth.renewToken.mutate(testUserCredentials)
	expect(typeof token).toBe('string')
	jwt = token
})

test("renewToken returns a new token when we're logged in", async () => {
	const token = await client.auth.renewToken.mutate(testUserCredentials)
	expect(typeof token).toBe('string')
	jwt = token
})

test('generateTotpUri returns a 2FA URI', async () => {
	await expect(client.auth.generateTotpUri.query()).resolves.toContain('otpauth://totp/Umbrel?secret=')
})

test('generateTotpUri returns a unique 2FA URI each time', async () => {
	const firstUri = await client.auth.generateTotpUri.query()
	const secondUri = await client.auth.generateTotpUri.query()
	expect(firstUri).not.toBe(secondUri)
})

test('enable2fa throws error on invalid token', async () => {
	const totpUri = await client.auth.generateTotpUri.query()
	await expect(
		client.auth.enable2fa.mutate({
			totpToken: '1234356',
			totpUri,
		}),
	).rejects.toThrow('Invalid 2FA token')
})

test('enable2fa enables 2FA on login', async () => {
	const totpToken = totp.generateToken(testTotpUri)
	await expect(
		client.auth.enable2fa.mutate({
			totpToken,
			totpUri: testTotpUri,
		}),
	).resolves.toBe(true)
})

test('login requires 2FA token if enabled', async () => {
	await expect(client.auth.login.mutate(testUserCredentials)).rejects.toThrow('Missing 2FA token')

	const totpToken = totp.generateToken(testTotpUri)
	await expect(
		client.auth.login.mutate({
			...testUserCredentials,
			totpToken,
		}),
	).resolves.toBeTypeOf('string')
})

test('disable2fa throws error on invalid token', async () => {
	await expect(
		client.auth.disable2fa.mutate({
			totpToken: '000000',
		}),
	).rejects.toThrow('Invalid 2FA token')
})

test('disable2fa disables 2fa on login', async () => {
	const totpToken = totp.generateToken(testTotpUri)
	await expect(
		client.auth.disable2fa.mutate({
			totpToken,
		}),
	).resolves.toBe(true)

	await expect(client.auth.login.mutate(testUserCredentials)).resolves.toBeTypeOf('string')
})
