import crypto from 'node:crypto'
import fs from 'node:fs/promises'

import {describe, expect, test} from 'vitest'

import {
	attestedMerkleRoot,
	isComplete,
	isUpgradeOf,
	readTimestamp,
	verifyBitcoinAttestations,
} from './opentimestamps.ts'

// Real timestamps of umbrelOS 2.0.1's SHA256SUMS: the pending one CI made, the same one completed with
// `ots upgrade`, and another timestamp of the same file made later
const fixture = (file: string) => fs.readFile(new URL(`./fixtures/opentimestamps/${file}`, import.meta.url))

// The merkle roots of the blocks the completed timestamp is attested in, as block explorers show them
const merkleRoots: Record<number, string> = {
	974104: '759530470124cc585e59cff0d5ed626bf7acb17baa97dbce67241f3374f8a35c',
	974149: 'e2e497ba461edaef909c581db78760fc7ac63d1e536a20e16e7e4f65276b6233',
	974152: '952f24f261b12b05dcb62dd728b3abf609acceb37f0861cfb95cf4eb75c9fd62',
}
const merkleRootAt = async (height: number) => merkleRoots[height]

describe('readTimestamp()', () => {
	test("reads a timestamp's file hash and attestations", async () => {
		const sums = await fixture('SHA256SUMS')
		const pending = readTimestamp(await fixture('pending.ots'))
		expect(pending.hashAlgorithm).toBe('sha256')
		expect(pending.fileHash).toEqual(crypto.createHash('sha256').update(sums).digest())
		expect(pending.attestations.map((attestation) => attestation.type)).toEqual(Array(4).fill('pending'))
		expect(isComplete(pending)).toBe(false)

		const completed = readTimestamp(await fixture('completed.ots'))
		expect(isComplete(completed)).toBe(true)
		expect(
			completed.attestations
				.flatMap((attestation) => (attestation.type === 'bitcoin' ? [attestation.height] : []))
				.sort(),
		).toEqual([974104, 974149, 974152])
	})

	test("refuses anything that isn't a whole OpenTimestamps proof", async () => {
		const completed = await fixture('completed.ots')
		expect(() => readTimestamp(Buffer.from('not a timestamp'))).toThrow("This isn't an OpenTimestamps proof")
		expect(() => readTimestamp(completed.subarray(0, completed.length - 1))).toThrow('The timestamp ends early')
		expect(() => readTimestamp(Buffer.concat([completed, Buffer.from([0])]))).toThrow(
			'The timestamp has data after its end',
		)
	})
})

describe('isUpgradeOf()', () => {
	test('accepts a completed timestamp only as an upgrade of exactly the pending one it came from', async () => {
		const pending = readTimestamp(await fixture('pending.ots'))
		const completed = readTimestamp(await fixture('completed.ots'))
		const another = readTimestamp(await fixture('another-pending.ots'))
		expect(isUpgradeOf(completed, pending)).toBe(true)
		// Another timestamp of the same file has different calendar commitments
		expect(another.fileHash).toEqual(pending.fileHash)
		expect(isUpgradeOf(completed, another)).toBe(false)
		// Nor is a pending timestamp an upgrade of anything
		expect(isUpgradeOf(pending, pending)).toBe(false)
		expect(isUpgradeOf(pending, completed)).toBe(false)
	})

	test("refuses a completed timestamp that's lost one of the pending one's attestations", async () => {
		const pending = readTimestamp(await fixture('pending.ots'))
		const completed = readTimestamp(await fixture('completed.ots'))
		const dropped = completed.attestations.findIndex((attestation) => attestation.type === 'pending')
		const missingOne = {...completed, attestations: completed.attestations.filter((_, index) => index !== dropped)}
		expect(isUpgradeOf(missingOne, pending)).toBe(false)
	})
})

describe('verifyBitcoinAttestations()', () => {
	test("checks a completed timestamp's attestations against its blocks' merkle roots", async () => {
		const completed = readTimestamp(await fixture('completed.ots'))
		expect(await verifyBitcoinAttestations(completed, merkleRootAt)).toBe(true)
		// A different block's merkle root at one of the heights
		expect(
			await verifyBitcoinAttestations(completed, async (height) =>
				height === 974104 ? merkleRoots[974149] : merkleRoots[height],
			),
		).toBe(false)
		// A pending timestamp has nothing to check
		expect(await verifyBitcoinAttestations(readTimestamp(await fixture('pending.ots')), merkleRootAt)).toBe(false)
	})

	test('commits to the merkle root in the block header byte order', async () => {
		const completed = readTimestamp(await fixture('completed.ots'))
		const attestation = completed.attestations.find((attestation) => attestation.type === 'bitcoin')!
		const height = (attestation as {height: number}).height
		expect(attestedMerkleRoot(completed, attestation).reverse().toString('hex')).toBe(merkleRoots[height])
	})
})
