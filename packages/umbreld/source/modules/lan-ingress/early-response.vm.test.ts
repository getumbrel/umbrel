import net from 'node:net'
import {Duplex} from 'node:stream'
import tls from 'node:tls'

import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test} from 'vitest'
import got from 'got'
import pRetry from 'p-retry'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import runGitServer from '../test-utilities/run-git-server.ts'
import readBeforeFailedWrite from '../utilities/read-before-failed-write.ts'

// These apps answer every request straight away, without reading its body. One
// sits behind the app gateway and the other is reached directly.
const appId = 'sparkles-hello-world'
const appPort = 4000
const hostAppId = 'sparkles-host-network'
const hostAppPort = 4001

// A response sent while its request was still arriving used to be lost often,
// but not every time, so every case is repeated
const uploads = 20
const megabyte = Buffer.alloc(1024 * 1024, 'upload')

// Starts a large upload and keeps sending it until it has been answered or the
// connection fails, and returns the status it was answered with, if any. It
// asks for the connection to be closed afterwards, which an app reached
// directly then does without reading the rest of the upload.
//
// Whoever answers early closes while the upload is still arriving, which
// resets the connection. Like every hop inside umbreld, this client reads what
// it was sent before acting on a failed write, or it would lose the answer
// itself. TLS runs over that connection so that its writes go through it too.
function upload(protocol: 'http' | 'https', port: number, path = '/') {
	return new Promise<number | undefined>((resolve) => {
		const connection = net.connect({host: '127.0.0.1', port})
		readBeforeFailedWrite(connection)
		const socket =
			protocol === 'http'
				? connection
				: tls.connect({socket: Duplex.from({readable: connection, writable: connection}), rejectUnauthorized: false})
		let response = ''
		const finish = () => {
			connection.destroy()
			socket.destroy()
			const status = /^HTTP\/1\.1 (\d+)/.exec(response)?.[1]
			resolve(status ? Number(status) : undefined)
		}
		connection.setTimeout(30_000, finish)
		for (const stream of new Set([connection, socket])) {
			stream.on('error', finish)
			stream.on('close', finish)
		}
		socket.on('data', (data: Buffer) => {
			response += data.toString('latin1')
			if (response.includes('\r\n\r\n')) finish()
		})
		socket.once(protocol === 'http' ? 'connect' : 'secureConnect', () => {
			socket.write(
				`POST ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\nContent-Length: ${1024 * megabyte.length}\r\n\r\n`,
			)
			// A write the hook reports as done after a reset completes at once, so
			// yield after each megabyte or the answer would never be read
			let sent = 0
			const send = () => {
				if (!socket.writable || sent === 1024) return
				sent++
				if (socket.write(megabyte)) setImmediate(send)
				else socket.once('drain', send)
			}
			send()
		})
	})
}

async function uploadRepeatedly(protocol: 'http' | 'https', port: number, path?: string) {
	const statuses: Array<number | undefined> = []
	for (let count = 0; count < uploads; count++) statuses.push(await upload(protocol, port, path))
	return statuses
}

describe.sequential('Responses to uploads that are still arriving', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let gitServer: Awaited<ReturnType<typeof runGitServer>>
	let failed = false

	beforeAll(async () => {
		umbreld = await createTestVm({
			device: 'umbrel-home',
			forwardPorts: [{guestPort: 443}, {guestPort: appPort}, {guestPort: hostAppPort}],
		})
		gitServer = await runGitServer({additionalApps: [hostAppId]})
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()
	})

	afterAll(async () => {
		try {
			await umbreld?.cleanup()
		} finally {
			await gitServer?.close()
		}
	})

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	// The gateway applies an authentication change on its next refresh
	const waitForAppStatus = (status: number) =>
		pRetry(
			async () => {
				const response = await got(`http://127.0.0.1:${umbreld.vm.getHostPort(appPort)}/`, {
					followRedirect: false,
					throwHttpErrors: false,
					retry: {limit: 0},
				})
				expect(response.statusCode).toBe(status)
			},
			{retries: 120, factor: 1, minTimeout: 1000, maxTimeout: 1000},
		)

	test('installs an app that sits behind the app gateway and needs a login', async () => {
		await umbreld.client.appStore.addRepository.mutate({url: gitServer.url.replace('localhost', '10.0.2.2')})
		await expect(umbreld.client.apps.install.mutate({appId})).resolves.toBe(true)
		await waitForAppStatus(302)
	})

	test("delivers umbreld's refusal of an unauthenticated upload over HTTP and HTTPS", async () => {
		// The files API turns this upload away without reading it
		const path = '/api/files/upload?path=/Home/upload.bin'
		const refused = Array.from({length: uploads}, () => 401)
		await expect(uploadRepeatedly('http', umbreld.vm.httpPort, path)).resolves.toEqual(refused)
		await expect(uploadRepeatedly('https', umbreld.vm.getHostPort(443), path)).resolves.toEqual(refused)
	})

	test("delivers the app gateway's redirect to log in for an upload over HTTP and HTTPS", async () => {
		const redirected = Array.from({length: uploads}, () => 302)
		await expect(uploadRepeatedly('http', umbreld.vm.getHostPort(appPort))).resolves.toEqual(redirected)
		await expect(uploadRepeatedly('https', umbreld.vm.getHostPort(appPort))).resolves.toEqual(redirected)
	})

	test("delivers the answer of an app behind the gateway that doesn't read the upload", async () => {
		await umbreld.client.apps.setSettings.mutate({appId, appProxyAuthEnabled: false})
		await waitForAppStatus(200)

		// The app closes its connection to the gateway while the upload is still
		// arriving there, which must not be taken for the app failing
		const answered = Array.from({length: uploads}, () => 200)
		await expect(uploadRepeatedly('http', umbreld.vm.getHostPort(appPort))).resolves.toEqual(answered)
		await expect(uploadRepeatedly('https', umbreld.vm.getHostPort(appPort))).resolves.toEqual(answered)
	})

	test("delivers the answer of a directly reached app that doesn't read the upload", async () => {
		await expect(umbreld.client.apps.install.mutate({appId: hostAppId})).resolves.toBe(true)
		await pRetry(() => got(`http://127.0.0.1:${umbreld.vm.getHostPort(hostAppPort)}/`, {retry: {limit: 0}}), {
			retries: 120,
			factor: 1,
			minTimeout: 1000,
			maxTimeout: 1000,
		})

		// Plain HTTP is relayed to the app as it is, and HTTPS is proxied to it
		const answered = Array.from({length: uploads}, () => 200)
		await expect(uploadRepeatedly('http', umbreld.vm.getHostPort(hostAppPort))).resolves.toEqual(answered)
		await expect(uploadRepeatedly('https', umbreld.vm.getHostPort(hostAppPort))).resolves.toEqual(answered)
	})
})
