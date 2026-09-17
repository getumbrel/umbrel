import {execFile} from 'node:child_process'
import {once} from 'node:events'
import fs from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import tls from 'node:tls'
import {promisify} from 'node:util'

import {afterAll, afterEach, beforeAll, expect, test, vi} from 'vitest'
import {WebSocket, WebSocketServer} from 'ws'

import LanIngress from './lan-ingress.js'
import {forwardTcp} from './forward-tcp.js'
import {readNativeTlsPrelude, MAX_PENDING_NATIVE_TLS_CONNECTIONS} from './native-tls-preread.js'

const hostname = '192-168-1-100.server-id.plex.direct'
const logger = {createChildLogger: () => logger, verbose: () => {}, log: () => {}, error: () => {}}
const servers: net.Server[] = []
const sockets = new Set<net.Socket>()
let directory: string
let nativeCert: Buffer, nativeKey: Buffer, umbrelCert: Buffer, umbrelKey: Buffer
let ingress: any
let muxPort: number
let backendPort: number
let httpsBackend: https.Server

async function listen(server: net.Server) {
	servers.push(server)
	server.on('connection', (socket) => {
		sockets.add(socket)
		socket.on('error', () => {})
		socket.once('close', () => sockets.delete(socket))
	})
	server.listen(0, '127.0.0.1')
	await once(server, 'listening')
	return (server.address() as net.AddressInfo).port
}

beforeAll(async () => {
	directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-tls-'))
	// Each route must present a certificate from its own trust root.
	for (const [id, name] of [
		['native', hostname],
		['umbrel', 'umbrel.local'],
	]) {
		await promisify(execFile)('openssl', [
			'req',
			'-x509',
			'-newkey',
			'rsa:2048',
			'-nodes',
			'-days',
			'1',
			'-keyout',
			`${directory}/${id}.key`,
			'-out',
			`${directory}/${id}.pem`,
			'-subj',
			`/CN=${name}`,
			'-addext',
			`subjectAltName=DNS:${name}`,
		])
	}
	;[nativeCert, nativeKey, umbrelCert, umbrelKey] = await Promise.all(
		['native.pem', 'native.key', 'umbrel.pem', 'umbrel.key'].map((name) => fs.readFile(`${directory}/${name}`)),
	)
	ingress = new LanIngress({dataDirectory: directory, logger} as never)
	ingress.serverCertificatePath = `${directory}/umbrel.pem`
	ingress.serverKeyPath = `${directory}/umbrel.key`
})

afterEach(async () => {
	for (const socket of sockets) socket.destroy()
	await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
	vi.useRealTimers()
})
afterAll(async () => fs.rm(directory, {recursive: true, force: true}))

async function setup(enableNativeTls = true) {
	const handler: http.RequestListener = async (request, response) => {
		const chunks = []
		for await (const chunk of request) chunks.push(chunk)
		response.end(`${request.socket instanceof tls.TLSSocket ? 'native' : 'http'}:${Buffer.concat(chunks)}`)
	}
	const httpBackend = http.createServer(handler)
	httpsBackend = https.createServer({cert: nativeCert, key: nativeKey}, handler)
	const ws = new WebSocketServer({noServer: true})
	ws.on('connection', (socket) => socket.on('message', (message) => socket.send(message)))
	for (const server of [httpBackend, httpsBackend]) {
		server.on('upgrade', (request, socket, head) =>
			ws.handleUpgrade(request, socket, head, (peer) => ws.emit('connection', peer)),
		)
	}
	const httpPort = await listen(httpBackend)
	const tlsPort = await listen(httpsBackend)
	backendPort = await listen(
		net.createServer((socket) => {
			socket.once('data', (chunk) => {
				socket.pause()
				forwardTcp(socket, [chunk], chunk[0] === 0x16 ? tlsPort : httpPort)
			})
		}),
	)
	const proxy = await ingress.createHttpsProxyServer(backendPort, {includeForwardedFor: false})
	await listen(proxy)
	muxPort = await listen(
		ingress.createMuxServer({
			listenPort: 0,
			httpPort: backendPort,
			getHttpsProxyServer: () => proxy,
			nativeTls: enableNativeTls ? {hostnameSuffixes: ['plex.direct'], reservedHostnames: ['umbrel.local']} : undefined,
		}),
	)
}

function request(servername: string, ca: Buffer, body = '') {
	return new Promise<string>((resolve, reject) => {
		const req = https.request(
			{hostname: '127.0.0.1', port: muxPort, servername, ca, method: 'POST', agent: false},
			(response) => {
				const chunks: Buffer[] = []
				response.on('data', (chunk) => chunks.push(chunk))
				response.on('end', () => resolve(Buffer.concat(chunks).toString()))
				response.on('error', reject)
			},
		)
		req.on('error', reject)
		req.end(body)
	})
}

test('verifies the native certificate for declared SNI and Umbrel certificate for Umbrel SNI', async () => {
	await setup()
	expect(await request(hostname, nativeCert, 'payload')).toBe('native:payload')
	expect(await request('umbrel.local', umbrelCert, 'payload')).toBe('http:payload')
	const body = 'post-body'.repeat(128 * 1024)
	expect(await (await fetch(`http://127.0.0.1:${muxPort}`, {method: 'POST', body})).text()).toBe(`http:${body}`)
}, 10_000)

test.each([
	{servername: 'unknown.example', enableNativeTls: true},
	{servername: '', enableNativeTls: true},
	{servername: hostname, enableNativeTls: false},
])(
	'keeps Umbrel TLS for SNI "$servername" with native TLS enabled: $enableNativeTls',
	async ({servername, enableNativeTls}) => {
		await setup(enableNativeTls)
		const socket = tls.connect({
			host: '127.0.0.1',
			port: muxPort,
			servername,
			ca: umbrelCert,
			checkServerIdentity: (_name, cert) => tls.checkServerIdentity('umbrel.local', cert),
		})
		await once(socket, 'secureConnect')
		expect(socket.authorized).toBe(true)
		expect(socket.getPeerCertificate().subject.CN).toBe('umbrel.local')
		socket.destroy()
	},
	5000,
)

test.each(['ws', 'native-wss', 'umbrel-wss'])(
	'%s carries bidirectional WebSocket frames',
	async (mode) => {
		await setup()
		const options: tls.ConnectionOptions = {
			servername: mode === 'native-wss' ? hostname : 'umbrel.local',
			ca: mode === 'native-wss' ? nativeCert : umbrelCert,
		}
		const socket = new WebSocket(`${mode === 'ws' ? 'ws' : 'wss'}://127.0.0.1:${muxPort}`, options)
		await once(socket, 'open')
		for (const body of ['hello', 'frame'.repeat(32 * 1024)]) {
			const reply = once(socket, 'message')
			socket.send(body)
			expect((await reply)[0].toString()).toBe(body)
		}
		socket.terminate()
	},
	10_000,
)

test('shares the pending limit across listeners and recovers after cancellation', async () => {
	const results: Promise<unknown>[] = []
	let accepted = 0
	const accept = (socket: net.Socket) => {
		accepted++
		results.push(readNativeTlsPrelude(socket).catch(() => socket.destroy()))
	}
	const ports = await Promise.all([listen(net.createServer(accept)), listen(net.createServer(accept))])
	const clients = Array.from({length: MAX_PENDING_NATIVE_TLS_CONNECTIONS}, (_, index) =>
		net.createConnection({host: '127.0.0.1', port: ports[index % ports.length]}),
	)
	await vi.waitFor(() => expect(accepted).toBe(MAX_PENDING_NATIVE_TLS_CONNECTIONS))
	for (const port of ports) {
		const extra = net.createConnection({host: '127.0.0.1', port})
		await once(extra, 'close')
	}
	for (const client of clients) client.destroy()
	await Promise.all(results)
	for (const port of ports) {
		const expectedCount = results.length + 1
		const acceptedAgain = net.createConnection({host: '127.0.0.1', port})
		acceptedAgain.write('GET / HTTP/1.0\r\n\r\n')
		await vi.waitFor(() => expect(results).toHaveLength(expectedCount))
		const result = (await results.at(-1)) as Awaited<ReturnType<typeof readNativeTlsPrelude>>
		expect(result.tls).toBe(false)
		result.release()
		acceptedAgain.destroy()
	}
}, 10_000)
