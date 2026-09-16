import {isDnsHostname} from '../apps/native-tls.js'

// Bound preread resources; TLS permits larger ClientHellos than we accept here.
export const MAX_CLIENT_HELLO_WIRE_BYTES = 64 * 1024
const MAX_PLAINTEXT_RECORD_BYTES = 16 * 1024
// Fixed-size bitmaps keep duplicate detection within the memory budget.
const EXTENSION_BITMAP_BYTES = 65536 / 8
const NAME_TYPE_BITMAP_BYTES = 256 / 8

// Includes the backing stores for reassembly, the record header and duplicate
// detection. Input chunks and their coalesced tails are never retained here.
export const CLIENT_HELLO_READER_BUFFER_BYTES =
	MAX_CLIENT_HELLO_WIRE_BYTES + 5 + EXTENSION_BITMAP_BYTES + NAME_TYPE_BITMAP_BYTES

type ClientHello = {hostname?: string}

function invalid(message: string): never {
	throw new Error(`Invalid TLS ClientHello: ${message}`)
}

function markOnce(bitmap: Buffer, value: number) {
	const index = value >> 3
	const mask = 1 << (value & 7)
	if (bitmap[index] & mask) invalid('duplicate extension or server name type')
	bitmap[index] |= mask
}

function readHostname(bytes: Buffer) {
	// Latin-1 preserves high bits so the ASCII-only validator rejects them.
	const hostname = bytes.toString('latin1')
	if (!isDnsHostname(hostname)) invalid('invalid hostname')
	return hostname
}

// Validate the whole hello so valid SNI cannot hide malformed trailing fields.
// The selected TLS endpoint handles other extensions' semantics.
function readClientHello(hello: Buffer) {
	let offset = 4
	const requireBytes = (length: number) => {
		if (length > hello.length - offset) invalid('truncated ClientHello field')
	}
	const uint8 = () => {
		requireBytes(1)
		return hello[offset++]
	}
	const uint16 = () => {
		requireBytes(2)
		const value = hello.readUInt16BE(offset)
		offset += 2
		return value
	}
	const skip = (length: number) => {
		requireBytes(length)
		offset += length
	}

	if (uint8() !== 3 || uint8() === 0) invalid('invalid legacy version')
	skip(32)
	const sessionIdLength = uint8()
	if (sessionIdLength > 32) invalid('invalid session ID length')
	skip(sessionIdLength)
	const cipherSuitesLength = uint16()
	if (cipherSuitesLength < 2 || cipherSuitesLength % 2 !== 0) invalid('invalid cipher suites length')
	skip(cipherSuitesLength)
	const compressionMethodsLength = uint8()
	if (compressionMethodsLength === 0) invalid('empty compression methods')
	skip(compressionMethodsLength)
	// TLS 1.2 permits a ClientHello without an extensions vector.
	if (offset === hello.length) return undefined
	const extensionsLength = uint16()
	if (extensionsLength !== hello.length - offset) invalid('invalid extensions length')
	const extensionTypes = Buffer.alloc(EXTENSION_BITMAP_BYTES)
	let hostname: string | undefined
	while (offset < hello.length) {
		const type = uint16()
		const length = uint16()
		requireBytes(length)
		markOnce(extensionTypes, type)
		const extensionEnd = offset + length
		if (type !== 0) {
			offset = extensionEnd
			continue
		}

		if (length < 2) invalid('truncated server name list')
		const namesLength = uint16()
		if (namesLength === 0 || namesLength !== extensionEnd - offset) invalid('invalid server name list length')
		const nameTypes = Buffer.alloc(NAME_TYPE_BITMAP_BYTES)
		while (offset < extensionEnd) {
			if (extensionEnd - offset < 3) invalid('truncated server name entry')
			const nameType = uint8()
			const nameLength = uint16()
			if (nameLength > extensionEnd - offset) invalid('invalid server name length')
			markOnce(nameTypes, nameType)
			if (nameType === 0) hostname = readHostname(hello.subarray(offset, offset + nameLength))
			// RFC 6066 requires future name types to have a uint16 length too.
			offset += nameLength
		}
	}
	return hostname
}

// Reassemble across TCP reads and TLS records without reparsing partial data.
// Stop after a result or exception; the caller owns deadlines and byte replay.
export class ClientHelloReader {
	#hello = Buffer.alloc(MAX_CLIENT_HELLO_WIRE_BYTES)
	#recordHeader = Buffer.alloc(5)
	#recordHeaderBytes = 0
	#recordRemaining = 0
	#helloBytes = 0
	#helloLength?: number
	#wireBytes = 0

	push(chunk: Buffer): ClientHello | undefined {
		let offset = 0
		while (offset < chunk.length) {
			const budget = MAX_CLIENT_HELLO_WIRE_BYTES - this.#wireBytes
			if (budget === 0) invalid('wire prefix exceeds limit')
			if (this.#recordRemaining === 0) {
				const count = Math.min(chunk.length - offset, 5 - this.#recordHeaderBytes, budget)
				chunk.copy(this.#recordHeader, this.#recordHeaderBytes, offset, offset + count)
				this.#recordHeaderBytes += count
				this.#wireBytes += count
				offset += count
				if (this.#recordHeaderBytes < 5) continue
				// TLS 1.2 requires accepting any {03, XX} ClientHello record version.
				if (this.#recordHeader[0] !== 22 || this.#recordHeader[1] !== 3) invalid('invalid handshake record')
				this.#recordRemaining = this.#recordHeader.readUInt16BE(3)
				if (this.#recordRemaining === 0 || this.#recordRemaining > MAX_PLAINTEXT_RECORD_BYTES) {
					invalid('invalid plaintext record length')
				}
				this.#recordHeaderBytes = 0
				continue
			}

			const count = Math.min(
				chunk.length - offset,
				this.#recordRemaining,
				(this.#helloLength ?? 4) - this.#helloBytes,
				budget,
			)
			chunk.copy(this.#hello, this.#helloBytes, offset, offset + count)
			this.#helloBytes += count
			this.#wireBytes += count
			this.#recordRemaining -= count
			offset += count
			if (this.#helloLength === undefined && this.#helloBytes === 4) {
				if (this.#hello[0] !== 1) invalid('first handshake is not ClientHello')
				const bodyLength = this.#hello.readUIntBE(1, 3)
				if (bodyLength < 41) invalid('ClientHello body is too short')
				if (this.#wireBytes + bodyLength > MAX_CLIENT_HELLO_WIRE_BYTES) invalid('wire prefix exceeds limit')
				this.#helloLength = bodyLength + 4
			}
			if (this.#helloBytes === this.#helloLength) {
				const hostname = readClientHello(this.#hello.subarray(0, this.#helloLength))
				return {hostname}
			}
		}
		if (this.#wireBytes === MAX_CLIENT_HELLO_WIRE_BYTES) invalid('wire prefix exceeds limit')
		return undefined
	}
}
