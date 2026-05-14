import {Buffer} from 'node:buffer'

import {expect, afterAll, describe, test} from 'vitest'
import pRetry from 'p-retry'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

describe('Custom pre-start hooks', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>

	const umbrelDataDirectory = '/home/umbrel/umbrel'
	const hooksDirectory = `${umbrelDataDirectory}/custom-hooks`
	const hookPath = `${hooksDirectory}/pre-start`
	const runCountPath = `${hooksDirectory}/pre-start-run-count`
	const processStatePath = `${hooksDirectory}/pre-start-umbrel-process-state`
	const bootMarkerPath = '/run/umbrel-custom-pre-start-vm-test'
	const setupMarker = 'pre-start-hook-setup-complete'
	const systemPassword = 'moneyprintergobrrr'

	afterAll(async () => await umbreld?.cleanup())

	test('runs a persisted pre-start hook on the next boot before umbreld starts', async () => {
		umbreld = await createTestVm({device: 'umbrel-home'})
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()

		const hookScript = `#!/bin/sh
set -eu

hooks_directory="/home/umbrel/umbrel/custom-hooks"
run_count_path="$hooks_directory/pre-start-run-count"
process_state_path="$hooks_directory/pre-start-umbrel-process-state"
boot_marker_path="/run/umbrel-custom-pre-start-vm-test"

count=0
if [ -f "$run_count_path" ]; then
	count="$(cat "$run_count_path")"
fi
printf '%s\\n' "$((count + 1))" > "$run_count_path"

if pgrep -f 'umbreld --data-directory=/home/umbrel/umbrel' >/dev/null; then
	printf 'running\\n' > "$process_state_path"
else
	printf 'not-running\\n' > "$process_state_path"
fi

printf 'ran\\n' > "$boot_marker_path"
`
		const encodedHookScript = Buffer.from(hookScript).toString('base64')

		const setupOutput = await umbreld.vm.ssh(`
{
printf '%s\\n' '${systemPassword}' | sudo -S -p '' sh -c "set -eu
mkdir -p '${hooksDirectory}'
printf '%s' '${encodedHookScript}' | base64 -d > '${hookPath}'
chmod +x '${hookPath}'
rm -f '${runCountPath}' '${processStatePath}' '${bootMarkerPath}'
test -x '${hookPath}'
echo '${setupMarker}'
"
} 2>&1
`)

		expect(setupOutput).toContain(setupMarker)
		expect((await umbreld.vm.ssh(`test -x '${hookPath}' && echo executable || echo missing`)).trim()).toBe('executable')
		expect((await umbreld.vm.ssh(`test -e '${runCountPath}' && echo exists || echo missing`)).trim()).toBe('missing')

		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.login()

		await pRetry(
			async () => {
				expect((await umbreld.vm.ssh(`test -x '${hookPath}' && echo executable || echo missing`)).trim()).toBe(
					'executable',
				)
				expect((await umbreld.vm.ssh(`cat '${runCountPath}' 2>/dev/null || true`)).trim()).toBe('1')
				expect((await umbreld.vm.ssh(`cat '${processStatePath}' 2>/dev/null || true`)).trim()).toBe('not-running')
				expect((await umbreld.vm.ssh(`cat '${bootMarkerPath}' 2>/dev/null || true`)).trim()).toBe('ran')
			},
			{retries: 50, minTimeout: 100, maxTimeout: 100},
		)
	})
})
