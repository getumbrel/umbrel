import net from 'node:net'

// A deliberately small RFB (VNC) client for driving a machine's QEMU display
// socket from the host: keyboard and pointer events in, raw framebuffer out.
// It speaks the same protocol the browser console uses through noVNC, so
// QEMU applies identical keymap and pointer-device handling to both.

const PROTOCOL_VERSION = 'RFB 003.008\n'
const SECURITY_NONE = 1
const ENCODING_RAW = 0
const ENCODING_DESKTOP_SIZE = -223

const CLIENT_SET_PIXEL_FORMAT = 0
const CLIENT_SET_ENCODINGS = 2
const CLIENT_FRAMEBUFFER_UPDATE_REQUEST = 3
const CLIENT_KEY_EVENT = 4
const CLIENT_POINTER_EVENT = 5

const SERVER_FRAMEBUFFER_UPDATE = 0
const SERVER_SET_COLOUR_MAP_ENTRIES = 1
const SERVER_BELL = 2
const SERVER_CUT_TEXT = 3

// Requested from the server so every rectangle arrives as 32-bit BGRX pixels
const BYTES_PER_PIXEL = 4

export const POINTER_BUTTON_NONE = 0
export const POINTER_BUTTON_LEFT = 1
export const POINTER_BUTTON_MIDDLE = 2
export const POINTER_BUTTON_RIGHT = 4
export const POINTER_WHEEL_UP = 8
export const POINTER_WHEEL_DOWN = 16
export const POINTER_WHEEL_LEFT = 32
export const POINTER_WHEEL_RIGHT = 64

export type Framebuffer = {
	width: number
	height: number
	// Packed 8-bit RGB, row-major, no padding
	rgb: Buffer
}

export type RfbClientOptions = {
	// Bounds the connect handshake and each framebuffer capture
	timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 15_000

class Reader {
	#chunks: Buffer[] = []
	#available = 0
	#waiting?: {length: number; resolve: (buffer: Buffer) => void; reject: (error: Error) => void}
	#failure?: Error

	push(chunk: Buffer) {
		if (this.#failure) return
		this.#chunks.push(chunk)
		this.#available += chunk.length
		this.#flush()
	}

	fail(error: Error) {
		if (this.#failure) return
		this.#failure = error
		const waiting = this.#waiting
		this.#waiting = undefined
		waiting?.reject(error)
	}

	read(length: number) {
		return new Promise<Buffer>((resolve, reject) => {
			if (this.#failure) return reject(this.#failure)
			if (this.#waiting) return reject(new Error('RFB reader is busy'))
			this.#waiting = {length, resolve, reject}
			this.#flush()
		})
	}

	#flush() {
		const waiting = this.#waiting
		if (!waiting || this.#available < waiting.length) return
		this.#waiting = undefined
		const buffer = Buffer.concat(this.#chunks, this.#available)
		const result = buffer.subarray(0, waiting.length)
		const rest = buffer.subarray(waiting.length)
		this.#chunks = rest.length > 0 ? [rest] : []
		this.#available = rest.length
		waiting.resolve(result)
	}
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, what: string) {
	let timer: NodeJS.Timeout | undefined
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`[machine-display-timeout] ${what} timed out`)), timeoutMs)
	})
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export default class RfbClient {
	#socket: net.Socket
	#reader: Reader
	#timeoutMs: number
	#framebuffer: Buffer
	#closed = false
	width: number
	height: number

	private constructor(socket: net.Socket, reader: Reader, width: number, height: number, timeoutMs: number) {
		this.#socket = socket
		this.#reader = reader
		this.#timeoutMs = timeoutMs
		this.width = width
		this.height = height
		this.#framebuffer = Buffer.alloc(width * height * 3)
		socket.on('close', () => {
			this.#closed = true
			reader.fail(new Error('[machine-display-closed] Display connection closed'))
		})
	}

	static async connect(socketPath: string, {timeoutMs = DEFAULT_TIMEOUT_MS}: RfbClientOptions = {}) {
		const socket = net.createConnection(socketPath)
		const reader = new Reader()
		socket.on('data', (chunk) => reader.push(chunk))
		socket.on('error', (error) => reader.fail(error))
		socket.on('close', () => reader.fail(new Error('[machine-display-closed] Display connection closed')))
		try {
			const {width, height} = await withTimeout(RfbClient.#handshake(socket, reader), timeoutMs, 'Display handshake')
			const client = new RfbClient(socket, reader, width, height, timeoutMs)
			client.#configure()
			return client
		} catch (error) {
			socket.destroy()
			throw error
		}
	}

	static async #handshake(socket: net.Socket, reader: Reader) {
		await new Promise<void>((resolve, reject) => {
			socket.once('connect', resolve)
			socket.once('error', reject)
		})

		const version = (await reader.read(12)).toString('latin1')
		const match = /^RFB (\d{3})\.(\d{3})\n$/.exec(version)
		if (!match || Number(match[1]) !== 3 || Number(match[2]) < 8) {
			throw new Error(`[machine-display-unsupported] Unsupported display protocol '${version.trim()}'`)
		}
		socket.write(PROTOCOL_VERSION, 'latin1')

		const securityTypeCount = (await reader.read(1)).readUInt8(0)
		if (securityTypeCount === 0) throw new Error(`[machine-display-rejected] ${await RfbClient.#readReason(reader)}`)
		const securityTypes = [...(await reader.read(securityTypeCount))]
		if (!securityTypes.includes(SECURITY_NONE)) {
			throw new Error('[machine-display-unsupported] Display requires authentication')
		}
		socket.write(Buffer.from([SECURITY_NONE]))
		const securityResult = (await reader.read(4)).readUInt32BE(0)
		if (securityResult !== 0) throw new Error(`[machine-display-rejected] ${await RfbClient.#readReason(reader)}`)

		// Shared session: never displace a person watching the console
		socket.write(Buffer.from([1]))
		const serverInit = await reader.read(24)
		const width = serverInit.readUInt16BE(0)
		const height = serverInit.readUInt16BE(2)
		const nameLength = serverInit.readUInt32BE(20)
		if (nameLength > 0) await reader.read(nameLength)
		if (width === 0 || height === 0) throw new Error('[machine-display-unavailable] Display has no framebuffer')
		return {width, height}
	}

	static async #readReason(reader: Reader) {
		const length = (await reader.read(4)).readUInt32BE(0)
		return length > 0
			? (await reader.read(Math.min(length, 1024))).toString('latin1')
			: 'Display rejected the connection'
	}

	#configure() {
		// 32 bits per pixel, depth 24, little-endian, true colour, R/G/B at
		// shifts 16/8/0: each pixel arrives as the bytes B, G, R, X
		const pixelFormat = Buffer.alloc(20)
		pixelFormat.writeUInt8(CLIENT_SET_PIXEL_FORMAT, 0)
		pixelFormat.writeUInt8(32, 4)
		pixelFormat.writeUInt8(24, 5)
		pixelFormat.writeUInt8(0, 6)
		pixelFormat.writeUInt8(1, 7)
		pixelFormat.writeUInt16BE(255, 8)
		pixelFormat.writeUInt16BE(255, 10)
		pixelFormat.writeUInt16BE(255, 12)
		pixelFormat.writeUInt8(16, 14)
		pixelFormat.writeUInt8(8, 15)
		pixelFormat.writeUInt8(0, 16)
		this.#socket.write(pixelFormat)

		const encodings = Buffer.alloc(4 + 4 * 2)
		encodings.writeUInt8(CLIENT_SET_ENCODINGS, 0)
		encodings.writeUInt16BE(2, 2)
		encodings.writeInt32BE(ENCODING_RAW, 4)
		encodings.writeInt32BE(ENCODING_DESKTOP_SIZE, 8)
		this.#socket.write(encodings)
	}

	#assertOpen() {
		if (this.#closed) throw new Error('[machine-display-closed] Display connection closed')
	}

	async keyEvent(keysym: number, down: boolean) {
		this.#assertOpen()
		const message = Buffer.alloc(8)
		message.writeUInt8(CLIENT_KEY_EVENT, 0)
		message.writeUInt8(down ? 1 : 0, 1)
		message.writeUInt32BE(keysym >>> 0, 4)
		await this.#write(message)
	}

	async pointerEvent(x: number, y: number, buttonMask: number) {
		this.#assertOpen()
		const message = Buffer.alloc(6)
		message.writeUInt8(CLIENT_POINTER_EVENT, 0)
		message.writeUInt8(buttonMask & 0xff, 1)
		message.writeUInt16BE(Math.min(Math.max(0, Math.round(x)), this.width - 1), 2)
		message.writeUInt16BE(Math.min(Math.max(0, Math.round(y)), this.height - 1), 4)
		await this.#write(message)
	}

	#write(message: Buffer) {
		return new Promise<void>((resolve, reject) => {
			this.#socket.write(message, (error) => (error ? reject(error) : resolve()))
		})
	}

	// Requests the whole framebuffer and returns it once the server has
	// delivered a complete update. A resolution change mid-request restarts
	// the capture at the new size.
	async captureFramebuffer(): Promise<Framebuffer> {
		this.#assertOpen()
		return withTimeout(this.#capture(), this.#timeoutMs, 'Display capture')
	}

	async #capture(): Promise<Framebuffer> {
		for (;;) {
			this.#requestFramebufferUpdate()
			const resized = await this.#readUntilFramebufferUpdate()
			if (resized) continue
			return {width: this.width, height: this.height, rgb: Buffer.from(this.#framebuffer)}
		}
	}

	#requestFramebufferUpdate() {
		const message = Buffer.alloc(10)
		message.writeUInt8(CLIENT_FRAMEBUFFER_UPDATE_REQUEST, 0)
		message.writeUInt8(0, 1)
		message.writeUInt16BE(0, 2)
		message.writeUInt16BE(0, 4)
		message.writeUInt16BE(this.width, 6)
		message.writeUInt16BE(this.height, 8)
		this.#socket.write(message)
	}

	// Returns true when the update carried a resolution change and the caller
	// must request the framebuffer again at the new size
	async #readUntilFramebufferUpdate() {
		for (;;) {
			const type = (await this.#reader.read(1)).readUInt8(0)
			if (type === SERVER_FRAMEBUFFER_UPDATE) return this.#readFramebufferUpdate()
			if (type === SERVER_BELL) continue
			if (type === SERVER_CUT_TEXT) {
				const header = await this.#reader.read(7)
				const length = header.readInt32BE(3)
				// Negative lengths signal the extended clipboard pseudo-format;
				// its payload length is the absolute value
				await this.#drain(Math.abs(length))
				continue
			}
			if (type === SERVER_SET_COLOUR_MAP_ENTRIES) {
				const header = await this.#reader.read(5)
				await this.#drain(header.readUInt16BE(3) * 6)
				continue
			}
			throw new Error(`[machine-display-protocol] Unexpected display message type ${type}`)
		}
	}

	async #readFramebufferUpdate() {
		const header = await this.#reader.read(3)
		const rectangleCount = header.readUInt16BE(1)
		let resized = false
		for (let index = 0; index < rectangleCount; index++) {
			const rectangle = await this.#reader.read(12)
			const x = rectangle.readUInt16BE(0)
			const y = rectangle.readUInt16BE(2)
			const width = rectangle.readUInt16BE(4)
			const height = rectangle.readUInt16BE(6)
			const encoding = rectangle.readInt32BE(8)
			if (encoding === ENCODING_DESKTOP_SIZE) {
				if (width === 0 || height === 0) throw new Error('[machine-display-unavailable] Display has no framebuffer')
				this.width = width
				this.height = height
				this.#framebuffer = Buffer.alloc(width * height * 3)
				resized = true
				continue
			}
			if (encoding !== ENCODING_RAW) {
				throw new Error(`[machine-display-protocol] Unexpected display encoding ${encoding}`)
			}
			const pixels = await this.#reader.read(width * height * BYTES_PER_PIXEL)
			// A stale rectangle from before a resize can overhang the new
			// framebuffer; clip rather than corrupt memory
			if (x + width > this.width || y + height > this.height) continue
			for (let row = 0; row < height; row++) {
				let source = row * width * BYTES_PER_PIXEL
				let target = ((y + row) * this.width + x) * 3
				for (let column = 0; column < width; column++) {
					this.#framebuffer[target] = pixels[source + 2]!
					this.#framebuffer[target + 1] = pixels[source + 1]!
					this.#framebuffer[target + 2] = pixels[source]!
					source += BYTES_PER_PIXEL
					target += 3
				}
			}
		}
		return resized
	}

	async #drain(length: number) {
		const chunk = 64 * 1024
		for (let remaining = length; remaining > 0; remaining -= chunk) {
			await this.#reader.read(Math.min(chunk, remaining))
		}
	}

	close() {
		this.#closed = true
		this.#socket.destroy()
	}
}
