import {afterEach, describe, expect, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import {
	errorMarkerPath,
	installPreStartHook,
	rebootAndAssertUmbreldStarts,
	runSudoScript,
	type TestUmbreldVm,
} from './custom-hooks.vm-test-helpers.ts'

describe('Custom pre-start hook failure handling', () => {
	let umbreld: TestUmbreldVm | undefined

	afterEach(async () => {
		await umbreld?.cleanup()
		umbreld = undefined
	})

	test('starts umbreld on the next boot when a pre-start hook exits with an error', async () => {
		// Boot and register a fresh Umbrel Home so the failed hook runs during a real reboot.
		umbreld = await createTestVm({device: 'umbrel-home'})
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()

		// Install a hook that proves it ran and then fails with a non-zero exit code.
		const hookScript = `#!/bin/sh
set -eu
printf 'failed\\n' > '${errorMarkerPath}'
exit 42
`
		await installPreStartHook(umbreld, hookScript)

		// The wrapper should absorb the hook failure and still allow umbreld to start.
		await rebootAndAssertUmbreldStarts(umbreld)

		const errorMarker = await runSudoScript(umbreld, `cat '${errorMarkerPath}'`)
		expect(errorMarker.trim()).toBe('failed')

		const preStartLogs = await runSudoScript(umbreld, 'journalctl -b -u umbrel-custom-pre-start.service --no-pager')
		expect(preStartLogs).toContain('exited with status 42')
	}, 600_000)
})
