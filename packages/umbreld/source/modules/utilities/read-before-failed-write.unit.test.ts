import {once} from 'node:events'
import net from 'node:net'
import {Worker} from 'node:worker_threads'

import {afterEach, expect, test} from 'vitest'

import readBeforeFailedWrite from './read-before-failed-write.ts'

// Small enough for the kernel to take whole, so that each write is tried at once
const chunk = Buffer.alloc(16 * 1024, 'request')
const workers: Worker[] = []

afterEach(async () => {
	await Promise.all(workers.splice(0).map((worker) => worker.terminate()))
})

// Writes to a server that has answered a request and closed without reading all
// of it, before reading that answer, and returns what the socket then yields.
// The server runs on another thread so that this one can leave the answer
// unread while it arrives, as a busy event loop does.
async function writeToServerThatHasAnswered(prepare: (socket: net.Socket) => void, unread: 'start' | 'rest') {
	const closed = new Int32Array(new SharedArrayBuffer(4))
	const worker = new Worker(
		`const {parentPort, workerData} = require('node:worker_threads')
		const server = require('node:net').createServer((socket) => {
			socket.on('error', () => {})
			socket.write('answer')
			// Closing with the start of the request unread resets the connection
			// straight away. Closing after reading it does when the rest arrives.
			if (workerData.unread === 'rest') socket.resume()
			socket.once('close', () => {
				Atomics.store(workerData.closed, 0, 1)
				Atomics.notify(workerData.closed, 0)
			})
			setTimeout(() => socket.destroy(), 100)
		})
		server.listen(0, '127.0.0.1', () => parentPort.postMessage(server.address().port))`,
		{eval: true, workerData: {unread, closed}},
	)
	workers.push(worker)
	const [port] = (await once(worker, 'message')) as [number]
	const socket = net.connect({host: '127.0.0.1', port})
	await once(socket, 'connect')
	prepare(socket)

	let received = ''
	const outcome = new Promise<{received: string; error?: NodeJS.ErrnoException}>((resolve) => {
		let error: NodeJS.ErrnoException | undefined
		socket.on('data', (data: Buffer) => (received += data))
		socket.once('error', (failure) => (error = failure))
		socket.once('close', () => resolve({received, error}))
	})
	socket.write(chunk)
	// Block this thread until the server has answered and closed, and then for
	// as long again as it took to do so
	Atomics.wait(closed, 0, 0, 10_000)
	Atomics.wait(closed, 0, 1, 100)
	// The first write after the server has closed can still be accepted
	for (let count = 0; count < 4; count++) socket.write(chunk)
	return outcome
}

// The reason readBeforeFailedWrite() exists. If this starts failing, Node has
// learned to read what arrived before a write failed and the helper can go.
// Only where umbreld runs: a failed write isn't reported the same way elsewhere.
test.runIf(process.platform === 'linux').each(['start', 'rest'] as const)(
	'Node discards an unread answer when a write fails (server leaves the %s of the request unread)',
	async (unread) => {
		const {received, error} = await writeToServerThatHasAnswered(() => {}, unread)
		expect(received).toBe('')
		expect(error?.syscall).toBe('write')
	},
)

test.each(['start', 'rest'] as const)(
	'reads the answer a server sent before a write to it failed (server leaves the %s of the request unread)',
	async (unread) => {
		const {received, error} = await writeToServerThatHasAnswered(readBeforeFailedWrite, unread)
		expect(received).toBe('answer')
		// How the connection ended is for the read side to say, never the write
		expect(error?.syscall).not.toBe('write')
	},
)
