import {expect, test, vi} from 'vitest'

import {pullAll} from './docker-pull.js'

const {pull, followProgress} = vi.hoisted(() => ({
	pull: vi.fn(),
	followProgress: vi.fn(),
}))

vi.mock('dockerode', () => ({
	default: class {
		pull = pull
		modem = {followProgress}
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

test('pullAll passes resolved authconfig to dockerode pull for private images', async () => {
	pull.mockReset()
	followProgress.mockReset()

	// When followProgress is called, trigger onFinished
	followProgress.mockImplementation((stream, onFinished, onProgress) => {
		setImmediate(() => onFinished(null, {}))
	})

	const pullCalls: Array<{image: string; options: any; auth: any}> = []
	pull.mockImplementation((image, optionsOrCallback, callbackOrAuth, auth) => {
		if (typeof optionsOrCallback === 'function') {
			// (image, callback)
			pullCalls.push({image, options: undefined, auth: undefined})
			const cb = optionsOrCallback
			setImmediate(() => cb(null, {}))
		} else {
			// (image, options, callback, auth)
			pullCalls.push({image, options: optionsOrCallback, auth})
			const cb = callbackOrAuth
			setImmediate(() => cb(null, {}))
		}
	})

	const fakeAuth = {
		username: 'gl-user',
		password: 'gl-token',
		serveraddress: 'registry.gitlab.com',
	}

	await pullAll(
		['registry.gitlab.com/repo/private:1.0', 'ubuntu:latest'],
		() => {},
		(img) => (img.includes('gitlab') ? fakeAuth : undefined),
	)

	expect(pullCalls).toHaveLength(2)
	const privateCall = pullCalls.find((c) => c.image === 'registry.gitlab.com/repo/private:1.0')
	expect(privateCall).toBeDefined()
	expect(privateCall!.options).toEqual({authconfig: fakeAuth})
	expect(privateCall!.auth).toEqual(fakeAuth)

	const publicCall = pullCalls.find((c) => c.image === 'ubuntu:latest')
	expect(publicCall).toBeDefined()
	expect(publicCall!.options).toBeUndefined()
	expect(publicCall!.auth).toBeUndefined()
})
