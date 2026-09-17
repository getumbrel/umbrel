import net from 'node:net'
import tls from 'node:tls'

import {describe, expect, test} from 'vitest'

import {ClientHelloReader, MAX_CLIENT_HELLO_WIRE_BYTES} from './tls-client-hello.js'

const hostname = '192-168-1-100.server-id.plex.direct'

function uint16(value: number) {
	const bytes = Buffer.alloc(2)
	bytes.writeUInt16BE(value)
	return bytes
}

function extension(type: number, data: Buffer) {
	return Buffer.concat([uint16(type), uint16(data.length), data])
}

function serverName(name = Buffer.from(hostname), type = 0) {
	return Buffer.concat([Buffer.from([type]), uint16(name.length), name])
}

function sni(...names: Buffer[]) {
	const list = Buffer.concat(names.length ? names : [serverName()])
	return extension(0, Buffer.concat([uint16(list.length), list]))
}

function hello({
	extensions = [sni()],
	sessionId = Buffer.alloc(0),
	cipherSuites = Buffer.from([0x13, 1]),
	compressionMethods = Buffer.from([0]),
}: {
	extensions?: Buffer[] | null
	sessionId?: Buffer
	cipherSuites?: Buffer
	compressionMethods?: Buffer
} = {}) {
	const extensionBytes = extensions === null ? null : Buffer.concat(extensions)
	const body = Buffer.concat([
		Buffer.from([3, 3]),
		Buffer.alloc(32),
		Buffer.from([sessionId.length]),
		sessionId,
		uint16(cipherSuites.length),
		cipherSuites,
		Buffer.from([compressionMethods.length]),
		compressionMethods,
		...(extensionBytes ? [uint16(extensionBytes.length), extensionBytes] : []),
	])
	const header = Buffer.alloc(4)
	header[0] = 1
	header.writeUIntBE(body.length, 1, 3)
	return Buffer.concat([header, body])
}

function record(data: Buffer, {type = 22, major = 3, minor = 1, length = data.length} = {}) {
	return Buffer.concat([Buffer.from([type, major, minor]), uint16(length), data])
}

function records(data: Buffer, fragmentLength = 16384) {
	const fragments: Buffer[] = []
	for (let offset = 0; offset < data.length; offset += fragmentLength) {
		fragments.push(record(data.subarray(offset, offset + fragmentLength)))
	}
	return Buffer.concat(fragments)
}

function paddedHello(length: number) {
	const base = hello({extensions: [sni(), extension(21, Buffer.alloc(0))]})
	return hello({extensions: [sni(), extension(21, Buffer.alloc(length - base.length))]})
}

// Capture real ClientHello bytes from Node/OpenSSL without terminating TLS or
// depending on the parser under test to decide where the message ends.
async function captureClientHello(version: 'TLSv1.2' | 'TLSv1.3', servername?: string) {
	const accepted = new Set<net.Socket>()
	let client: tls.TLSSocket | undefined
	let resolveBytes!: (bytes: Buffer) => void
	let rejectBytes!: (error: Error) => void
	const captured = new Promise<Buffer>((resolve, reject) => {
		resolveBytes = resolve
		rejectBytes = reject
	})
	const server = net.createServer((socket) => {
		accepted.add(socket)
		const chunks: Buffer[] = []
		let length = 0
		socket.on('data', (chunk) => {
			chunks.push(chunk)
			length += chunk.length
			const bytes = Buffer.concat(chunks, length)
			if (bytes.length >= 5 && bytes.length >= 5 + bytes.readUInt16BE(3)) resolveBytes(bytes)
		})
		socket.on('error', rejectBytes)
	})
	const deadline = setTimeout(() => rejectBytes(new Error('ClientHello capture timed out')), 5000)
	try {
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject)
			server.listen(0, '127.0.0.1', resolve)
		})
		client = tls.connect({
			host: '127.0.0.1',
			port: (server.address() as net.AddressInfo).port,
			servername,
			minVersion: version,
			maxVersion: version,
		})
		client.on('error', rejectBytes)
		return await captured
	} finally {
		clearTimeout(deadline)
		client?.destroy()
		for (const socket of accepted) socket.destroy()
		await new Promise<void>((resolve) => server.close(() => resolve()))
	}
}

describe('ClientHelloReader', () => {
	test.each(['TLSv1.2', 'TLSv1.3'] as const)('reads a real %s ClientHello', async (version) => {
		const wire = await captureClientHello(version, hostname)
		expect(new ClientHelloReader().push(wire)).toEqual({hostname})
		// Reframe the same real message so TLS record boundaries occur inside
		// fields and handshake headers, independently of OpenSSL's framing.
		const reframed = records(wire.subarray(5), 3)
		const reader = new ClientHelloReader()
		let result
		for (const byte of reframed) result = reader.push(Buffer.from([byte]))
		expect(result).toEqual({hostname})
	})

	test('reads a real ClientHello without SNI', async () => {
		const wire = await captureClientHello('TLSv1.3')
		expect(new ClientHelloReader().push(wire)).toEqual({hostname: undefined})
	})

	test('handles every TCP split and every TLS record split, including the handshake header', () => {
		const message = hello()
		const wire = record(message)
		for (let split = 0; split < wire.length; split++) {
			const reader = new ClientHelloReader()
			expect(reader.push(wire.subarray(0, split))).toBeUndefined()
			expect(reader.push(wire.subarray(split))).toEqual({hostname})
		}
		for (let split = 1; split < message.length; split++) {
			const fragmented = Buffer.concat([record(message.subarray(0, split)), record(message.subarray(split))])
			const reader = new ClientHelloReader()
			for (let offset = 0; offset < fragmented.length - 1; offset++) {
				expect(reader.push(fragmented.subarray(offset, offset + 1))).toBeUndefined()
			}
			expect(reader.push(fragmented.subarray(-1))).toEqual({hostname})
		}
	})

	test('waits for the complete hello instead of returning as soon as SNI is available', () => {
		const wire = record(hello({extensions: [sni(), extension(0xaaaa, Buffer.alloc(100))]}))
		const reader = new ClientHelloReader()
		expect(reader.push(wire.subarray(0, -1))).toBeUndefined()
		expect(reader.push(wire.subarray(-1))).toEqual({hostname})
	})

	test('allows absent/empty extensions, unfamiliar extensions and future SNI name types', () => {
		for (const message of [hello({extensions: null}), hello({extensions: []})]) {
			expect(new ClientHelloReader().push(record(message))).toEqual({hostname: undefined})
		}
		const message = hello({
			extensions: [extension(0xfe0d, Buffer.alloc(20, 0xff)), sni(serverName(Buffer.from('opaque'), 1), serverName())],
		})
		expect(new ClientHelloReader().push(record(message))?.hostname).toBe(hostname)
	})

	test('handles session IDs and opaque TLS 1.2 ticket/TLS 1.3 PSK resumption extensions', () => {
		for (const resumeExtension of [extension(35, Buffer.alloc(128)), extension(41, Buffer.alloc(128))]) {
			const message = hello({sessionId: Buffer.alloc(32), extensions: [sni(), resumeExtension]})
			expect(new ClientHelloReader().push(record(message))?.hostname).toBe(hostname)
		}
	})

	test('accepts unfamiliar record minor versions and preserves hostname case', () => {
		const message = hello({extensions: [sni(serverName(Buffer.from('Example.PLEX.direct')))]})
		expect(new ClientHelloReader().push(record(message, {minor: 0xff}))?.hostname).toBe('Example.PLEX.direct')
	})

	test('does not retain or modify input buffers', () => {
		const wire = record(hello())
		const reader = new ClientHelloReader()
		const prefix = Buffer.from(wire.subarray(0, -1))
		expect(reader.push(prefix)).toBeUndefined()
		expect(prefix).toEqual(wire.subarray(0, -1))
		prefix.fill(0xff)
		expect(reader.push(wire.subarray(-1))).toEqual({hostname})
	})

	test('stops at the hello even when a large tail shares its final record or TCP chunk', () => {
		const message = hello()
		for (const wire of [record(message), record(message, {length: message.length + 100})]) {
			const reader = new ClientHelloReader()
			const result = reader.push(Buffer.concat([wire, Buffer.alloc(1024 * 1024, 0xff)]))
			expect(result).toEqual({hostname})
		}
	})

	test('accepts exactly the wire budget and rejects the next byte, including record overhead', () => {
		// Four plaintext records contribute twenty framing bytes.
		const exact = records(paddedHello(MAX_CLIENT_HELLO_WIRE_BYTES - 20))
		expect(exact.length).toBe(MAX_CLIENT_HELLO_WIRE_BYTES)
		expect(new ClientHelloReader().push(Buffer.concat([exact, Buffer.alloc(100)]))).toEqual({hostname})
		const over = records(paddedHello(MAX_CLIENT_HELLO_WIRE_BYTES - 19))
		expect(over.length).toBe(MAX_CLIENT_HELLO_WIRE_BYTES + 1)
		expect(() => new ClientHelloReader().push(over)).toThrow('wire prefix exceeds limit')
		// A small body can also exhaust its budget through tiny TLS records.
		expect(() => new ClientHelloReader().push(records(paddedHello(12000), 1))).toThrow('wire prefix exceeds limit')
	})

	test.each([
		['non-handshake record', record(hello(), {type: 23})],
		['invalid record version', record(hello(), {major: 2})],
		['zero-length record', record(Buffer.alloc(0))],
		['oversized plaintext record', record(Buffer.alloc(0), {length: 16385})],
		['empty cipher suites', record(hello({cipherSuites: Buffer.alloc(0)}))],
		['odd cipher suites length', record(hello({cipherSuites: Buffer.from([0x13])}))],
		['oversized session ID', record(hello({sessionId: Buffer.alloc(33)}))],
		['empty compression methods', record(hello({compressionMethods: Buffer.alloc(0)}))],
		['truncated extension header', record(hello({extensions: [Buffer.from([0])]}))],
		['truncated extension payload', record(hello({extensions: [Buffer.from([0, 1, 0, 1])]}))],
		['duplicate SNI extensions', record(hello({extensions: [sni(), sni()]}))],
		[
			'duplicate unknown extensions',
			record(hello({extensions: [extension(1, Buffer.alloc(0)), extension(1, Buffer.alloc(0))]})),
		],
		['truncated SNI vector', record(hello({extensions: [extension(0, Buffer.from([0]))]}))],
		['empty SNI vector', record(hello({extensions: [extension(0, Buffer.from([0, 0]))]}))],
		['incorrect SNI vector length', record(hello({extensions: [extension(0, Buffer.from([0, 2, 0]))]}))],
		['truncated SNI entry', record(hello({extensions: [extension(0, Buffer.from([0, 1, 0]))]}))],
		['incorrect SNI hostname length', record(hello({extensions: [extension(0, Buffer.from([0, 3, 0, 0, 1]))]}))],
		['empty SNI hostname', record(hello({extensions: [sni(serverName(Buffer.alloc(0)))]}))],
		['duplicate hostnames', record(hello({extensions: [sni(serverName(), serverName())]}))],
		[
			'duplicate future name types',
			record(hello({extensions: [sni(serverName(Buffer.from('a'), 1), serverName(Buffer.from('b'), 1))]})),
		],
	] as const)('rejects %s', (_description, wire) => {
		expect(() => new ClientHelloReader().push(wire)).toThrow('Invalid TLS ClientHello')
	})

	test('rejects an invalid hostname decoded from SNI', () => {
		const name = Buffer.from('bad\u0000name.plex.direct')
		expect(() => new ClientHelloReader().push(record(hello({extensions: [sni(serverName(name))]})))).toThrow(
			'invalid hostname',
		)
	})

	test('rejects high-bit wire bytes instead of masking them into an allowed hostname', () => {
		const name = Buffer.from(hostname)
		name[0] |= 0x80
		expect(name.toString('ascii')).toBe(hostname)
		expect(() => new ClientHelloReader().push(record(hello({extensions: [sni(serverName(name))]})))).toThrow(
			'invalid hostname',
		)
	})

	test('rejects malformed fields after a valid SNI', () => {
		const wire = record(hello({extensions: [sni(), Buffer.from([0])]}))
		const reader = new ClientHelloReader()
		expect(() => reader.push(wire)).toThrow('Invalid TLS ClientHello')
	})

	test('checks declared handshake and outer vector lengths before classification', () => {
		const wrongType = hello()
		wrongType[0] = 2
		const tooShort = Buffer.from([1, 0, 0, 40])
		const tooLong = Buffer.from([1, 0xff, 0xff, 0xff])
		const wrongVersion = hello()
		wrongVersion[4] = 2
		const sessionLength = hello()
		sessionLength[38] = 32
		const extensionLength = hello()
		extensionLength.writeUInt16BE(extensionLength.readUInt16BE(45) - 1, 45)
		for (const message of [wrongType, tooShort, tooLong, wrongVersion, sessionLength, extensionLength]) {
			expect(() => new ClientHelloReader().push(record(message))).toThrow('Invalid TLS ClientHello')
		}
	})

	test('rejects interleaved non-handshake records', () => {
		const message = hello()
		const interleaved = Buffer.concat([record(message.subarray(0, 2)), record(message.subarray(2), {type: 20})])
		expect(() => new ClientHelloReader().push(interleaved)).toThrow('invalid handshake record')
	})

	test('classifies deterministic mutations of a real hello consistently across chunk boundaries', async () => {
		const original = await captureClientHello('TLSv1.3', hostname)
		let seed = 0x12345678
		const random = () => {
			seed ^= seed << 13
			seed ^= seed >>> 17
			seed ^= seed << 5
			return seed >>> 0
		}
		const read = (wire: Buffer, chunkLength: number) => {
			const reader = new ClientHelloReader()
			try {
				for (let offset = 0; offset < wire.length; offset += chunkLength) {
					const result = reader.push(wire.subarray(offset, offset + chunkLength))
					if (result) return result
				}
				return undefined
			} catch (error) {
				// Bounds checks must produce a controlled parser error, never an
				// out-of-range Buffer read or another incidental JavaScript error.
				expect(error).toBeInstanceOf(Error)
				expect((error as Error).message).toMatch(/^Invalid TLS ClientHello:/)
				return {error: (error as Error).message}
			}
		}
		for (let iteration = 0; iteration < 512; iteration++) {
			const wire = Buffer.from(original)
			for (let mutation = 0; mutation < 3; mutation++) wire[random() % wire.length] ^= 1 << random() % 8
			expect(read(wire, 1 + (random() % 17))).toEqual(read(wire, wire.length))
		}
	})
})
