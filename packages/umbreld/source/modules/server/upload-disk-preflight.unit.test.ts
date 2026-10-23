import {describe, expect, test} from 'vitest'

import UploadDiskPreflight from './upload-disk-preflight.ts'

const gigabyte = 1_000_000_000

function createPreflight(initialAvailableBytes: number) {
	let availableBytes = initialAvailableBytes
	let availabilityReads = 0
	const preflight = new UploadDiskPreflight({
		getAvailableBytes: async () => {
			availabilityReads++
			return availableBytes
		},
		reserveBytes: gigabyte,
	})

	return {
		preflight,
		getAvailabilityReads: () => availabilityReads,
		setAvailableBytes: (bytes: number) => (availableBytes = bytes),
	}
}

describe('UploadDiskPreflight', () => {
	test('serializes concurrent admission and reserves both upload sizes', async () => {
		const {preflight} = createPreflight(2 * gigabyte)

		const admitted = await Promise.all([
			preflight.admit('/tmp/first-upload', 600_000_000),
			preflight.admit('/tmp/second-upload', 600_000_000),
		])

		expect(admitted).toEqual([true, false])
	})

	test('does not double-count active uploads from later filesystem snapshots', async () => {
		const {preflight, getAvailabilityReads, setAvailableBytes} = createPreflight(5 * gigabyte)

		await expect(preflight.admit('/tmp/first-upload', 2 * gigabyte)).resolves.toBe(true)

		// Even if the filesystem now reports the first upload's written bytes,
		// the second admission uses the original snapshot where its full size was
		// already debited once.
		setAvailableBytes(3_500_000_000)
		await expect(preflight.admit('/tmp/second-upload', gigabyte)).resolves.toBe(true)
		expect(getAvailabilityReads()).toBe(1)
	})

	test('returns failed upload capacity while another upload remains active', async () => {
		const {preflight} = createPreflight(3 * gigabyte)

		await expect(preflight.admit('/tmp/first-upload', gigabyte)).resolves.toBe(true)
		await expect(preflight.admit('/tmp/second-upload', gigabyte)).resolves.toBe(true)
		await expect(preflight.admit('/tmp/third-upload', 1)).resolves.toBe(false)

		await preflight.release('/tmp/first-upload', {restoreCapacity: true})

		await expect(preflight.admit('/tmp/third-upload', gigabyte)).resolves.toBe(true)
	})

	test('does not return capacity when a failed upload remains on disk', async () => {
		const {preflight} = createPreflight(3 * gigabyte)

		await expect(preflight.admit('/tmp/first-upload', gigabyte)).resolves.toBe(true)
		await expect(preflight.admit('/tmp/second-upload', gigabyte)).resolves.toBe(true)
		await expect(preflight.admit('/tmp/third-upload', 1)).resolves.toBe(false)

		await preflight.release('/tmp/first-upload', {restoreCapacity: false})

		await expect(preflight.admit('/tmp/third-upload', 1)).resolves.toBe(false)
	})

	test('refreshes available space after the active batch finishes', async () => {
		const {preflight, getAvailabilityReads, setAvailableBytes} = createPreflight(2 * gigabyte)

		await expect(preflight.admit('/tmp/first-upload', gigabyte)).resolves.toBe(true)
		await preflight.release('/tmp/first-upload', {restoreCapacity: false})

		setAvailableBytes(gigabyte)

		await expect(preflight.admit('/tmp/second-upload', 1)).resolves.toBe(false)
		expect(getAvailabilityReads()).toBe(2)
	})

	test('refreshes available space after rejecting a request with no active batch', async () => {
		const {preflight, getAvailabilityReads, setAvailableBytes} = createPreflight(gigabyte)

		await expect(preflight.admit('/tmp/first-upload', 1)).resolves.toBe(false)

		setAvailableBytes(2 * gigabyte)

		await expect(preflight.admit('/tmp/second-upload', gigabyte)).resolves.toBe(true)
		expect(getAvailabilityReads()).toBe(2)
	})
})
