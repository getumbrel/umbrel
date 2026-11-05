import {afterEach, describe, expect, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import {
	hangFinishedPath,
	hangStatePath,
	installPreStartHook,
	rebootAndAssertUmbreldStarts,
	runSudoScript,
	type TestUmbreldVm,
} from './custom-hooks.vm-test-helpers.ts'

describe('Custom pre-start hook timeout handling', () => {
	let umbreld: TestUmbreldVm | undefined

	afterEach(async () => {
		await umbreld?.cleanup()
		umbreld = undefined
	})

	test('starts umbreld on the next boot when a pre-start hook hangs for a long time', async () => {
		// The default pre-start hook timeout is five minutes, so this VM needs a longer boot wait.
		umbreld = await createTestVm({device: 'umbrel-home', startupTimeout: 600_000})
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()

		// Install a hook that starts, then hangs longer than the wrapper allows.
		const hookScript = `#!/bin/sh
set -eu
printf 'started\\n' > '${hangStatePath}'
sleep 600
printf 'finished\\n' > '${hangFinishedPath}'
`
		await installPreStartHook(umbreld, hookScript)

		// Reboot through the normal boot path and wait for the real hook timeout.
		await rebootAndAssertUmbreldStarts(umbreld)

		const hangState = await runSudoScript(umbreld, `cat '${hangStatePath}'`)
		expect(hangState.trim()).toBe('started')

		const finishedMarker = await runSudoScript(umbreld, `test ! -e '${hangFinishedPath}' && printf 'missing\\n'`)
		expect(finishedMarker.trim()).toBe('missing')

		const preStartLogs = await runSudoScript(umbreld, 'journalctl -b -u umbrel-custom-pre-start.service --no-pager')
		expect(preStartLogs).toContain('timed out after 5m')
	}, 900_000)
})
