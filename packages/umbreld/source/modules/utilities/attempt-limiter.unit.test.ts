import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import AttemptLimiter, {TooManyAttemptsError} from './attempt-limiter.ts'

const minute = 60_000

beforeEach(() => void vi.useFakeTimers({toFake: ['performance']}))
afterEach(() => void vi.useRealTimers())

// Milliseconds until the client may try again, without making an attempt
function blockedFor(limiter: AttemptLimiter, client: string) {
	try {
		limiter.start(client).withdraw()
		return 0
	} catch (error) {
		if (!(error instanceof TooManyAttemptsError)) throw error
		return error.retryAfterMs
	}
}

test('blocks for twice as long after each failure once the free attempts are used, up to an hour', () => {
	const limiter = new AttemptLimiter()

	// Typos are free
	for (let attempt = 1; attempt <= 9; attempt++) {
		limiter.start('client')
		expect(blockedFor(limiter, 'client')).toBe(0)
	}

	for (const minutes of [1, 2, 4, 8, 16, 32, 60, 60]) {
		limiter.start('client')
		expect(blockedFor(limiter, 'client')).toBe(minutes * minute)
		vi.advanceTimersByTime(minutes * minute - 1)
		expect(blockedFor(limiter, 'client')).toBe(1)
		vi.advanceTimersByTime(1)
		expect(blockedFor(limiter, 'client')).toBe(0)
	}
})

test('tells the client how long to wait in whole minutes', () => {
	const limiter = new AttemptLimiter()
	for (let attempt = 1; attempt <= 10; attempt++) limiter.start('client')
	expect(() => limiter.start('client')).toThrow('Too many failed attempts. Try again in 1 minute.')

	vi.advanceTimersByTime(minute)
	limiter.start('client')
	vi.advanceTimersByTime(1)
	expect(() => limiter.start('client')).toThrow('Too many failed attempts. Try again in 2 minutes.')
})

test('counts guesses that are still being checked, so parallel guesses cannot outrun the limit', () => {
	const limiter = new AttemptLimiter()
	const started = Array.from({length: 100}, () => {
		try {
			return limiter.start('client')
		} catch {
			return undefined
		}
	})
	expect(started.filter(Boolean)).toHaveLength(10)
})

test('a correct guess forgets earlier failures', () => {
	const limiter = new AttemptLimiter()
	for (let attempt = 1; attempt <= 9; attempt++) limiter.start('client')
	limiter.start('client').succeeded()

	for (let attempt = 1; attempt <= 9; attempt++) limiter.start('client')
	expect(blockedFor(limiter, 'client')).toBe(0)
})

test('a withdrawn attempt neither counts nor clears earlier failures', () => {
	const limiter = new AttemptLimiter()
	for (let attempt = 1; attempt <= 9; attempt++) limiter.start('client')
	for (let attempt = 1; attempt <= 20; attempt++) limiter.start('client').withdraw()

	// The tenth failure still blocks
	limiter.start('client')
	expect(blockedFor(limiter, 'client')).toBe(minute)

	// Nor does one lengthen a block that has run out
	vi.advanceTimersByTime(minute)
	limiter.start('client').withdraw()
	limiter.start('client')
	expect(blockedFor(limiter, 'client')).toBe(2 * minute)
})

test('withdrawing one of several parallel attempts leaves the others counted', () => {
	const limiter = new AttemptLimiter()
	for (let attempt = 1; attempt <= 8; attempt++) limiter.start('client')
	const ninth = limiter.start('client')
	limiter.start('client')
	expect(() => limiter.start('client')).toThrow(TooManyAttemptsError)

	// Nine failures remain, so the next one is the tenth
	ninth.withdraw()
	limiter.start('client')
	expect(blockedFor(limiter, 'client')).toBe(minute)
})

test('clients do not affect each other', () => {
	const limiter = new AttemptLimiter()
	for (let attempt = 1; attempt <= 10; attempt++) limiter.start('attacker')
	expect(blockedFor(limiter, 'attacker')).toBe(minute)
	expect(blockedFor(limiter, 'owner')).toBe(0)
})

test('forgets failures a day after the last attempt', () => {
	const limiter = new AttemptLimiter()
	for (let attempt = 1; attempt <= 11; attempt++) {
		limiter.start('client')
		vi.advanceTimersByTime(minute)
	}

	// Still escalating a day later
	vi.advanceTimersByTime(24 * 60 * minute - minute)
	limiter.start('client')
	expect(blockedFor(limiter, 'client')).toBe(4 * minute)

	vi.advanceTimersByTime(24 * 60 * minute + 1)
	for (let attempt = 1; attempt <= 9; attempt++) limiter.start('client')
	expect(blockedFor(limiter, 'client')).toBe(0)
})

test('remembers a bounded number of clients, forgetting the one that has failed least', () => {
	const limiter = new AttemptLimiter()
	for (let attempt = 1; attempt <= 10; attempt++) limiter.start('blocked')
	limiter.start('one-failure')
	for (let attempt = 1; attempt <= 2; attempt++) limiter.start('two-failures')

	// A flood of new clients pushes out the oldest client with the fewest
	// failures, then each other
	for (let client = 1; client <= 9_997; client++) limiter.start(`flood-${client}`)
	for (let client = 1; client <= 20_000; client++) limiter.start(`overflow-${client}`)

	// So it can't be used to clear a block
	expect(blockedFor(limiter, 'blocked')).toBe(minute)
	for (let attempt = 1; attempt <= 7; attempt++) limiter.start('two-failures')
	expect(blockedFor(limiter, 'two-failures')).toBe(0)
	limiter.start('two-failures')
	expect(blockedFor(limiter, 'two-failures')).toBe(minute)

	// The single failure was forgotten
	for (let attempt = 1; attempt <= 9; attempt++) limiter.start('one-failure')
	expect(blockedFor(limiter, 'one-failure')).toBe(0)
})
