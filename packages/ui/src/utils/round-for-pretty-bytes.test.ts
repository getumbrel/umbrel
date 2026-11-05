import {describe, expect, test} from 'vitest'

import {roundForPrettyBytes} from './round-for-pretty-bytes'

describe('roundForPrettyBytes', () => {
	test('rounds only when that carries into the next unit', () => {
		expect(roundForPrettyBytes(999_600_000_000)).toBe(1_000_000_000_000)
		expect(roundForPrettyBytes(4_549_000_000_000)).toBe(4_549_000_000_000)
		expect(roundForPrettyBytes(999_400_000_000)).toBe(999_400_000_000)
		expect(roundForPrettyBytes(0)).toBe(0)
	})
})
