import {expect, afterAll, test, vi} from 'vitest'

import * as totp from '../../../utilities/totp.js'

import createTestUmbreld from '../../../test-utilities/create-test-umbreld.js'

const umbreld = await createTestUmbreld()

const testUserCredentials = {
	name: 'satoshi',
	password: 'moneyprintergobrrr',
}

const testTotpUri =
	'otpauth://totp/Umbrel?secret=63AU7PMWJX6EQJR6G3KTQFG5RDZ2UE3WVUMP3VFJWHSWJ7MMHTIQ&period=30&digits=6&algorithm=SHA1&issuer=getumbrel.com'

afterAll(umbreld.cleanup)

// The following tests are stateful and must be run in order

test('exists() returns false when no user is registered', async () => {
	await expect(umbreld.client.user.exists.query()).resolves.toBe(false)
})

test('login() throws invalid error when no user is registered', async () => {
	await expect(umbreld.client.user.login.mutate({password: testUserCredentials.password})).rejects.toThrow(
		'Invalid login',
	)
})

test('register() throws error if username is not supplied', async () => {
	await expect(
		umbreld.client.user.register.mutate({
			password: testUserCredentials.password,
		} as any),
	).rejects.toThrow(/invalid_type.*name/s)
})

test('register() throws error if password is not supplied', async () => {
	await expect(
		umbreld.client.user.register.mutate({
			name: testUserCredentials.name,
		} as any),
	).rejects.toThrow(/invalid_type.*password/s)
})

test('register() throws error if password is below min length', async () => {
	await expect(
		umbreld.client.user.register.mutate({
			name: testUserCredentials.name,
			password: 'rekt',
		}),
	).rejects.toThrow('Password must be atleast 6 characters')
})

test('register() creates a user', async () => {
	await expect(umbreld.client.user.register.mutate(testUserCredentials)).resolves.toBe(true)
})

test('exists() returns true when a user is registered', async () => {
	await expect(umbreld.client.user.exists.query()).resolves.toBe(true)
})

test('register() throws an error if the user is already registered', async () => {
	await expect(umbreld.client.user.register.mutate(testUserCredentials)).rejects.toThrow(
		'Attempted to register when user is already registered',
	)
})

test('login() throws an error for invalid credentials', async () => {
	await expect(umbreld.client.user.login.mutate({password: 'usdtothemoon'})).rejects.toThrow('Invalid login')
})

test('login() throws an error if password is not supplied', async () => {
	await expect(umbreld.client.user.login.mutate({} as any)).rejects.toThrow(/invalid_type.*password/s)
})

test("renewToken() throws if we're not logged in", async () => {
	await expect(umbreld.client.user.renewToken.mutate()).rejects.toThrow('Invalid token')
})

test("isLoggedIn() returns false if we're not logged in", async () => {
	await expect(umbreld.client.user.isLoggedIn.query()).resolves.toBe(false)
})

test('login() returns a token', async () => {
	const token = await umbreld.client.user.login.mutate(testUserCredentials)
	expect(typeof token).toBe('string')
	umbreld.setJwt(token)
})

test("renewToken() returns a new token when we're logged in", async () => {
	const token = await umbreld.client.user.renewToken.mutate()
	expect(typeof token).toBe('string')
	umbreld.setJwt(token)
})

test("isLoggedIn() returns true when we're logged in", async () => {
	await expect(umbreld.client.user.isLoggedIn.query()).resolves.toBe(true)
})

test('generateTotpUri() returns a 2FA URI', async () => {
	await expect(umbreld.client.user.generateTotpUri.query()).resolves.toContain('otpauth://totp/Umbrel?secret=')
})

test('generateTotpUri() returns a unique 2FA URI each time', async () => {
	const firstUri = await umbreld.client.user.generateTotpUri.query()
	const secondUri = await umbreld.client.user.generateTotpUri.query()
	expect(firstUri).not.toBe(secondUri)
})

test('enable2fa() throws error on invalid token', async () => {
	const totpUri = await umbreld.client.user.generateTotpUri.query()
	await expect(
		umbreld.client.user.enable2fa.mutate({
			totpToken: '1234356',
			totpUri,
		}),
	).rejects.toThrow('Invalid 2FA token')
})

test('enable2fa() enables 2FA on login', async () => {
	const totpToken = totp.generateToken(testTotpUri)
	await expect(
		umbreld.client.user.enable2fa.mutate({
			totpToken,
			totpUri: testTotpUri,
		}),
	).resolves.toBe(true)
})

test('login() requires 2FA token if enabled', async () => {
	await expect(umbreld.client.user.login.mutate(testUserCredentials)).rejects.toThrow('Missing 2FA token')

	const totpToken = totp.generateToken(testTotpUri)
	await expect(
		umbreld.client.user.login.mutate({
			...testUserCredentials,
			totpToken,
		}),
	).resolves.toBeTypeOf('string')
})

test('disable2fa() throws error on invalid token', async () => {
	await expect(
		umbreld.client.user.disable2fa.mutate({
			totpToken: '000000',
		}),
	).rejects.toThrow('Invalid 2FA token')
})

test('disable2fa() disables 2fa on login', async () => {
	const totpToken = totp.generateToken(testTotpUri)
	await expect(
		umbreld.client.user.disable2fa.mutate({
			totpToken,
		}),
	).resolves.toBe(true)

	await expect(umbreld.client.user.login.mutate(testUserCredentials)).resolves.toBeTypeOf('string')
})

test('get() returns user data', async () => {
	await expect(umbreld.client.user.get.query()).resolves.toStrictEqual({name: 'satoshi'})
})

test("set() sets the user's name", async () => {
	await expect(umbreld.client.user.set.mutate({name: 'Hal'})).resolves.toBe(true)
	await expect(umbreld.client.user.get.query()).resolves.toContain({name: 'Hal'})

	// Revert name change
	await expect(umbreld.client.user.set.mutate({name: testUserCredentials.name})).resolves.toBe(true)
	await expect(umbreld.client.user.get.query()).resolves.toContain({name: testUserCredentials.name})
})

test("set() sets the user's wallpaper", async () => {
	await expect(umbreld.client.user.set.mutate({wallpaper: '1.jpg'})).resolves.toBe(true)
	await expect(umbreld.client.user.get.query()).resolves.toContain({wallpaper: '1.jpg'})

	await expect(umbreld.client.user.set.mutate({wallpaper: '2.jpg'})).resolves.toBe(true)
	await expect(umbreld.client.user.get.query()).resolves.toContain({wallpaper: '2.jpg'})
})

test('set() throws on unknown property', async () => {
	// @ts-expect-error Testing invalid arguments
	await expect(umbreld.client.user.set.mutate({foo: 'bar'})).rejects.toThrow('unrecognized_keys')
})

test('changePassword() throws on inavlid oldPassword', async () => {
	await expect(
		umbreld.client.user.changePassword.mutate({oldPassword: 'fiat4lyfe', newPassword: 'usdtothemoon'}),
	).rejects.toThrow('Invalid login')
})

test("changePassword() changes the user's password", async () => {
	await expect(
		umbreld.client.user.changePassword.mutate({oldPassword: testUserCredentials.password, newPassword: 'usdtothemoon'}),
	).resolves.toBe(true)
	await expect(umbreld.client.user.login.mutate({password: 'usdtothemoon'})).resolves.toBeTypeOf('string')

	// Reset password
	await expect(
		umbreld.client.user.changePassword.mutate({oldPassword: 'usdtothemoon', newPassword: testUserCredentials.password}),
	).resolves.toBe(true)
	await expect(umbreld.client.user.login.mutate(testUserCredentials)).resolves.toBeTypeOf('string')
})
