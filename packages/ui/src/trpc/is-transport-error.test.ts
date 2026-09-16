import {TRPCClientError} from '@trpc/client'
import {describe, expect, test} from 'vitest'

import {isTransportError} from './is-transport-error'

// What each runtime's fetch() rejects with when the server never answers
const fetchFailures = [
	['Chrome', 'Failed to fetch'],
	['Firefox', 'NetworkError when attempting to fetch resource.'],
	['Safari', 'Load failed'],
	['Node', 'fetch failed'],
] as const

describe('isTransportError', () => {
	test.each(fetchFailures)('%s fetch failure is a transport error', (_runtime, message) => {
		const error = TRPCClientError.from(new TypeError(message))
		expect(error.message).toBe(message)
		expect(isTransportError(error)).toBe(true)
	})

	test('an error the server answered with is not a transport error', () => {
		// What umbreld sends when checkInitialRaidSetupStatus rethrows initialRaidSetupError
		const error = TRPCClientError.from({
			error: {
				message: 'Failed to create pool',
				code: -32603,
				data: {code: 'INTERNAL_SERVER_ERROR', httpStatus: 500, path: 'hardware.raid.checkInitialRaidSetupStatus'},
			},
		})
		expect(error.message).toBe('Failed to create pool')
		expect(isTransportError(error)).toBe(false)
	})

	test('no error is not a transport error', () => {
		expect(isTransportError(null)).toBe(false)
		expect(isTransportError(undefined)).toBe(false)
	})
})
