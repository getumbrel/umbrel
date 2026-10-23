import {setTimeout as delay} from 'node:timers/promises'

import {execa} from 'execa'
import {describe, expect, test} from 'vitest'

import {installCommandOptions} from './install-command.ts'

describe('bounded machine install commands', () => {
	test('terminates a running child process when its install is cancelled', async () => {
		const controller = new AbortController()
		const child = execa(
			process.execPath,
			['-e', 'setInterval(() => {}, 1000)'],
			installCommandOptions(controller.signal),
		)
		await delay(20)

		controller.abort(new Error('[machine-install-cancelled]'))

		await expect(child).rejects.toMatchObject({isCanceled: true, killed: true})
	})

	test('terminates an install command that exceeds its explicit deadline', async () => {
		const child = execa(
			process.execPath,
			['-e', 'setInterval(() => {}, 1000)'],
			installCommandOptions(new AbortController().signal, 20),
		)

		await expect(child).rejects.toMatchObject({timedOut: true})
		await delay(50)
		expect(() => process.kill(child.pid!, 0)).toThrow()
	})
})
