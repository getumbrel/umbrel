import nodePath from 'node:path'

import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import {
	createVmCloudFixtureDirectory,
	startVmCloudWebDav,
	waitForSync,
	VM_CLOUD_WEBDAV_PASSWORD,
	VM_CLOUD_WEBDAV_URL,
	VM_CLOUD_WEBDAV_USERNAME,
	writeVmCloudFixture,
} from './cloud.vm-test-helpers.ts'

const ownerPassword = 'moneyprintergobrrr'
const memberPassword = 'member-password'
const ownerDestination = '/Home/Cloud/Owner'

describe.sequential('Cloud account isolation', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let failed = false
	let ownerAccountId: string
	let ownerSyncId: string
	let memberAccountId: string
	let memberSyncId: string
	let memberUserId: string
	let memberDestination: string

	const loginAs = async (userId: string, password: string) => {
		const token = await umbreld.client.user.login.mutate({userId, password})
		umbreld.setAuthToken(token)
	}

	const connectWebDav = () =>
		umbreld.client.files.cloud.connectWebDav.mutate({
			flavor: 'webdav',
			url: VM_CLOUD_WEBDAV_URL,
			username: VM_CLOUD_WEBDAV_USERNAME,
			password: VM_CLOUD_WEBDAV_PASSWORD,
			tlsMode: 'default',
		})

	const upload = (path: string, body: string) =>
		umbreld.api.post(`files/upload?path=${encodeURIComponent(path)}`, {body})

	const rejectionMessage = async (operation: () => Promise<unknown>) => {
		let rejection: unknown
		try {
			await operation()
		} catch (error) {
			rejection = error
		}
		expect(rejection).toBeInstanceOf(Error)
		return (rejection as Error).message
	}

	const expectIndistinguishablePrivateRejection = async (
		cloudOperation: () => Promise<unknown>,
		nonCloudOperation: () => Promise<unknown>,
	) => {
		const cloudMessage = await rejectionMessage(cloudOperation)
		const nonCloudMessage = await rejectionMessage(nonCloudOperation)
		expect(cloudMessage).not.toContain('[cloud-read-only]')
		// Authorization errors echo the path the caller supplied, so compare
		// their externally meaningful response code rather than those inputs.
		expect(cloudMessage.match(/^\[[^\]]+\]/)?.[0]).toBe(nonCloudMessage.match(/^\[[^\]]+\]/)?.[0])
	}

	const expectOtherDestinationPrivate = async ({
		destination,
		nonCloudDestination,
		importedFile,
		ownSource,
	}: {
		destination: string
		nonCloudDestination: string
		importedFile: string
		ownSource: string
	}) => {
		const nonCloudFile = `${nonCloudDestination}/private.txt`
		const ownDirectory = nodePath.posix.dirname(ownSource)
		const identity = {device: 0, inode: 0, birthtimeMs: 0}
		const expectPrivatePair = (cloudOperation: () => Promise<unknown>, nonCloudOperation: () => Promise<unknown>) =>
			expectIndistinguishablePrivateRejection(cloudOperation, nonCloudOperation)

		await expectPrivatePair(
			() => umbreld.client.files.createDirectory.mutate({path: `${destination}/new-directory`}),
			() => umbreld.client.files.createDirectory.mutate({path: `${nonCloudDestination}/new-directory`}),
		)
		await expectPrivatePair(
			() => umbreld.client.files.cleanupCreatedDirectory.mutate({path: destination, identity}),
			() => umbreld.client.files.cleanupCreatedDirectory.mutate({path: nonCloudDestination, identity}),
		)
		await expectPrivatePair(
			() => umbreld.client.files.copy.mutate({path: ownSource, toDirectory: destination}),
			() => umbreld.client.files.copy.mutate({path: ownSource, toDirectory: nonCloudDestination}),
		)
		await expectPrivatePair(
			() => umbreld.client.files.move.mutate({path: ownSource, toDirectory: destination}),
			() => umbreld.client.files.move.mutate({path: ownSource, toDirectory: nonCloudDestination}),
		)
		await expectPrivatePair(
			() => umbreld.client.files.copy.mutate({path: importedFile, toDirectory: ownDirectory}),
			() => umbreld.client.files.copy.mutate({path: nonCloudFile, toDirectory: ownDirectory}),
		)
		await expectPrivatePair(
			() => umbreld.client.files.move.mutate({path: importedFile, toDirectory: ownDirectory}),
			() => umbreld.client.files.move.mutate({path: nonCloudFile, toDirectory: ownDirectory}),
		)
		await expectPrivatePair(
			() => umbreld.client.files.rename.mutate({path: importedFile, newName: 'renamed.txt'}),
			() => umbreld.client.files.rename.mutate({path: nonCloudFile, newName: 'renamed.txt'}),
		)
		await expectPrivatePair(
			() => umbreld.client.files.trash.mutate({path: importedFile}),
			() => umbreld.client.files.trash.mutate({path: nonCloudFile}),
		)
		await expectPrivatePair(
			() => umbreld.client.files.delete.mutate({path: importedFile}),
			() => umbreld.client.files.delete.mutate({path: nonCloudFile}),
		)
		await expectPrivatePair(
			() => umbreld.client.files.deleteMany.mutate({paths: [importedFile]}),
			() => umbreld.client.files.deleteMany.mutate({paths: [nonCloudFile]}),
		)
		await expectPrivatePair(
			() => umbreld.client.files.archive.mutate({paths: [importedFile]}),
			() => umbreld.client.files.archive.mutate({paths: [nonCloudFile]}),
		)
		await expectPrivatePair(
			() => umbreld.client.files.unarchive.mutate({path: importedFile}),
			() => umbreld.client.files.unarchive.mutate({path: nonCloudFile}),
		)
		await expectPrivatePair(
			() => umbreld.client.files.pathOperations.query({path: destination}),
			() => umbreld.client.files.pathOperations.query({path: nonCloudDestination}),
		)

		const cloudUploadError = await upload(`${destination}/uploaded.txt`, 'blocked').catch((error) => error)
		const nonCloudUploadError = await upload(`${nonCloudDestination}/uploaded.txt`, 'blocked').catch((error) => error)
		expect(cloudUploadError.response.statusCode).toBe(nonCloudUploadError.response.statusCode)
		expect(cloudUploadError.response.body).toEqual(nonCloudUploadError.response.body)
		expect(cloudUploadError.response.body).toMatchObject({error: 'invalid path'})
	}

	beforeAll(async () => {
		umbreld = await createTestVm({device: 'umbrel-home'})
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()
		await createVmCloudFixtureDirectory(umbreld, '/owner')
		await createVmCloudFixtureDirectory(umbreld, '/member')
		await writeVmCloudFixture(umbreld, '/owner/owner.txt', 'owner cloud data')
		await writeVmCloudFixture(umbreld, '/member/member.txt', 'member cloud data')
		await startVmCloudWebDav(umbreld)
	})

	afterAll(async () => await umbreld?.cleanup())

	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	test('creates independent Cloud accounts and imports for the owner and a member', async () => {
		const ownerAccount = await connectWebDav()
		ownerAccountId = ownerAccount.account.id
		await umbreld.client.files.createDirectory.mutate({path: '/Home/Cloud'})
		await umbreld.client.files.createDirectory.mutate({path: ownerDestination})
		const ownerSync = await umbreld.client.files.cloud.create.mutate({
			accountId: ownerAccountId,
			remote: {path: '/owner'},
			destination: {path: ownerDestination},
			mode: 'auto',
		})
		ownerSyncId = ownerSync.id
		await waitForSync(umbreld.client, ownerSyncId, ({status}) => status.state === 'idle')

		const member = await umbreld.client.user.createUser.mutate({name: 'Alice', password: memberPassword})
		memberUserId = member.userId
		memberDestination = `/Users/${memberUserId}/Cloud`
		await loginAs(memberUserId, memberPassword)

		const memberAccount = await connectWebDav()
		memberAccountId = memberAccount.account.id
		await umbreld.client.files.createDirectory.mutate({path: memberDestination})
		const memberSync = await umbreld.client.files.cloud.create.mutate({
			accountId: memberAccountId,
			remote: {path: '/member'},
			destination: {path: memberDestination},
			mode: 'auto',
		})
		memberSyncId = memberSync.id
		await waitForSync(umbreld.client, memberSyncId, ({status}) => status.state === 'idle')

		expect((await umbreld.client.files.cloud.accounts.query()).map(({id}) => id)).toEqual([memberAccountId])
		expect((await umbreld.client.files.cloud.syncs.query()).map(({id}) => id)).toEqual([memberSyncId])
		expect((await umbreld.client.files.list.query({path: memberDestination})).files.map(({name}) => name)).toEqual([
			'member.txt',
		])
		await expect(umbreld.client.files.cloud.pause.mutate({syncId: ownerSyncId})).rejects.toThrow('[cloud-not-found]')
		await expect(umbreld.client.files.cloud.locations.query({accountId: ownerAccountId})).rejects.toThrow(
			'[cloud-account-not-found]',
		)
	})

	test("does not reveal the owner's Cloud destinations through member Files mutations", async () => {
		const memberSource = `/Users/${memberUserId}/outside.txt`
		await upload(memberSource, 'member-owned source')
		await expectOtherDestinationPrivate({
			destination: ownerDestination,
			nonCloudDestination: '/Home/Private',
			importedFile: `${ownerDestination}/owner.txt`,
			ownSource: memberSource,
		})
		expect(
			(await umbreld.client.files.list.query({path: `/Users/${memberUserId}`})).files.map(({name}) => name),
		).toEqual(expect.arrayContaining(['Cloud', 'outside.txt']))
	})

	test("does not reveal the member's Cloud destinations through owner Files mutations", async () => {
		await loginAs('0', ownerPassword)
		expect((await umbreld.client.files.cloud.accounts.query()).map(({id}) => id)).toEqual([ownerAccountId])
		expect((await umbreld.client.files.cloud.syncs.query()).map(({id}) => id)).toEqual([ownerSyncId])
		await expect(umbreld.client.files.cloud.pause.mutate({syncId: memberSyncId})).rejects.toThrow('[cloud-not-found]')

		await umbreld.client.files.createDirectory.mutate({path: '/Home/Outside'})
		const ownerSource = '/Home/Outside/owner-source.txt'
		await upload(ownerSource, 'owner source')
		await expectOtherDestinationPrivate({
			destination: memberDestination,
			nonCloudDestination: `/Users/${memberUserId}/Private`,
			importedFile: `${memberDestination}/member.txt`,
			ownSource: ownerSource,
		})
		expect((await umbreld.client.files.list.query({path: ownerDestination})).files.map(({name}) => name)).toEqual([
			'owner.txt',
		])
	})

	test('each account can remove only its own Cloud state', async () => {
		await loginAs(memberUserId, memberPassword)
		await umbreld.client.files.cloud.removeAccount.mutate({
			accountId: memberAccountId,
			confirmedSyncIds: [memberSyncId],
		})
		expect(await umbreld.client.files.cloud.accounts.query()).toEqual([])
		await expect(
			umbreld.client.files.createDirectory.mutate({path: `${memberDestination}/editable-after-removal`}),
		).resolves.toMatchObject({created: true})

		await loginAs('0', ownerPassword)
		expect((await umbreld.client.files.cloud.accounts.query()).map(({id}) => id)).toEqual([ownerAccountId])
		await umbreld.client.files.cloud.removeAccount.mutate({
			accountId: ownerAccountId,
			confirmedSyncIds: [ownerSyncId],
		})
		await umbreld.client.user.deleteUser.mutate({userId: memberUserId})
		expect(await umbreld.client.files.cloud.accounts.query()).toEqual([])
		expect(await umbreld.client.files.cloud.syncs.query()).toEqual([])
	})
})
