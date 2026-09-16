import type net from 'node:net'
import {PassThrough} from 'node:stream'

import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import {
	MAX_PENDING_NATIVE_TLS_CONNECTIONS,
	NATIVE_TLS_PREREAD_TIMEOUT,
	readNativeTlsPrelude,
} from './native-tls-preread.js'

const peers = new Set<PassThrough>()
const hostname = '192-168-1-100.server-id.plex.direct'

// The wrapper only uses Duplex stream behavior. A real PassThrough preserves
// pause, end, error and asynchronous close semantics while letting each write
// deterministically represent one TCP read, including a large coalesced tail.
function accept() {
	const peer = new PassThrough()
	peers.add(peer)
	peer.on('error', () => {})
	return {peer, prelude: readNativeTlsPrelude(peer as unknown as net.Socket)}
}

function uint16(value: number) {
	const bytes = Buffer.alloc(2)
	bytes.writeUInt16BE(value)
	return bytes
}

function clientHello() {
	const name = Buffer.from(hostname)
	const serverName = Buffer.concat([Buffer.from([0]), uint16(name.length), name])
	const names = Buffer.concat([uint16(serverName.length), serverName])
	const extension = Buffer.concat([uint16(0), uint16(names.length), names])
	const body = Buffer.concat([
		Buffer.from([3, 3]),
		Buffer.alloc(32),
		Buffer.from([0, 0, 2, 0x13, 1, 1, 0]),
		uint16(extension.length),
		extension,
	])
	const handshakeHeader = Buffer.alloc(4)
	handshakeHeader[0] = 1
	handshakeHeader.writeUIntBE(body.length, 1, 3)
	return Buffer.concat([Buffer.from([22, 3, 1]), uint16(body.length + 4), handshakeHeader, body])
}

// Exercise the whole allowance after cleanup rather than inspecting private
// counters. Check both leaked slots and accidental double-release underflow.
async function expectAllSlotsAvailable() {
	const connections = Array.from({length: MAX_PENDING_NATIVE_TLS_CONNECTIONS}, accept)
	const results = Promise.all(connections.map(({prelude}) => prelude))
	for (const {peer} of connections) peer.write('GET / HTTP/1.1\r\n\r\n')
	const classified = await results
	const overflow = accept()
	await expect(overflow.prelude).rejects.toThrow('connection limit reached')
	for (const result of classified) result.release()
	for (const {peer} of connections) peer.destroy()
}

beforeEach(() => {
	// Keep stream nextTick/immediate work real; advance only the preread clock.
	vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
})

afterEach(async () => {
	for (const peer of peers) peer.destroy()
	await new Promise<void>((resolve) => setImmediate(resolve))
	peers.clear()
	const remainingTimers = vi.getTimerCount()
	vi.useRealTimers()
	expect(remainingTimers).toBe(0)
})

test('uses an absolute deadline even while ClientHello bytes continue arriving', async () => {
	const {peer, prelude} = accept()
	let settled = false
	void prelude.then(
		() => (settled = true),
		() => (settled = true),
	)
	const rejected = expect(prelude).rejects.toThrow('Native TLS preread timed out')
	const wire = clientHello()
	peer.write(wire.subarray(0, 1))
	for (let offset = 1; offset < 5; offset++) {
		await vi.advanceTimersByTimeAsync(NATIVE_TLS_PREREAD_TIMEOUT / 5)
		peer.write(wire.subarray(offset, offset + 1))
	}
	await vi.advanceTimersByTimeAsync(NATIVE_TLS_PREREAD_TIMEOUT / 5 - 1)
	expect(settled).toBe(false)
	await vi.advanceTimersByTimeAsync(1)
	await rejected
	peer.destroy()
	await expectAllSlotsAvailable()
})

test.each(['silent timeout', 'EOF', 'close', 'error'] as const)(
	'%s releases an unclassified connection',
	async (cause) => {
		const {peer, prelude} = accept()
		const rejected = expect(prelude).rejects.toThrow(
			cause === 'silent timeout' ? 'timed out' : cause === 'error' ? 'peer failed' : 'Incomplete native TLS prelude',
		)
		if (cause === 'silent timeout') await vi.advanceTimersByTimeAsync(NATIVE_TLS_PREREAD_TIMEOUT)
		else if (cause === 'EOF') peer.end(Buffer.from([22, 3]))
		else if (cause === 'close') peer.destroy()
		else peer.destroy(new Error('peer failed'))
		await rejected
		peer.destroy()
		await expectAllSlotsAvailable()
	},
)

test('replays fragmented reads and a coalesced tail larger than the handshake limit verbatim', async () => {
	const {peer, prelude} = accept()
	const wire = clientHello()
	const tail = Buffer.alloc(256 * 1024)
	for (let offset = 0; offset < tail.length; offset++) tail[offset] = offset & 0xff
	const finalRead = Buffer.concat([wire.subarray(-1), tail])
	peer.write(wire.subarray(0, 1))
	peer.write(wire.subarray(1, 2))
	peer.write(wire.subarray(2, -1))
	peer.write(finalRead)
	const result = await prelude
	expect(result.tls).toBe(true)
	expect(result.hostname).toBe(hostname)
	expect(Buffer.concat(result.chunks)).toEqual(Buffer.concat([wire, tail]))
	result.release()
	result.release()
	peer.destroy()
	await expectAllSlotsAvailable()
})

test('keeps classified connections reserved until caller release, which is idempotent', async () => {
	const connections = Array.from({length: MAX_PENDING_NATIVE_TLS_CONNECTIONS}, accept)
	const results = Promise.all(connections.map(({prelude}) => prelude))
	for (const {peer} of connections) peer.write('GET / HTTP/1.1\r\n\r\n')
	const classified = await results
	const full = accept()
	await expect(full.prelude).rejects.toThrow('connection limit reached')
	classified[0].release()
	classified[0].release()
	const replacement = accept()
	replacement.peer.write(clientHello())
	const replaced = await replacement.prelude
	expect(replaced.hostname).toBe(hostname)
	const stillFull = accept()
	await expect(stillFull.prelude).rejects.toThrow('connection limit reached')
	for (const result of classified) result.release()
	replaced.release()
	await expectAllSlotsAvailable()
})

test('caller closure releases a classified connection even before buffered bytes are handed off', async () => {
	const {peer, prelude} = accept()
	peer.write(clientHello())
	const classified = await prelude
	peer.destroy()
	await new Promise<void>((resolve) => setImmediate(resolve))
	// Releasing again after close must not subtract another connection or its
	// memory from the process-wide accounting.
	classified.release()
	await expectAllSlotsAvailable()
})

test('repeated malformed handshakes and successful releases do not leak slots or retained-byte budget', async () => {
	const malformed = clientHello()
	malformed[5] = 2
	const validWithTail = Buffer.concat([clientHello(), Buffer.alloc(256 * 1024)])
	// More than the connection allowance, and more than 32 MiB of cumulative
	// reserved buffers, so either kind of leak eventually breaks this loop.
	for (let iteration = 0; iteration < MAX_PENDING_NATIVE_TLS_CONNECTIONS + 8; iteration++) {
		const invalid = accept()
		const rejected = expect(invalid.prelude).rejects.toThrow('first handshake is not ClientHello')
		invalid.peer.write(malformed)
		await rejected
		invalid.peer.destroy()
		const valid = accept()
		valid.peer.write(validWithTail)
		const result = await valid.prelude
		expect(result.hostname).toBe(hostname)
		result.release()
		valid.peer.destroy()
	}
	await expectAllSlotsAvailable()
})

test('accounts the retained backing allocation of a small final read and recovers after rejection', async () => {
	const {peer, prelude} = accept()
	const rejected = expect(prelude).rejects.toThrow('memory limit reached')
	const allocation = Buffer.allocUnsafeSlow(33 * 1024 * 1024)
	const wire = clientHello()
	wire.copy(allocation)
	peer.write(allocation.subarray(0, wire.length))
	await rejected
	peer.destroy()
	await expectAllSlotsAvailable()
})
