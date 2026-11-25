import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

// Migration and backup restore hand umbreld an install in data/import, which it activates on the
// next boot by swapping it with the data directory and then deleting the old data.
describe('Activating an imported install', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let failed = false
	const dataDirectory = '/home/umbrel/umbrel'
	const temporaryData = `${dataDirectory}-import-temp`

	// Boot the device, including what the guest was doing in the failure if it doesn't come back
	const boot = async () => {
		try {
			await umbreld.vm.powerOn()
			await umbreld.waitForStartup({waitForUser: true})
		} catch (error) {
			const diagnostics = await Promise.race([
				umbreld.vm
					.sshAsRoot(
						`for port in 80 22080; do echo "umbreld on :$port from inside the guest: $(curl -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:$port/trpc/user.exists || echo unreachable)"; done
						systemctl status umbrel --no-pager -l || true
						journalctl -b --no-pager -u umbrel | tail -100
						systemctl --failed --no-pager || true
						ls -la /home/umbrel ${dataDirectory} 2>&1 || true
						ls -la ${temporaryData} 2>&1 || true`,
					)
					.catch((sshError) => `Could not collect guest diagnostics over SSH: ${sshError}`),
				new Promise<string>((resolve) => setTimeout(() => resolve('Timed out collecting guest diagnostics'), 60_000)),
			])
			throw new Error(`${error instanceof Error ? error.message : error}\n\nGuest diagnostics:\n${diagnostics}`, {
				cause: error,
			})
		}
		await umbreld.login()
	}

	const getHomeFolders = async () => {
		const listing = await umbreld.client.files.list.query({path: '/Home'})
		return listing.files.map((file) => file.name)
	}

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'umbrel-home'})
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()
	})

	afterAll(async () => await umbreld?.cleanup())

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	test('stages an imported install in data/import', async () => {
		// The imported install is a copy of this one with a marker only it has, and the install it
		// replaces gets a marker of its own
		await umbreld.vm.sshAsRoot(`
			set -e
			systemctl stop umbrel
			cp -a ${dataDirectory} /home/umbrel/staged-import
			install -d -o umbrel -g umbrel /home/umbrel/staged-import/home/imported-install-marker
			install -d -o umbrel -g umbrel ${dataDirectory}/home/old-install-marker
			mv /home/umbrel/staged-import ${dataDirectory}/import
			sync
		`)
		await umbreld.vm.powerOff()
	})

	test('the imported install is live after the next boot and the old one is gone', async () => {
		await boot()

		const folders = await getHomeFolders()
		expect(folders).toContain('imported-install-marker')
		expect(folders).not.toContain('old-install-marker')

		const leftovers = await umbreld.vm.sshAsRoot(`ls -d ${temporaryData} ${dataDirectory}/import 2>/dev/null || true`)
		expect(leftovers.trim()).toBe('')
	})

	// Losing power while the old data is being deleted leaves it in the temporary directory. Losing
	// power just before the swap leaves the import there instead. Either way the install that's
	// running must be kept and the leftover deleted, never swapped in.
	test('a leftover temporary directory is deleted on the next boot without being activated', async () => {
		await umbreld.vm.sshAsRoot(`
			set -e
			systemctl stop umbrel
			cp -a ${dataDirectory} ${temporaryData}
			install -d -o umbrel -g umbrel ${temporaryData}/home/leftover-install-marker
			sync
		`)
		await umbreld.vm.forcePowerOff()
		await boot()

		const folders = await getHomeFolders()
		expect(folders).toContain('imported-install-marker')
		expect(folders).not.toContain('leftover-install-marker')

		const leftovers = await umbreld.vm.sshAsRoot(`ls -d ${temporaryData} 2>/dev/null || true`)
		expect(leftovers.trim()).toBe('')
	})
})
