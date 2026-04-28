import {expect, beforeAll, afterAll, describe, test} from 'vitest'
import pRetry from 'p-retry'

import {createTestVm} from '../test-utilities/create-test-umbreld.js'

describe('Network storage', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'umbrel-home'})
		await umbreld.vm.powerOn()
		await umbreld.signup()
		await umbreld.login()
	})

	afterAll(async () => await umbreld?.cleanup())

	test('mounts a CIFS share with commas in the password', async () => {
		const shareName = 'network-comma-password-test'
		const sharePassword = 'correct,horse,battery,staple'
		const systemPassword = 'moneyprintergobrrr'

		await umbreld.client.files.createDirectory.mutate({path: `/Home/${shareName}`})
		await umbreld.client.files.createDirectory.mutate({path: `/Home/${shareName}/source-marker`})

		const passwordUpdate = await umbreld.vm.ssh(
			`set -e; printf '%s\\n' '${systemPassword}' | sudo -S -p '' sh -c "printf '%s' '${sharePassword}' > ${umbreld.vm.dataDirectory}/secrets/share-password; printf '%s\\n%s\\n' '${sharePassword}' '${sharePassword}' | smbpasswd -s -a umbrel; echo samba-password-updated"`,
		)
		expect(passwordUpdate).toContain('samba-password-updated')

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
