import {describe, expect, test} from 'vitest'

import {isTooLargeForSocket} from './socket-limit'

// A Photos item id: a content hash, 64 hex characters
const ids = (count: number) => Array.from({length: count}, (_, index) => index.toString(16).padStart(64, '0'))

describe('isTooLargeForSocket', () => {
	test('leaves ordinary changes on the socket', () => {
		expect(isTooLargeForSocket({type: 'mutation', input: {ids: ids(1500), favorite: true}})).toBe(false)
		expect(isTooLargeForSocket({type: 'mutation', input: undefined})).toBe(false)
	})

	test('sends a change naming a whole library over HTTP', () => {
		expect(isTooLargeForSocket({type: 'mutation', input: {ids: ids(20_000), favorite: true}})).toBe(true)
	})

	test('counts a change well short of the server limit as too large, with room for multi-byte names', () => {
		// 300,000 three-byte characters are 900 KB on the wire: still under 1 MiB, and already sent the other way
		expect(isTooLargeForSocket({type: 'mutation', input: {name: '写'.repeat(300_000)}})).toBe(true)
	})

	test('only ever reroutes changes', () => {
		expect(isTooLargeForSocket({type: 'query', input: {ids: ids(20_000)}})).toBe(false)
		expect(isTooLargeForSocket({type: 'subscription', input: {ids: ids(20_000)}})).toBe(false)
	})

	test('leaves what is not JSON where it was', () => {
		const circular: {self?: unknown} = {}
		circular.self = circular
		expect(isTooLargeForSocket({type: 'mutation', input: circular})).toBe(false)
	})
})
