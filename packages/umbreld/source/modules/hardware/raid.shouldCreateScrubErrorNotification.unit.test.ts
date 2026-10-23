import {describe, expect, test} from 'vitest'

import {shouldCreateScrubErrorNotification, type ScrubStatus} from './raid.ts'

const scrubbing: ScrubStatus = {state: 'scrubbing', progress: 50, errors: 0}

describe('shouldCreateScrubErrorNotification', () => {
	test('reports errors when an observed scrub finishes', () => {
		expect(
			shouldCreateScrubErrorNotification({
				hasObservedScrub: true,
				previous: scrubbing,
				current: {state: 'finished', progress: 100, errors: 2},
			}),
		).toBe(true)
	})

	test('does not recreate a historical notification on startup', () => {
		expect(
			shouldCreateScrubErrorNotification({
				hasObservedScrub: false,
				current: {state: 'finished', progress: 100, errors: 2},
			}),
		).toBe(false)
	})

	test('does not report a successful, canceled, or already-finished scrub', () => {
		expect(
			shouldCreateScrubErrorNotification({
				hasObservedScrub: true,
				previous: scrubbing,
				current: {state: 'finished', progress: 100, errors: 0},
			}),
		).toBe(false)
		expect(
			shouldCreateScrubErrorNotification({
				hasObservedScrub: true,
				previous: scrubbing,
				current: {state: 'canceled', progress: 0, errors: 2},
			}),
		).toBe(false)
		expect(
			shouldCreateScrubErrorNotification({
				hasObservedScrub: true,
				previous: {state: 'finished', progress: 100, errors: 2},
				current: {state: 'finished', progress: 100, errors: 2},
			}),
		).toBe(false)
	})
})
