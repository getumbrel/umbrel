import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import got from 'got'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import * as totp from '../utilities/totp.ts'

const password = 'moneyprintergobrrr'
const wrongPassword = 'usdtothemoon'
const member = {name: 'hal', password: 'runningbitcoin'}
const totpUri =
	'otpauth://totp/Umbrel?secret=63AU7PMWJX6EQJR6G3KTQFG5RDZ2UE3WVUMP3VFJWHSWJ7MMHTIQ&period=30&digits=6&algorithm=SHA1&issuer=umbrel.local'
const tooManyAttempts = /^Too many failed attempts\. Try again in \d+ minutes?\.$/
// Never a valid code, whatever the time is
const wrongTotpToken = 'abcdef'

type LoginResponse = {error?: {message: string}; result?: {data: string}}

describe.sequential('Login rate limiting', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let failed = false
	let httpPort: number
	let httpsPort: number
	let authPort: number
	let guestAddress: string
	let memberUserId: string

	// The test process reaches the VM through QEMU's port forwards, so umbreld
	// sees all of its requests coming from one address: the VM's gateway.
	const loginFromHost = (input: {userId?: string; password: string; totpToken?: string}) =>
		umbreld.unauthenticatedClient.user.login.mutate(input)

	// A request made inside the VM comes from the Umbrel itself, which makes it
	// a second client.
	const postFromGuest = async (port: number, path: string, body: object, {host = guestAddress, options = ''} = {}) => {
		const output = await umbreld.vm.ssh(
			`curl --silent --show-error --max-time 30 --request POST --header 'content-type: application/json' ${options} --data '${JSON.stringify(body)}' --write-out '\\n%{http_code}' 'http://${host}:${port}${path}'`,
		)
		const [responseBody, status] = output.trim().split('\n')
		return {status: Number(status), body: JSON.parse(responseBody) as LoginResponse}
	}

	const appLoginFromHost = (protocol: 'http' | 'https', body: object) =>
		got.post(`${protocol}://127.0.0.1:${authPort}/v1/account/login?origin=host&app=none&path=%2F`, {
			json: body,
			https: {rejectUnauthorized: false},
			throwHttpErrors: false,
			retry: {limit: 0},
			responseType: 'json',
		}) as Promise<{statusCode: number; body: LoginResponse}>

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'umbrel-home', forwardPorts: [{guestPort: 443}, {guestPort: 2000}]})
	})

	afterAll(async () => await umbreld?.cleanup())

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	test('boots VM, registers the owner and creates a member', async () => {
		await umbreld.vm.powerOn()
		httpPort = umbreld.vm.httpPort
		httpsPort = umbreld.vm.getHostPort(443)
		authPort = umbreld.vm.getHostPort(2000)
		await umbreld.registerAndLogin()

		const interfaces = await umbreld.client.system.getNetworkInterfaces.query()
		guestAddress = interfaces[0].ip!
		expect(guestAddress).toMatch(/^\d+\.\d+\.\d+\.\d+$/)

		memberUserId = (await umbreld.client.user.createUser.mutate(member)).userId
	})

	test('wrong passwords from a logged in session block that session', async () => {
		// Ten wrong guesses are answered normally
		for (let attempt = 1; attempt <= 10; attempt++) {
			await expect(umbreld.client.user.verifyPassword.mutate({password: wrongPassword})).rejects.toThrow(
				'Incorrect password',
			)
		}

		// After that the session is told to wait, even with the right password
		await expect(umbreld.client.user.verifyPassword.mutate({password})).rejects.toThrow(tooManyAttempts)

		// So is every other procedure that checks the password. These send a wrong
		// one so that a broken limit fails the test rather than acting on it.
		await expect(
			umbreld.client.user.changePassword.mutate({oldPassword: wrongPassword, newPassword: 'satoshishotfirst'}),
		).rejects.toThrow(tooManyAttempts)
		await expect(umbreld.client.system.factoryReset.mutate({password: wrongPassword})).rejects.toThrow(tooManyAttempts)

		// The rest of the session carries on working
		await expect(umbreld.client.user.get.query()).resolves.toMatchObject({role: 'owner'})
	})

	test('a blocked session does not stop the owner logging in again', async () => {
		await umbreld.login()
		await expect(umbreld.client.user.verifyPassword.mutate({password})).resolves.toBe(true)
	})

	test('ten wrong passwords block further logins to that account from that address', async () => {
		for (let attempt = 1; attempt <= 10; attempt++) {
			await expect(loginFromHost({password: wrongPassword})).rejects.toThrow('Incorrect password')
		}

		// The block is reported without checking the password, so it doesn't
		// reveal whether a guess was right
		await expect(loginFromHost({password: wrongPassword})).rejects.toThrow(tooManyAttempts)
		await expect(loginFromHost({password})).rejects.toThrow(tooManyAttempts)
		await expect(loginFromHost({password})).rejects.toMatchObject({data: {code: 'TOO_MANY_REQUESTS', httpStatus: 429}})
	})

	test('a blocked client cannot pose as another address', async () => {
		for (const forwardedFor of ['192.168.1.50', '127.0.0.1', '::1', `${guestAddress}, 10.9.8.7`]) {
			const response = await got.post(`http://127.0.0.1:${httpPort}/trpc/user.login`, {
				json: {password},
				headers: {'x-forwarded-for': forwardedFor},
				throwHttpErrors: false,
				retry: {limit: 0},
				responseType: 'json',
			})
			expect(response.statusCode).toBe(429)
		}
	})

	test('the block also applies over HTTPS and to native app logins', async () => {
		const https = await got.post(`https://127.0.0.1:${httpsPort}/trpc/user.login`, {
			json: {password},
			https: {rejectUnauthorized: false},
			throwHttpErrors: false,
			retry: {limit: 0},
		})
		expect(https.statusCode).toBe(429)

		await expect(
			umbreld.unauthenticatedClient.user.loginNative.mutate({
				password,
				client: {
					id: 'umbrel',
					platform: 'ios',
					deviceClass: 'phone',
					appVersion: '0.1',
					appBuild: '20',
					osVersion: '26.6.1',
				},
			}),
		).rejects.toThrow(tooManyAttempts)
	})

	test('the app login page blocks the same address, over HTTP and HTTPS', async () => {
		// The failed dashboard logins count here too, which also shows that the
		// app login port sees the address its client really connected from
		for (const protocol of ['http', 'https'] as const) {
			const response = await appLoginFromHost(protocol, {password})
			expect(response.statusCode).toBe(429)
			expect(response.body.error?.message).toMatch(tooManyAttempts)
		}
	})

	test('the block does not affect other accounts, other addresses or existing sessions', async () => {
		// Another account from the blocked address
		await expect(loginFromHost({userId: memberUserId, password: member.password})).resolves.toBeTypeOf('string')

		// The blocked account from another address, on the dashboard and the app login page
		const appLogin = await postFromGuest(2000, '/v1/account/login?origin=host&app=none&path=%2F', {
			password: wrongPassword,
		})
		expect(appLogin).toMatchObject({status: 401, body: {error: {message: 'Incorrect password'}}})
		const dashboardLogin = await postFromGuest(80, '/trpc/user.login', {password})
		expect(dashboardLogin.status).toBe(200)
		expect(dashboardLogin.body.result?.data).toBeTypeOf('string')

		// The owner's existing session
		await expect(umbreld.client.user.get.query()).resolves.toMatchObject({role: 'owner'})
	})

	test('the block lifts after a minute and a correct login clears the failures', async () => {
		await pWaitFor(
			() =>
				loginFromHost({password}).then(
					() => true,
					() => false,
				),
			{interval: 2000, timeout: 90_000},
		)

		// Had the earlier failures still counted, the first of these would have
		// blocked the address again
		for (let attempt = 1; attempt <= 9; attempt++) {
			await expect(loginFromHost({password: wrongPassword})).rejects.toThrow('Incorrect password')
		}
		await expect(loginFromHost({password})).resolves.toBeTypeOf('string')
	})

	test('requests a web page on another site could send are not counted', async () => {
		// A cross-site page can only post simple content types to the app login
		// port, never JSON
		for (let attempt = 1; attempt <= 10; attempt++) {
			for (const contentType of ['text/plain', 'application/x-www-form-urlencoded']) {
				const response = await got.post(`http://127.0.0.1:${authPort}/v1/account/login?origin=host&app=none&path=%2F`, {
					body: contentType === 'text/plain' ? JSON.stringify({password: wrongPassword}) : 'password=usdtothemoon',
					headers: {'content-type': contentType},
					throwHttpErrors: false,
					retry: {limit: 0},
				})
				expect(response.statusCode).toBe(400)
			}
		}

		// The address they came from can still log in
		await expect(loginFromHost({password})).resolves.toBeTypeOf('string')
	})

	test('asking whether an account needs a 2FA code does not count as a failure', async () => {
		await umbreld.client.user.enable2fa.mutate({totpUri, totpToken: totp.generateToken(totpUri)})

		// Login screens send the password on its own first
		for (let attempt = 1; attempt <= 20; attempt++) {
			await expect(loginFromHost({password})).rejects.toThrow('Missing 2FA code')
		}

		// Nor does it block a client that is one failure away from the limit
		for (let attempt = 1; attempt <= 9; attempt++) {
			await expect(loginFromHost({password, totpToken: wrongTotpToken})).rejects.toThrow('Incorrect 2FA code')
		}
		await expect(loginFromHost({password})).rejects.toThrow('Missing 2FA code')
		await expect(loginFromHost({password, totpToken: totp.generateToken(totpUri)})).resolves.toBeTypeOf('string')
	})

	test('ten wrong 2FA codes block further logins', async () => {
		for (let attempt = 1; attempt <= 10; attempt++) {
			await expect(loginFromHost({password, totpToken: wrongTotpToken})).rejects.toThrow('Incorrect 2FA code')
		}

		// Once blocked the answer no longer says whether the password was right
		await expect(loginFromHost({password})).rejects.toThrow(tooManyAttempts)
		await expect(loginFromHost({password, totpToken: totp.generateToken(totpUri)})).rejects.toThrow(tooManyAttempts)
	})

	test('wrong 2FA codes from a logged in session block that session', async () => {
		for (let attempt = 1; attempt <= 10; attempt++) {
			await expect(umbreld.client.user.disable2fa.mutate({totpToken: wrongTotpToken})).rejects.toThrow(
				'Incorrect 2FA code',
			)
		}
		await expect(umbreld.client.user.disable2fa.mutate({totpToken: totp.generateToken(totpUri)})).rejects.toThrow(
			tooManyAttempts,
		)
		await expect(umbreld.client.user.is2faEnabled.query()).resolves.toBe(true)
	})

	test('something running on the Umbrel is one client, however it connects', async () => {
		// An app that uses the host's network can reach umbreld's own port without
		// going through LAN ingress, and name any address it likes on the way
		const direct = (attempt: number) =>
			postFromGuest(
				22080,
				'/trpc/user.login',
				{password: wrongPassword},
				{
					host: '127.0.0.1',
					options: `--header 'x-forwarded-for: 192.168.50.${attempt}' --header 'x-umbrel-lan-ingress: guess'`,
				},
			)
		for (let attempt = 1; attempt <= 10; attempt++) {
			expect(await direct(attempt)).toMatchObject({status: 401, body: {error: {message: 'Incorrect password'}}})
		}
		expect((await direct(11)).status).toBe(429)

		// Nor does coming through LAN ingress from another of the Umbrel's addresses help
		const login = {password: wrongPassword}
		expect((await postFromGuest(80, '/trpc/user.login', login)).status).toBe(429)
		expect((await postFromGuest(80, '/trpc/user.login', login, {host: '127.0.0.1'})).status).toBe(429)
		expect(
			(await postFromGuest(80, '/trpc/user.login', login, {host: '127.0.0.1', options: '--interface 127.0.0.2'}))
				.status,
		).toBe(429)
		expect(
			(await postFromGuest(2000, '/v1/account/login?origin=host&app=none&path=%2F', login, {host: '127.0.0.1'})).status,
		).toBe(429)
	})
})
