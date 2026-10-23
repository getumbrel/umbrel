import {describe, expect, test, vi} from 'vitest'

import {ensureScrubSchedule, runScrubSchedulerTick, type ScrubStatus} from './raid.ts'

describe('ensureScrubSchedule', () => {
	test('creates a missing deadline without replacing an existing one', async () => {
		const scheduleNextScrub = vi.fn(async () => {})
		const onError = vi.fn()

		await ensureScrubSchedule({getNextScrubAt: async () => undefined, scheduleNextScrub, onError})
		expect(scheduleNextScrub).toHaveBeenCalledOnce()

		scheduleNextScrub.mockClear()
		await ensureScrubSchedule({getNextScrubAt: async () => 1_000, scheduleNextScrub, onError})
		expect(scheduleNextScrub).not.toHaveBeenCalled()
		expect(onError).not.toHaveBeenCalled()
	})

	test.each([
		[
			'deadline read',
			async (): Promise<number | undefined> => {
				throw new Error('read failed')
			},
			async (): Promise<void> => {},
		],
		[
			'deadline write',
			async (): Promise<number | undefined> => undefined,
			async (): Promise<void> => {
				throw new Error('write failed')
			},
		],
	] as const)(
		'contains a %s failure so RAID startup can continue',
		async (_name, getNextScrubAt, scheduleNextScrub) => {
			const onError = vi.fn()

			await expect(ensureScrubSchedule({getNextScrubAt, scheduleNextScrub, onError})).resolves.toBeUndefined()
			expect(onError).toHaveBeenCalledOnce()
		},
	)
})

function createTick(
	overrides: {
		nextScrubAt?: number
		getNextScrubAt?: () => Promise<number | undefined>
		scheduleNextScrub?: () => Promise<void>
		getStatus?: () => Promise<{scrub?: ScrubStatus}>
		scrub?: () => Promise<boolean>
	} = {},
) {
	const onExistingScrub = vi.fn()
	const onError = vi.fn()
	const scheduleNextScrub = vi.fn(overrides.scheduleNextScrub ?? (async () => {}))
	const scrub = vi.fn(overrides.scrub ?? (async () => true))

	const run = () =>
		runScrubSchedulerTick({
			now: () => 1_000,
			getNextScrubAt: overrides.getNextScrubAt ?? (async () => overrides.nextScrubAt),
			scheduleNextScrub,
			getStatus: overrides.getStatus ?? (async () => ({})),
			scrub,
			onExistingScrub,
			onError,
		})

	return {run, scheduleNextScrub, scrub, onExistingScrub, onError}
}

describe('runScrubSchedulerTick', () => {
	test('creates the first deadline without starting a scrub', async () => {
		const tick = createTick()

		await tick.run()

		expect(tick.scheduleNextScrub).toHaveBeenCalledOnce()
		expect(tick.scrub).not.toHaveBeenCalled()
		expect(tick.onError).not.toHaveBeenCalled()
	})

	test('leaves a future deadline alone', async () => {
		const tick = createTick({nextScrubAt: 1_001})

		await tick.run()

		expect(tick.scheduleNextScrub).not.toHaveBeenCalled()
		expect(tick.scrub).not.toHaveBeenCalled()
	})

	test('starts a due scrub', async () => {
		const tick = createTick({nextScrubAt: 999})

		await tick.run()

		expect(tick.scrub).toHaveBeenCalledOnce()
		expect(tick.scheduleNextScrub).not.toHaveBeenCalled()
		expect(tick.onError).not.toHaveBeenCalled()
	})

	test('counts an existing OpenZFS scrub and schedules the next deadline', async () => {
		const tick = createTick({
			nextScrubAt: 999,
			getStatus: async () => ({scrub: {state: 'scrubbing', progress: 20, errors: 0}}),
		})

		await tick.run()

		expect(tick.onExistingScrub).toHaveBeenCalledOnce()
		expect(tick.scheduleNextScrub).toHaveBeenCalledOnce()
		expect(tick.scrub).not.toHaveBeenCalled()
	})

	test.each([
		['deadline read', {getNextScrubAt: async () => Promise.reject(new Error('read failed'))}],
		['deadline write', {scheduleNextScrub: async () => Promise.reject(new Error('write failed'))}],
		['status read', {nextScrubAt: 999, getStatus: async () => Promise.reject(new Error('status failed'))}],
		['scrub start', {nextScrubAt: 999, scrub: async () => Promise.reject(new Error('busy'))}],
	] as const)('contains a %s failure so the recurring scheduler can keep running', async (_name, overrides) => {
		const tick = createTick(overrides)

		await expect(tick.run()).resolves.toBeUndefined()

		expect(tick.onError).toHaveBeenCalledOnce()
	})
})
