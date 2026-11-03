import {describe, expect, test} from 'vitest'

import {getScrubConflict} from './raid.ts'

const idle = {
	isInitialSetupInProgress: false,
	isTransitioningToFailsafe: false,
	isReplacing: false,
}

describe('getScrubConflict', () => {
	test('allows a scrub when the pool is idle', () => {
		expect(getScrubConflict(idle)).toBeUndefined()
	})

	test.each([
		[{...idle, isInitialSetupInProgress: true}, 'initial setup'],
		[{...idle, isTransitioningToFailsafe: true}, 'FailSafe transition'],
		[{...idle, isReplacing: true}, 'device replacement'],
		[{...idle, activePoolMutation: 'RAID device addition' as const}, 'RAID device addition'],
		[{...idle, expansion: {state: 'expanding' as const, progress: 50}}, 'expansion'],
		[{...idle, rebuild: {state: 'rebuilding' as const, progress: 50}}, 'rebuild'],
		[{...idle, scrub: {state: 'scrubbing' as const, progress: 50, errors: 0}}, 'scrub'],
	])('reports active maintenance work as a conflict', (status, conflict) => {
		expect(getScrubConflict(status)).toBe(conflict)
	})

	test('ignores completed maintenance work', () => {
		expect(
			getScrubConflict({
				...idle,
				expansion: {state: 'finished', progress: 100},
				rebuild: {state: 'finished', progress: 100},
				scrub: {state: 'finished', progress: 100, errors: 0},
			}),
		).toBeUndefined()
	})
})
