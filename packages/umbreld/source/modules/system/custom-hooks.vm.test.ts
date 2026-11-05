import {afterEach, describe, expect, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import {
	bootMarkerPath,
	hookPath,
	installPreStartHook,
	processStatePath,
	rebootAndAssertUmbreldStarts,
	runCountPath,
	runSudoScript,
	type TestUmbreldVm,
} from './custom-hooks.vm-test-helpers.ts'

describe('Custom pre-start hook boot order', () => {
	let umbreld: TestUmbreldVm | undefined

	afterEach(async () => {
		await umbreld?.cleanup()
		umbreld = undefined
	})

	test('runs a persisted pre-start hook on the next boot before umbreld starts', async () => {
		// Boot and register a fresh Umbrel Home so the hook lives in persisted user data.
		umbreld = await createTestVm({device: 'umbrel-home'})
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()

		// Install a hook that records execution count and whether umbreld was already running.
		const hookScript = `#!/bin/sh
set -eu

count=0
if [ -f '${runCountPath}' ]; then
	count="$(cat '${runCountPath}')"
fi
printf '%s\\n' "$((count + 1))" > '${runCountPath}'

if pgrep -f 'umbreld --data-directory=/home/umbrel/umbrel' >/dev/null; then
	printf 'running\\n' > '${processStatePath}'
else
	printf 'not-running\\n' > '${processStatePath}'
fi

printf 'ran\\n' > '${bootMarkerPath}'
`
		await installPreStartHook(umbreld, hookScript)

		// Reboot through the normal boot path so systemd runs the hook before umbreld.
		await rebootAndAssertUmbreldStarts(umbreld)

		// Confirm the executable hook ran once and before the main umbreld service.
		const hookMode = await runSudoScript(umbreld, `stat -c '%a' '${hookPath}'`)
		expect(hookMode.trim()).toBe('755')

		const runCount = await runSudoScript(umbreld, `cat '${runCountPath}'`)
		expect(runCount.trim()).toBe('1')

		const processState = await runSudoScript(umbreld, `cat '${processStatePath}'`)
		expect(processState.trim()).toBe('not-running')

		const bootMarker = await runSudoScript(umbreld, `cat '${bootMarkerPath}'`)
		expect(bootMarker.trim()).toBe('ran')
	}, 600_000)
})
