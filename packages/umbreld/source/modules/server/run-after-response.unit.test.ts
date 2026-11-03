import {EventEmitter} from 'node:events'

import {describe, expect, test, vi} from 'vitest'

import {runAfterResponse} from './run-after-response.ts'

describe('runAfterResponse', () => {
	test('waits for the response to finish', () => {
		const response = new EventEmitter()
		const action = vi.fn()

		runAfterResponse(response, action)
		expect(action).not.toHaveBeenCalled()

		response.emit('finish')
		expect(action).toHaveBeenCalledOnce()

		response.emit('close')
		expect(action).toHaveBeenCalledOnce()
	})

	test('still runs when the connection closes before the response finishes', () => {
		const response = new EventEmitter()
		const action = vi.fn()

		runAfterResponse(response, action)
		response.emit('close')

		expect(action).toHaveBeenCalledOnce()
	})

	test('runs when the response closed before listeners were registered', () => {
		const response = Object.assign(new EventEmitter(), {destroyed: true})
		const action = vi.fn()

		runAfterResponse(response, action)
		expect(action).toHaveBeenCalledOnce()

		response.emit('close')
		expect(action).toHaveBeenCalledOnce()
	})

	test('defers callers without an HTTP response', async () => {
		const action = vi.fn()

		runAfterResponse(undefined, action)
		expect(action).not.toHaveBeenCalled()

		await new Promise<void>((resolve) => setImmediate(resolve))
		expect(action).toHaveBeenCalledOnce()
	})
})
