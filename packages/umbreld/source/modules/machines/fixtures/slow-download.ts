import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import dns from 'node:dns/promises'
import {once} from 'node:events'
import fsp from 'node:fs/promises'
import http from 'node:http'
import {syncBuiltinESMExports} from 'node:module'
import net, {type AddressInfo} from 'node:net'
import os from 'node:os'
import nodePath from 'node:path'

import {execa} from 'execa'

import {createPinnedLookup, safeDownload} from '../safe-download.ts'

// This process runs in its own network namespace. The public fixture addresses
// exercise the downloader's real validation and pinned lookup without Internet
// access. Only the IPv4 addresses exist in this namespace.
assert.notEqual(await fsp.readlink('/proc/self/ns/net'), await fsp.readlink(`/proc/${process.ppid}/ns/net`))
const addresses = [
	{address: '1.1.1.1', family: 4},
	{address: '1.0.0.1', family: 4},
	{address: '2606:4700:4700::1111', family: 6},
	{address: '2606:4700:4700::1001', family: 6},
]
dns.lookup = (async () => addresses) as unknown as typeof dns.lookup
syncBuiltinESMExports()
await execa('ip', ['link', 'set', 'lo', 'up'])
for (const {address, family} of addresses) {
	if (family === 4) await execa('ip', ['address', 'add', `${address}/32`, 'dev', 'lo'])
}
// Delay SYN and SYN-ACK by 200 ms each, making the TCP handshake exceed 250 ms.
await execa('tc', ['qdisc', 'add', 'dev', 'lo', 'root', 'netem', 'delay', '200ms'])

const contents = 'slow machine image fixture'
const expectedSha256 = createHash('sha256').update(contents).digest('hex')
const directory = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'slow-machine-download-'))
const server = http.createServer((request, response) => {
	if (request.url === '/redirect') {
		response.writeHead(302, {location: `http://mirror.test:${port}/image`})
		response.end()
	} else {
		response.writeHead(200, {'content-length': Buffer.byteLength(contents)})
		response.end(contents)
	}
})
server.listen(0, '0.0.0.0')
await once(server, 'listening')
const port = (server.address() as AddressInfo).port
const url = `http://download.test:${port}${process.argv[2]}`

try {
	// Prove the fixture reproduces the original failure before exercising the
	// downloader. A working IPv4 address must not be the final candidate.
	let defaultFailureCodes: string[] = []
	await assert.rejects(
		new Promise<void>((resolve, reject) => {
			const socket = net.connect({
				host: 'download.test',
				port,
				autoSelectFamily: true,
				autoSelectFamilyAttemptTimeout: 250,
				lookup: createPinnedLookup(addresses),
				signal: AbortSignal.timeout(10_000),
			})
			socket.on('connect', () => {
				socket.destroy()
				resolve()
			})
			socket.on('error', reject)
		}),
		(error: unknown) => {
			assert(error instanceof AggregateError)
			defaultFailureCodes = error.errors.map(({code}) => code)
			return true
		},
	)

	const destination = nodePath.join(directory, 'image.qcow2')
	const result = await safeDownload({url, destination, expectedSha256, signal: AbortSignal.timeout(10_000)})
	assert.deepEqual(result, {sha256: expectedSha256, size: Buffer.byteLength(contents)})
	console.log(
		JSON.stringify({
			defaultFailureCodes,
			contents: await fsp.readFile(destination, 'utf8'),
			files: await fsp.readdir(directory),
		}),
	)
} finally {
	server.closeAllConnections()
	await new Promise<void>((resolve) => server.close(() => resolve()))
	await fsp.rm(directory, {recursive: true, force: true})
}
