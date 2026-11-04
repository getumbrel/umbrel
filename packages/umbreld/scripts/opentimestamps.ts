// Just enough of OpenTimestamps (https://opentimestamps.org) to keep a release's timestamps up to date on
// the download server: read a .ots proof, tell a pending one from one completed with Bitcoin attestations,
// and check a completed proof is an upgrade of exactly the pending proof it replaces.
//
// A proof starts from its file's hash and is a tree of operations, like appending or prepending bytes and
// hashing, ending in attestations. A pending attestation says a calendar server will commit the result to
// Bitcoin. `ots upgrade` adds the calendar's operations from there to a Bitcoin block's merkle root, ending
// in a Bitcoin attestation of that block, and keeps everything that was already there.

import crypto from 'node:crypto'

const HEADER = Buffer.from('004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294', 'hex')
const PENDING_ATTESTATION = '83dfe30d2ef90c8e'
const BITCOIN_ATTESTATION = '0588960d73d71901'

// Operations by tag: hashes take no argument, append and prepend take bytes
const HASHES: Record<number, {name: string; algorithm?: string; length: number}> = {
	0x02: {name: 'sha1', algorithm: 'sha1', length: 20},
	0x03: {name: 'ripemd160', algorithm: 'ripemd160', length: 20},
	0x08: {name: 'sha256', algorithm: 'sha256', length: 32},
	// Node can't compute Keccak-256, so a proof using it can be read but not checked against Bitcoin
	0x67: {name: 'keccak256', length: 32},
}
const APPEND = 0xf0
const PREPEND = 0xf1
const FORK = 0xff

type Operation = {tag: number; argument?: Buffer}

// An attestation, and the operations from the file's hash that lead to it
export type Attestation = {path: Operation[]} & (
	| {type: 'pending'; uri: string}
	| {type: 'bitcoin'; height: number}
	| {type: 'unknown'; tag: string; payload: Buffer}
)

export type Timestamp = {hashAlgorithm: string; fileHash: Buffer; attestations: Attestation[]}

class Reader {
	offset = 0
	readonly data: Buffer
	constructor(data: Buffer) {
		this.data = data
	}

	bytes(length: number) {
		if (this.offset + length > this.data.length) throw new Error('The timestamp ends early')
		const bytes = this.data.subarray(this.offset, this.offset + length)
		this.offset += length
		return bytes
	}

	byte() {
		return this.bytes(1)[0]
	}

	varuint() {
		let value = 0
		let shift = 0
		for (;;) {
			const byte = this.byte()
			value += (byte & 0x7f) * 2 ** shift
			if (!(byte & 0x80)) return value
			shift += 7
			if (shift > 49) throw new Error('The timestamp has an integer that is too large')
		}
	}

	varbytes() {
		return this.bytes(this.varuint())
	}
}

export function readTimestamp(data: Buffer): Timestamp {
	if (!data.subarray(0, HEADER.length).equals(HEADER)) throw new Error("This isn't an OpenTimestamps proof")
	const reader = new Reader(data)
	reader.bytes(HEADER.length)
	const version = reader.varuint()
	if (version !== 1) throw new Error(`Unsupported OpenTimestamps proof version ${version}`)
	const hash = HASHES[reader.byte()]
	if (!hash) throw new Error("The timestamp's file hash uses an unknown algorithm")
	const fileHash = reader.bytes(hash.length)

	const attestations: Attestation[] = []
	const readAttestation = (path: Operation[]) => {
		const tag = reader.bytes(8).toString('hex')
		const payload = new Reader(reader.varbytes())
		if (tag === PENDING_ATTESTATION)
			attestations.push({path, type: 'pending', uri: payload.varbytes().toString('utf8')})
		else if (tag === BITCOIN_ATTESTATION) attestations.push({path, type: 'bitcoin', height: payload.varuint()})
		else attestations.push({path, type: 'unknown', tag, payload: payload.data})
	}
	const readTagged = (tag: number, path: Operation[]) => {
		if (tag === 0x00) return readAttestation(path)
		if (tag === APPEND || tag === PREPEND) return readTree([...path, {tag, argument: reader.varbytes()}])
		if (HASHES[tag]) return readTree([...path, {tag}])
		throw new Error(`The timestamp has an unknown operation ${tag.toString(16)}`)
	}
	// A tree is any number of branches each after a fork marker, then a last branch
	const readTree = (path: Operation[]): void => {
		let tag = reader.byte()
		while (tag === FORK) {
			readTagged(reader.byte(), path)
			tag = reader.byte()
		}
		readTagged(tag, path)
	}
	readTree([])
	if (reader.offset !== data.length) throw new Error('The timestamp has data after its end')
	return {hashAlgorithm: hash.name, fileHash: Buffer.from(fileHash), attestations}
}

const describePath = (path: Operation[]) =>
	path.map(({tag, argument}) => `${tag.toString(16)}${argument ? `:${argument.toString('hex')}` : ''}`).join(',')

const describe = (attestation: Attestation) => {
	const path = describePath(attestation.path)
	if (attestation.type === 'pending') return `${path} pending ${attestation.uri}`
	if (attestation.type === 'bitcoin') return `${path} bitcoin ${attestation.height}`
	return `${path} ${attestation.tag} ${attestation.payload.toString('hex')}`
}

export const isComplete = (timestamp: Timestamp) =>
	timestamp.attestations.some((attestation) => attestation.type === 'bitcoin')

// Whether a completed timestamp is an upgrade of exactly this pending one: it times the same file, keeps
// every attestation the pending one has, and only adds Bitcoin attestations that follow on from one of its
// pending attestations. Another timestamp of the same file has different calendar commitments, so it
// isn't an upgrade of this one even though it times the same contents.
export function isUpgradeOf(upgraded: Timestamp, pending: Timestamp) {
	if (upgraded.hashAlgorithm !== pending.hashAlgorithm || !upgraded.fileHash.equals(pending.fileHash)) return false
	if (!isComplete(upgraded)) return false
	const kept = new Set(pending.attestations.map(describe))
	const ours = new Set(upgraded.attestations.map(describe))
	if (![...kept].every((attestation) => ours.has(attestation))) return false
	const commitments = pending.attestations
		.filter((attestation) => attestation.type === 'pending')
		.map((attestation) => describePath(attestation.path))
	return upgraded.attestations.every((attestation) => {
		if (kept.has(describe(attestation))) return true
		if (attestation.type !== 'bitcoin') return false
		const path = describePath(attestation.path)
		return commitments.some((commitment) => path === commitment || path.startsWith(`${commitment},`))
	})
}

// What a Bitcoin attestation commits to: the file's hash with its operations applied, which has to equal
// its block's merkle root in the block header's byte order
export function attestedMerkleRoot(timestamp: Timestamp, attestation: Attestation) {
	let message = timestamp.fileHash
	for (const {tag, argument} of attestation.path) {
		if (tag === APPEND) message = Buffer.concat([message, argument!])
		else if (tag === PREPEND) message = Buffer.concat([argument!, message])
		else {
			const algorithm = HASHES[tag]?.algorithm
			if (!algorithm) throw new Error(`Can't check a timestamp that uses ${HASHES[tag]?.name ?? 'an unknown hash'}`)
			message = crypto.createHash(algorithm).update(message).digest()
		}
	}
	return message
}

// Whether every Bitcoin attestation in a timestamp commits to its block's real merkle root. The merkle
// root for a height comes from a block explorer, which says it in the usual display order, reversed from
// the header's.
export async function verifyBitcoinAttestations(
	timestamp: Timestamp,
	merkleRootAt: (height: number) => Promise<string>,
) {
	const bitcoin = timestamp.attestations.filter((attestation) => attestation.type === 'bitcoin')
	if (bitcoin.length === 0) return false
	for (const attestation of bitcoin) {
		const expected = Buffer.from(await merkleRootAt(attestation.height), 'hex').reverse()
		if (!attestedMerkleRoot(timestamp, attestation).equals(expected)) return false
	}
	return true
}

// A block's merkle root from Blockstream's public block explorer
export async function blockstreamMerkleRoot(height: number) {
	const hashResponse = await fetch(`https://blockstream.info/api/block-height/${height}`)
	if (!hashResponse.ok) throw new Error(`Failed to look up Bitcoin block ${height}: HTTP ${hashResponse.status}`)
	const hash = (await hashResponse.text()).trim()
	if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`Unexpected hash for Bitcoin block ${height}`)
	const blockResponse = await fetch(`https://blockstream.info/api/block/${hash}`)
	if (!blockResponse.ok) throw new Error(`Failed to look up Bitcoin block ${hash}: HTTP ${blockResponse.status}`)
	const {merkle_root: merkleRoot} = (await blockResponse.json()) as {merkle_root?: unknown}
	if (typeof merkleRoot !== 'string' || !/^[0-9a-f]{64}$/.test(merkleRoot)) {
		throw new Error(`Unexpected merkle root for Bitcoin block ${height}`)
	}
	return merkleRoot
}
