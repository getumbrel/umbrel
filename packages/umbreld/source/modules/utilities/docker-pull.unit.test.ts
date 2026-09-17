import {expect, test, vi} from 'vitest'

import {pullAll} from './docker-pull.js'

const {pull} = vi.hoisted(() => ({pull: vi.fn()}))
vi.mock('dockerode', () => ({
	default: class {
		pull = pull
	},
}))

test('a failed parallel pull waits for all outstanding downloads before releasing the caller', async () => {
	const callbacks = new Map<string, (error: Error) => void>()
	pull.mockImplementation((image, callback) => callbacks.set(image, callback))
	const result = pullAll(['first', 'second'], () => {})
	const settled = vi.fn()
	const observed = result.then(settled, settled)
	const failure = new Error('first pull failed')
	callbacks.get('first')!(failure)
	await new Promise((resolve) => setImmediate(resolve))
	expect(settled).not.toHaveBeenCalled()
	callbacks.get('second')!(new Error('second pull failed later'))
	await observed
	await expect(result).rejects.toBe(failure)
})
