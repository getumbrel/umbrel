import {expect, test} from 'vitest'

import {createRsyncProgressRefiner} from './copy-with-progress.ts'

// Captured from rsync 3.5.0 (Debian trixie) copying 25537400 bytes with
// --info=progress2 --no-human-readable --no-inc-recursive --bwlimit=2000
const TOTAL_BYTES = 25537400
const RSYNC_SAMPLES: Array<[bytesCopied: number, percent: number]> = [
	[32768, 0],
	[1837300, 7],
	[2099444, 8],
	[2214900, 8],
	[2892200, 11],
	[3107900, 12],
	[4189244, 16],
	[5042400, 19],
	[5707800, 22],
	[6057900, 23],
	[6078100, 23],
	[6274708, 24],
	[8339092, 32],
	[8526800, 33],
	[10177700, 39],
	[10407076, 40],
	[12471460, 48],
	[12612900, 49],
	[13531400, 52],
	[14547208, 56],
	[15513900, 60],
	[16579300, 64],
	[16612068, 65],
	[18440600, 72],
	[18702744, 73],
	[18965600, 74],
	[19956200, 78],
	[20775400, 81],
	[22839784, 89],
	[23211900, 90],
	[24915836, 97],
	[24949500, 97],
	[25537400, 100],
]

const truePercent = (bytesCopied: number, totalBytes: number) => Math.floor((bytesCopied / totalBytes) * 1000) / 10

test('refines real rsync output to within a few tenths of a percent', () => {
	const refine = createRsyncProgressRefiner()
	const refined = RSYNC_SAMPLES.map(([bytesCopied, percent]) => refine(bytesCopied, percent))

	// rsync's first sample can't bound the total from above yet. This copy moves several
	// percent between samples so the bounds stay loose, but never outside rsync's percent.
	expect(refined[0]).toBe(0)
	for (const [index, [bytesCopied, percent]] of RSYNC_SAMPLES.entries()) {
		expect(refined[index]).toBeGreaterThanOrEqual(percent)
		expect(refined[index]).toBeLessThan(percent + 1)
		expect(Math.abs(refined[index] - truePercent(bytesCopied, TOTAL_BYTES))).toBeLessThan(0.35)
	}
	expect(refined.at(-1)).toBe(100)
})

test('reports 0.1% steps between whole percents on a large copy', () => {
	// A 500 GB copy at 100 MB/s sampled once a second only moves 0.02% per sample
	const totalBytes = 500e9
	const refine = createRsyncProgressRefiner()
	const refined: number[] = []
	for (let bytesCopied = 0; bytesCopied <= totalBytes * 0.05; bytesCopied += 100e6) {
		const percent = Math.floor((100 * bytesCopied) / totalBytes)
		refined.push(refine(bytesCopied, percent))
		if (percent >= 1) expect(refined.at(-1)).toBe(truePercent(bytesCopied, totalBytes))
	}

	// Every tenth of a percent shows up once rsync's first whole percent bounds the total
	const distinct = new Set(refined)
	expect(distinct.size).toBeGreaterThanOrEqual(40)
	expect(refined.at(-1)).toBe(5)
	for (let index = 1; index < refined.length; index++) {
		expect(refined[index]).toBeGreaterThanOrEqual(refined[index - 1])
		expect(Math.round(refined[index] * 10) / 10).toBe(refined[index])
	}
})

test('never moves backwards while the estimate tightens', () => {
	const totalBytes = 987_654_321
	const refine = createRsyncProgressRefiner()
	let previous = 0
	// Irregular sample sizes, like rsync's per-file and per-second lines
	for (let bytesCopied = 0, step = 1; bytesCopied <= totalBytes; bytesCopied += (step * 7919) % 9_000_000) {
		step++
		const percent = Math.floor((100 * bytesCopied) / totalBytes)
		const progress = refine(bytesCopied, percent)
		expect(progress).toBeGreaterThanOrEqual(previous)
		expect(progress).toBeGreaterThanOrEqual(percent)
		expect(progress).toBeLessThan(percent + 1)
		previous = progress
	}
})

test("falls back to rsync's percent when the output can't be parsed or doesn't add up", () => {
	const refine = createRsyncProgressRefiner()
	expect(refine(Number.NaN, 12)).toBe(12)
	expect(refine(1_000, 10)).toBe(10.4)
	// Implies a total of over 3 MB when the previous sample capped it at 10 kB
	expect(refine(1_000_000, 30)).toBe(30)
	expect(refine(100, 100)).toBe(100)
})
