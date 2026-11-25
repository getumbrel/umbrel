import {describe, expect, it, vi} from 'vitest'

import {batchesOf, IDS_PER_REQUEST, inBatches, inBatchesIsolating} from './batches'

const ids = (count: number) => Array.from({length: count}, (_, index) => `item-${index}`)

describe('batchesOf', () => {
	it('keeps every request under what the server takes in one statement', () => {
		// A delete binds each id twice, in a statement of at most 32,766 variables
		expect(IDS_PER_REQUEST * 2).toBeLessThan(32_766)
		const batches = batchesOf(ids(20_673))
		expect(batches.map((batch) => batch.length)).toEqual([2500, 2500, 2500, 2500, 2500, 2500, 2500, 2500, 673])
		expect(batches.flat()).toEqual(ids(20_673))
	})

	it('is one request for an ordinary selection and none for an empty one', () => {
		expect(batchesOf(ids(40))).toEqual([ids(40)])
		expect(batchesOf([])).toEqual([])
	})
})

describe('inBatches', () => {
	it('sends one batch after another, each once the last has been answered', async () => {
		const answers: (() => void)[] = []
		const send = vi.fn((batch: string[]) => new Promise<number>((resolve) => answers.push(() => resolve(batch.length))))
		const done = inBatches(ids(6000), send)
		await Promise.resolve()
		expect(send).toHaveBeenCalledTimes(1)
		answers[0]!()
		await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))
		answers[1]!()
		await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3))
		answers[2]!()
		expect(await done).toEqual([2500, 2500, 1000])
	})

	it('stops at the first batch that fails', async () => {
		const send = vi
			.fn<(batch: string[]) => Promise<number>>()
			.mockResolvedValueOnce(2500)
			.mockRejectedValueOnce(new Error('refused'))
		await expect(inBatches(ids(6000), send)).rejects.toThrow('refused')
		expect(send).toHaveBeenCalledTimes(2)
	})
})

describe('inBatchesIsolating', () => {
	// A server that changes a batch's items in order and gives up at the first it cannot change
	const serverRefusing = (stuck: Set<string>) => {
		const changed = new Set<string>()
		const send = vi.fn(async (batch: string[]) => {
			for (const id of batch) {
				if (stuck.has(id)) throw new Error('[cloud-read-only]')
				changed.add(id)
			}
		})
		return {send, changed}
	}

	it('changes everything that can be changed and hands back what cannot', async () => {
		const all = ids(6000)
		const stuck = new Set(['item-0', 'item-3141', 'item-5999'])
		const {send, changed} = serverRefusing(stuck)
		const {failed, error} = await inBatchesIsolating(all, send)
		expect(failed.sort()).toEqual([...stuck].sort())
		expect(changed.size).toBe(5997)
		expect(String(error)).toContain('cloud-read-only')
		// Three batches, and a few dozen more requests to find three items among them
		expect(send.mock.calls.length).toBeLessThan(90)
	})

	it('asks once per batch when nothing is refused', async () => {
		const {send} = serverRefusing(new Set())
		expect(await inBatchesIsolating(ids(6000), send)).toEqual({failed: [], error: undefined})
		expect(send).toHaveBeenCalledTimes(3)
	})

	it('stops narrowing down a selection that cannot be changed at all', async () => {
		const all = ids(20_000)
		const {send} = serverRefusing(new Set(all))
		const {failed} = await inBatchesIsolating(all, send)
		expect(failed).toHaveLength(20_000)
		// Not a request for each of twenty thousand items
		expect(send.mock.calls.length).toBeLessThan(120)
	})
})
