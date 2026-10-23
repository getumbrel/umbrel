import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import pRetry from 'p-retry'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

describe.sequential('Network storage', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let failed = false
	let primaryMountPath: string
	let primaryShareName: string

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

	async function createLocalSambaShare(shareName: string) {
		await umbreld.client.files.createDirectory.mutate({path: `/Home/${shareName}`})
		await umbreld.client.files.createDirectory.mutate({path: `/Home/${shareName}/source-marker`})
		await umbreld.api.post(`files/upload?path=/Home/${shareName}/test-file.txt`, {body: 'test content'})
		await umbreld.client.files.addShare.mutate({path: `/Home/${shareName}`})
	}

	async function mountLocalSambaShare(shareName: string) {
		const sharePassword = await umbreld.client.files.sharePassword.query()

		return pRetry(
			() =>
				umbreld.client.files.addNetworkShare.mutate({
					host: 'localhost',
					share: `${shareName} (Umbrel)`,
					username: 'umbrel',
					password: sharePassword,
				}),
			{retries: 10, factor: 1, minTimeout: 1000, maxTimeout: 1000},
		)
	}

	async function expectMountedShareToContain(mountPath: string, name: string) {
		await pRetry(
			async () => {
				const listing = await umbreld.client.files.list.query({path: mountPath})
				expect(listing.files.map((file) => file.name)).toContain(name)
			},
			{retries: 20, factor: 1, minTimeout: 1000, maxTimeout: 1000},
		)
	}

	test('rejects network-storage RPCs without authentication after setup', async () => {
		await expect(umbreld.unauthenticatedClient.files.listNetworkShares.query()).rejects.toThrow('Invalid token')
		await expect(
			umbreld.unauthenticatedClient.files.addNetworkShare.mutate({
				host: 'localhost',
				share: 'test',
				username: 'user',
				password: 'pass',
			}),
		).rejects.toThrow('Invalid token')
		await expect(
			umbreld.unauthenticatedClient.files.removeNetworkShare.mutate({mountPath: '/Network/test/share'}),
		).rejects.toThrow('Invalid token')
		await expect(umbreld.unauthenticatedClient.files.discoverNetworkShareServers.query()).rejects.toThrow(
			'Invalid token',
		)
		await expect(
			umbreld.unauthenticatedClient.files.discoverNetworkSharesOnServer.query({
				host: 'localhost',
				username: 'user',
				password: 'pass',
			}),
		).rejects.toThrow('Invalid token')
		await expect(
			umbreld.unauthenticatedClient.files.isServerAnUmbrelDevice.query({address: 'localhost'}),
		).rejects.toThrow('Invalid token')
	})

	test('starts with no configured network shares', async () => {
		await expect(umbreld.client.files.listNetworkShares.query()).resolves.toEqual([])
	})

	test('cleans up the mount directory when mounting fails', async () => {
		await expect(
			umbreld.client.files.addNetworkShare.mutate({
				host: '127.0.0.1',
				share: 'missing-share',
				username: 'umbrel',
				password: 'wrong-password',
			}),
		).rejects.toThrow()

		await pRetry(
			async () => {
				const networkRoot = await umbreld.client.files.list.query({path: '/Network'})
				expect(networkRoot.files).toHaveLength(0)
			},
			{retries: 20, factor: 1, minTimeout: 1000, maxTimeout: 1000},
		)
	})

	test('adds a local Samba share as a CIFS network share', async () => {
		primaryShareName = 'network-vm-test'
		await createLocalSambaShare(primaryShareName)

		primaryMountPath = await mountLocalSambaShare(primaryShareName)
		expect(primaryMountPath).toBe(`/Network/localhost/${primaryShareName} (Umbrel)`)

		await expect(umbreld.client.files.listNetworkShares.query()).resolves.toEqual([
			{
				host: 'localhost',
				share: `${primaryShareName} (Umbrel)`,
				mountPath: primaryMountPath,
				isMounted: true,
			},
		])
		await expectMountedShareToContain(primaryMountPath, 'test-file.txt')
		await expectMountedShareToContain(primaryMountPath, 'source-marker')

		await umbreld.client.files.createDirectory.mutate({path: `${primaryMountPath}/new-directory`})
		await expectMountedShareToContain(primaryMountPath, 'new-directory')
	})

	test('rejects duplicate network shares', async () => {
		const sharePassword = await umbreld.client.files.sharePassword.query()

		await expect(
			umbreld.client.files.addNetworkShare.mutate({
				host: 'localhost',
				share: `${primaryShareName} (Umbrel)`,
				username: 'umbrel',
				password: sharePassword,
			}),
		).rejects.toThrow('already exists')
	})

	test('rejects invalid credentials for mounting and discovery', async () => {
		await expect(
			umbreld.client.files.addNetworkShare.mutate({
				host: 'localhost',
				share: `${primaryShareName} (Umbrel)`,
				username: 'umbrel',
				password: 'wrong-password',
			}),
		).rejects.toThrow()

		await expect(
			umbreld.client.files.discoverNetworkSharesOnServer.query({
				host: 'localhost',
				username: 'umbrel',
				password: 'wrong-password',
			}),
		).rejects.toThrow()
	})

	test('discovers shares on the local Samba server', async () => {
		const secondShareName = 'network-vm-discover-test'
		await createLocalSambaShare(secondShareName)
		const sharePassword = await umbreld.client.files.sharePassword.query()

		await pRetry(
			async () => {
				const shares = await umbreld.client.files.discoverNetworkSharesOnServer.query({
					host: 'localhost',
					username: 'umbrel',
					password: sharePassword,
				})

				expect(shares).toEqual(expect.arrayContaining([`${primaryShareName} (Umbrel)`, `${secondShareName} (Umbrel)`]))
			},
			{retries: 20, factor: 1, minTimeout: 1000, maxTimeout: 1000},
		)
	})

	test('detects whether a network address is an Umbrel device', async () => {
		await expect(umbreld.client.files.isServerAnUmbrelDevice.query({address: 'localhost'})).resolves.toBe(true)
		await expect(umbreld.client.files.isServerAnUmbrelDevice.query({address: 'localhost:9'})).resolves.toBe(false)
	})

	test('enforces network-file permissions and protected mount paths', async () => {
		const hostnamePath = '/Network/localhost'
		const networkPath = '/Network'
		const networkFilePath = `${primaryMountPath}/test-file.txt`

		await expect(umbreld.client.files.trash.mutate({path: networkFilePath})).rejects.toThrow('[operation-not-allowed]')

		for (const path of [networkPath, hostnamePath, primaryMountPath]) {
			await expect(umbreld.client.files.trash.mutate({path})).rejects.toThrow('[operation-not-allowed]')
			await expect(umbreld.client.files.delete.mutate({path})).rejects.toThrow('[operation-not-allowed]')
			await expect(umbreld.client.files.move.mutate({path, toDirectory: '/Home'})).rejects.toThrow(
				'[operation-not-allowed]',
			)
			await expect(umbreld.client.files.rename.mutate({path, newName: 'Renamed Network Share'})).rejects.toThrow(
				'[operation-not-allowed]',
			)
		}

		await expect(umbreld.client.files.createDirectory.mutate({path: '/Network/localhost/test'})).rejects.toThrow(
			'[operation-not-allowed]',
		)
		await expect(
			umbreld.client.files.createDirectory.mutate({path: `/Network/localhost/${primaryShareName} Sibling`}),
		).rejects.toThrow('[operation-not-allowed]')

		for (const path of [networkPath, hostnamePath, primaryMountPath, networkFilePath]) {
			await expect(umbreld.client.files.addShare.mutate({path})).rejects.toThrow('[operation-not-allowed]')
		}

		await expect(umbreld.client.files.delete.mutate({path: networkFilePath})).resolves.toBe(true)
		const listing = await umbreld.client.files.list.query({path: primaryMountPath})
		expect(listing.files.map((file) => file.name)).not.toContain('test-file.txt')
	})

	test('removes a configured network share', async () => {
		await expect(umbreld.client.files.removeNetworkShare.mutate({mountPath: primaryMountPath})).resolves.toBe(true)
		await expect(umbreld.client.files.listNetworkShares.query()).resolves.not.toEqual(
			expect.arrayContaining([expect.objectContaining({mountPath: primaryMountPath})]),
		)
		await expect(
			umbreld.client.files.removeNetworkShare.mutate({mountPath: '/Network/non-existent/share'}),
		).rejects.toThrow('Share with mount path /Network/non-existent/share not found')
	})
})
