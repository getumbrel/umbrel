import {expect, beforeAll, afterAll, describe, test} from 'vitest'
import pRetry from 'p-retry'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

describe('Network storage', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>

	const sharePassword = 'correct,horse,battery,staple'
	const vmDataDirectory = '/home/umbrel/umbrel'

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'umbrel-home'})
		await umbreld.vm.powerOn()
		await umbreld.signup()
		await umbreld.login()
	})

	afterAll(async () => await umbreld?.cleanup())

	test('mounts a CIFS share with commas in the password', async () => {
		const shareName = 'network-comma-password-test'

		await umbreld.client.files.createDirectory.mutate({path: `/Home/${shareName}`})
		await umbreld.client.files.createDirectory.mutate({path: `/Home/${shareName}/source-marker`})

		// There is no product API for choosing the Samba share password; set the
		// real secret and smbpasswd entry in the VM to exercise comma parsing.
		await pRetry(
			() =>
				umbreld.vm.sshAsRoot(`
set -eu
mkdir -p ${vmDataDirectory}/secrets
printf '%s' '${sharePassword}' > ${vmDataDirectory}/secrets/share-password
printf '%s\\n%s\\n' '${sharePassword}' '${sharePassword}' | smbpasswd -s -a umbrel
`),
			{retries: 20, factor: 1, minTimeout: 1000, maxTimeout: 1000},
		)
		await expect(umbreld.client.files.sharePassword.query()).resolves.toBe(sharePassword)
		await umbreld.client.files.addShare.mutate({path: `/Home/${shareName}`})

		const mountPath = await pRetry(
			() =>
				umbreld.client.files.addNetworkShare.mutate({
					host: 'localhost',
					share: `${shareName} (Umbrel)`,
					username: 'umbrel',
					password: sharePassword,
				}),
			{retries: 5, factor: 1},
		)

		expect(mountPath).toBe(`/Network/localhost/${shareName} (Umbrel)`)

		const networkFiles = await umbreld.client.files.list.query({path: mountPath})
		expect(networkFiles.files.map((file) => file.name)).toContain('source-marker')
	})
})
