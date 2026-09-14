import {mkdtemp, rm} from 'node:fs/promises'
import net from 'node:net'
import {tmpdir} from 'node:os'
import nodePath from 'node:path'

import {afterEach, expect, test} from 'vitest'

import RfbClient, {POINTER_BUTTON_LEFT} from './rfb-client.js'

// A scripted QEMU-like VNC server over a unix socket: it performs the 3.8
// handshake, records every client message, and answers framebuffer requests
// from a queue of canned updates.

type ClientMessage = {type: number; payload: Buffer}
type ServerScript = {
	width: number
	height: number
	securityTypes?: number[]
	rejectReason?: string
	updates?: Buffer[]
	hangOnUpdate?: boolean
	dropOnUpdate?: boolean
}

class ByteReader {
	#chunks: Buffer[] = []
	#available = 0
	#waiting?: {length: number; resolve: (buffer: Buffer) => void; reject: (error: Error) => void}
	#failure?: Error

	push(chunk: Buffer) {
		this.#chunks.push(chunk)
		this.#available += chunk.length
		this.#flush()
	}

	fail(error: Error) {
		this.#failure = error
		this.#waiting?.reject(error)
		this.#waiting = undefined
	}

	read(length: number) {
		return new Promise<Buffer>((resolve, reject) => {
			if (this.#failure) return reject(this.#failure)
			this.#waiting = {length, resolve, reject}
			this.#flush()
		})
	}

	#flush() {
		const waiting = this.#waiting
		if (!waiting || this.#available < waiting.length) return
		this.#waiting = undefined
		const buffer = Buffer.concat(this.#chunks, this.#available)
		this.#chunks = [buffer.subarray(waiting.length)]
		this.#available = this.#chunks[0]!.length
		waiting.resolve(buffer.subarray(0, waiting.length))
	}
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
	await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

function u16(value: number) {
	const buffer = Buffer.alloc(2)
	buffer.writeUInt16BE(value)
	return buffer
}

function i32(value: number) {
	const buffer = Buffer.alloc(4)
	buffer.writeInt32BE(value)
	return buffer
}

function rawRectangle(x: number, y: number, width: number, height: number, bgr: [number, number, number]) {
	const pixels = Buffer.alloc(width * height * 4)
	for (let index = 0; index < width * height; index++) pixels.set([...bgr, 0], index * 4)
	return Buffer.concat([u16(x), u16(y), u16(width), u16(height), i32(0), pixels])
}

function desktopSizeRectangle(width: number, height: number) {
	return Buffer.concat([u16(0), u16(0), u16(width), u16(height), i32(-223)])
}

function framebufferUpdate(rectangles: Buffer[]) {
	return Buffer.concat([Buffer.from([0, 0]), u16(rectangles.length), ...rectangles])
}

async function startServer(script: ServerScript) {
	const directory = await mkdtemp(nodePath.join(tmpdir(), 'rfb-'))
	const socketPath = nodePath.join(directory, 'display.sock')
	const messages: ClientMessage[] = []
	const updates = [...(script.updates ?? [])]
	const server = net.createServer((socket) => {
		const reader = new ByteReader()
		socket.on('data', (chunk) => reader.push(chunk))
		socket.on('close', () => reader.fail(new Error('closed')))
		socket.on('error', () => {})
		void (async () => {
			socket.write('RFB 003.008\n', 'latin1')
			await reader.read(12)
			if (script.rejectReason) {
				const reason = Buffer.from(script.rejectReason, 'latin1')
				socket.write(Buffer.concat([Buffer.from([0]), i32(reason.length), reason]))
				return
			}
			const securityTypes = script.securityTypes ?? [1]
			socket.write(Buffer.from([securityTypes.length, ...securityTypes]))
			await reader.read(1)
			socket.write(i32(0))
			await reader.read(1)
			const name = Buffer.from('QEMU (umbrel-machine-test)', 'latin1')
			socket.write(Buffer.concat([u16(script.width), u16(script.height), Buffer.alloc(16), i32(name.length), name]))
			for (;;) {
				const type = (await reader.read(1)).readUInt8(0)
				const lengths: Record<number, number> = {0: 19, 3: 9, 4: 7, 5: 5}
				let payload: Buffer
				if (type === 2) {
					const header = await reader.read(3)
					payload = Buffer.concat([header, await reader.read(header.readUInt16BE(1) * 4)])
				} else {
					payload = await reader.read(lengths[type]!)
				}
				messages.push({type, payload})
				if (type === 3) {
					if (script.dropOnUpdate) return socket.destroy()
					if (script.hangOnUpdate) continue
					const update = updates.shift()
					if (update) socket.write(update)
				}
			}
		})().catch(() => {})
	})
	await new Promise<void>((resolve) => server.listen(socketPath, resolve))
	cleanups.push(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()))
		await rm(directory, {recursive: true, force: true})
	})
	return {socketPath, messages}
}

test('negotiates a shared session, a BGRX pixel format, and raw plus desktop-size encodings', async () => {
	const {socketPath, messages} = await startServer({width: 640, height: 480})
	const client = await RfbClient.connect(socketPath)
	cleanups.push(async () => client.close())
	expect(client.width).toBe(640)
	expect(client.height).toBe(480)

	await client.keyEvent(0x61, true)
	await client.keyEvent(0x61, false)
	await client.pointerEvent(10, 20, POINTER_BUTTON_LEFT)
	// Coordinates never leave the framebuffer, even when a caller overshoots
	await client.pointerEvent(10_000, -5, 0)
	await new Promise((resolve) => setTimeout(resolve, 50))

	const [pixelFormat, encodings, keyDown, keyUp, pointer, clampedPointer] = messages
	expect(pixelFormat).toMatchObject({type: 0})
	// bits-per-pixel, depth, big-endian, true-colour, then maxima and shifts
	expect([...pixelFormat!.payload.subarray(3, 19)]).toStrictEqual([
		32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0,
	])
	expect(encodings).toMatchObject({type: 2})
	expect(encodings!.payload.readUInt16BE(1)).toBe(2)
	expect(encodings!.payload.readInt32BE(3)).toBe(0)
	expect(encodings!.payload.readInt32BE(7)).toBe(-223)
	expect([...keyDown!.payload]).toStrictEqual([1, 0, 0, 0, 0, 0, 0x61])
	expect([...keyUp!.payload]).toStrictEqual([0, 0, 0, 0, 0, 0, 0x61])
	expect([...pointer!.payload]).toStrictEqual([POINTER_BUTTON_LEFT, 0, 10, 0, 20])
	expect([...clampedPointer!.payload]).toStrictEqual([0, 0x02, 0x7f, 0, 0])
})

test('captures a full frame from raw rectangles and converts BGRX into packed RGB', async () => {
	const {socketPath, messages} = await startServer({
		width: 3,
		height: 2,
		updates: [framebufferUpdate([rawRectangle(0, 0, 3, 1, [1, 2, 3]), rawRectangle(1, 1, 2, 1, [4, 5, 6])])],
	})
	const client = await RfbClient.connect(socketPath)
	cleanups.push(async () => client.close())

	const frame = await client.captureFramebuffer()
	expect(frame).toMatchObject({width: 3, height: 2})
	expect([...frame.rgb]).toStrictEqual([3, 2, 1, 3, 2, 1, 3, 2, 1, 0, 0, 0, 6, 5, 4, 6, 5, 4])
	const request = messages.find((message) => message.type === 3)
	// A non-incremental request for the whole framebuffer
	expect([...request!.payload]).toStrictEqual([0, 0, 0, 0, 0, 0, 3, 0, 2])
})

test('restarts a capture at the new size when the guest changes resolution', async () => {
	const {socketPath, messages} = await startServer({
		width: 3,
		height: 2,
		updates: [
			framebufferUpdate([desktopSizeRectangle(2, 2)]),
			framebufferUpdate([rawRectangle(0, 0, 2, 2, [9, 8, 7])]),
		],
	})
	const client = await RfbClient.connect(socketPath)
	cleanups.push(async () => client.close())

	const frame = await client.captureFramebuffer()
	expect(client.width).toBe(2)
	expect(client.height).toBe(2)
	expect(frame.rgb).toHaveLength(12)
	expect([...frame.rgb.subarray(0, 3)]).toStrictEqual([7, 8, 9])
	const requests = messages.filter((message) => message.type === 3)
	expect(requests).toHaveLength(2)
	expect([...requests[1]!.payload.subarray(5)]).toStrictEqual([0, 2, 0, 2])
})

test('surfaces rejected, unsupported, timed out, and dropped connections as machine errors', async () => {
	const rejected = await startServer({width: 1, height: 1, rejectReason: 'Too many clients'})
	await expect(RfbClient.connect(rejected.socketPath)).rejects.toThrow('[machine-display-rejected] Too many clients')

	const authenticated = await startServer({width: 1, height: 1, securityTypes: [2]})
	await expect(RfbClient.connect(authenticated.socketPath)).rejects.toThrow('[machine-display-unsupported]')

	const hanging = await startServer({width: 1, height: 1, hangOnUpdate: true})
	const slowClient = await RfbClient.connect(hanging.socketPath, {timeoutMs: 100})
	cleanups.push(async () => slowClient.close())
	await expect(slowClient.captureFramebuffer()).rejects.toThrow('[machine-display-timeout]')

	const dropping = await startServer({width: 1, height: 1, dropOnUpdate: true})
	const droppedClient = await RfbClient.connect(dropping.socketPath)
	cleanups.push(async () => droppedClient.close())
	await expect(droppedClient.captureFramebuffer()).rejects.toThrow('[machine-display-closed]')
	await expect(droppedClient.keyEvent(0x61, true)).rejects.toThrow('[machine-display-closed]')
})
