import {expect, afterAll, test} from 'vitest'
import {createTRPCProxyClient, httpBatchLink} from '@trpc/client'

import Umbreld from '../../../../source/index.js'
import type {AppRouter} from '../index.js'

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
			url: `http://localhost:${umbreld.services.server.port}/trpc`,
			headers: async () => ({
				Authorization: `Bearer ${jwt}`,
			}),
		}),
	],
})

const testUserCredentials = {
	username: 'satoshi',
	password: 'moneyprintergobrrr',
}

afterAll(directory.destroyRoot)

test('login throws invalid error if no user is registered', async () => {
	expect(client.auth.login.mutate({password: testUserCredentials.password})).rejects.toThrow('Invalid login')
})

test('register creates a user to the config', async () => {
	expect(client.auth.register.mutate(testUserCredentials)).resolves.toBe(true)
})

test('register throws error if username is not supplied', async () => {
	expect(
		client.auth.register.mutate({
			password: testUserCredentials.password,
		}),
	).rejects.toThrow(/invalid_type.*username/s)
})

test('register throws error if password is not supplied', async () => {
	expect(
		client.auth.register.mutate({
			username: testUserCredentials.username,
		}),
	).rejects.toThrow(/invalid_type.*password/s)
})

test('register throws error if password is below min length', async () => {
	expect(
		client.auth.register.mutate({
			username: testUserCredentials.username,
			password: 'rekt',
		}),
	).rejects.toThrow('Password must be atleast 6 characters')
})

test('register throws an error if the user is already registered', async () => {
	expect(client.auth.register.mutate(testUserCredentials)).rejects.toThrow(
		'Attempted to register when user is already registered',
	)
})

test('login throws an error for invalid credentials', async () => {
	expect(client.auth.login.mutate({password: 'usdtothemoon'})).rejects.toThrow('Invalid login')
})

test('login throws an error if password is not supplied', async () => {
	expect(client.auth.login.mutate({})).rejects.toThrow(/invalid_type.*password/s)
})

test("renewToken throws if we're not logged in", async () => {
	expect(client.auth.renewToken.mutate(testUserCredentials)).rejects.toThrow('Invalid token')
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
