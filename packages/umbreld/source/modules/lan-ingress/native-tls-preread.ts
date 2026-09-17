import type net from 'node:net'

import {ClientHelloReader, CLIENT_HELLO_READER_BUFFER_BYTES, MAX_CLIENT_HELLO_WIRE_BYTES} from './tls-client-hello.js'

export const NATIVE_TLS_PREREAD_TIMEOUT = 5000
export const MAX_PENDING_NATIVE_TLS_CONNECTIONS = 128
const MAX_PREREAD_MEMORY_BYTES = 32 * 1024 * 1024
let pendingConnections = 0
let retainedBytes = 0

type Prelude = {tls: boolean; hostname?: string; chunks: Buffer[]; release: () => void}

// These process-wide budgets include silent clients and connections waiting to
// hand their buffered bytes to an upstream. Ordinary app routes do not use them.
export function readNativeTlsPrelude(socket: net.Socket): Promise<Prelude> {
	return new Promise((resolve, reject) => {
		if (pendingConnections >= MAX_PENDING_NATIVE_TLS_CONNECTIONS) {
			reject(new Error('Native TLS preread connection limit reached'))
			return
		}
		pendingConnections++
		let ownedBytes = 0
		let released = false
		let wire: Buffer | undefined
		let length = 0
		let reader: ClientHelloReader | undefined
		let isTls: boolean | undefined
		const reserve = (bytes: number) => {
			if (retainedBytes + bytes > MAX_PREREAD_MEMORY_BYTES) throw new Error('Native TLS preread memory limit reached')
			retainedBytes += bytes
			ownedBytes += bytes
		}
		const release = () => {
			if (released) return
			released = true
			pendingConnections--
			retainedBytes -= ownedBytes
			wire = undefined
			reader = undefined
			socket.off('close', release)
		}
		const detach = () => {
			clearTimeout(deadline)
			socket.off('data', onData)
			socket.off('error', fail)
			socket.off('end', incomplete)
			socket.off('close', incomplete)
		}
		const fail = (error: Error) => {
			detach()
			release()
			reject(error)
		}
		const incomplete = () => fail(new Error('Incomplete native TLS prelude'))
		const finish = (chunk: Buffer, hostname?: string) => {
			// Retain the final read verbatim, including any coalesced bytes after
			// ClientHello. Account its backing allocation, not just the slice.
			reserve(chunk.buffer.byteLength)
			socket.pause()
			detach()
			const chunks = length ? [wire!.subarray(0, length), chunk] : [chunk]
			reader = undefined
			resolve({tls: isTls!, hostname, chunks, release})
		}
		const onData = (chunk: Buffer) => {
			try {
				if (!wire) {
					reserve(MAX_CLIENT_HELLO_WIRE_BYTES)
					wire = Buffer.allocUnsafeSlow(MAX_CLIENT_HELLO_WIRE_BYTES)
				}
				if (isTls === undefined && length + chunk.length >= 3) {
					const first = length ? wire[0] : chunk[0]
					const second = length > 1 ? wire[1] : chunk[1 - length]
					isTls = first === 0x16 && second === 0x03
					if (!isTls) return finish(chunk)
					reserve(CLIENT_HELLO_READER_BUFFER_BYTES)
					reader = new ClientHelloReader()
					if (length) reader.push(wire.subarray(0, length))
				}
				const result = reader?.push(chunk)
				if (result) return finish(chunk, result.hostname)
				if (length + chunk.length > MAX_CLIENT_HELLO_WIRE_BYTES) throw new Error('Native TLS prelude too large')
				chunk.copy(wire, length)
				length += chunk.length
			} catch (error) {
				fail(error instanceof Error ? error : new Error('Invalid native TLS prelude'))
			}
		}
		// An absolute deadline: a peer cannot keep a slot by trickling bytes.
		const deadline = setTimeout(() => fail(new Error('Native TLS preread timed out')), NATIVE_TLS_PREREAD_TIMEOUT)
		deadline.unref()
		socket.once('close', release)
		socket.once('close', incomplete)
		socket.once('end', incomplete)
		socket.once('error', fail)
		socket.on('data', onData)
	})
}
