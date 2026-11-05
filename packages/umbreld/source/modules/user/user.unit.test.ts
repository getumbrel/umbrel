import nodePath from 'node:path'

import fse from 'fs-extra'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import Umbreld from '../../index.ts'
import temporaryDirectory from '../utilities/temporary-directory.ts'
import * as totp from '../utilities/totp.ts'

const accountAvatarDirectory = (umbreld: Umbreld, userId: string) =>
	nodePath.join(umbreld.dataDirectory, 'avatars', userId)
const accountAvatarPath = (umbreld: Umbreld, userId: string, hash: string) =>
	nodePath.join(accountAvatarDirectory(umbreld, userId), `${hash}.webp`)

describe('member lifecycle', () => {
	let directory: ReturnType<typeof temporaryDirectory>
	let dataDirectory: string
	let umbreld: Umbreld

	beforeEach(async () => {
		directory = temporaryDirectory()
		await directory.createRoot()
		dataDirectory = await directory.create()
		umbreld = new Umbreld({dataDirectory})
		await umbreld.store.set('user', {name: 'Owner', hashedPassword: 'unused'})
		vi.spyOn(umbreld.files, 'createMemberDirectories').mockResolvedValue()
		vi.spyOn(umbreld.files, 'deleteMemberDirectories').mockResolvedValue()
		vi.spyOn(umbreld.files.cloud, 'removeUser').mockResolvedValue()
		vi.spyOn(umbreld.files.samba, 'removeUser').mockResolvedValue(false)
		vi.spyOn(umbreld.files.memberShares, 'removeUserFromShares').mockResolvedValue()
		vi.spyOn(umbreld.apps, 'removeUserFromMemberShares').mockResolvedValue()
		vi.spyOn(umbreld.auth, 'revokeAllForAccount').mockResolvedValue(0)
		vi.spyOn(umbreld.photos, 'deleteAccount').mockResolvedValue()
		vi.spyOn(umbreld.hardware.raid, 'hasConfigStore').mockResolvedValue(false)
	})

	afterEach(async () => {
		vi.restoreAllMocks()
		await umbreld.auth.stop()
		await directory.destroyRoot()
	})

	test('permanently reserves a deleted member id and retries interrupted cleanup', async () => {
		const first = await umbreld.user.createUser('Alice', 'passwordpassword')
		expect(first.userId).toBe('Alice')

		vi.mocked(umbreld.auth.revokeAllForAccount).mockRejectedValueOnce(new Error('simulated cleanup failure'))
		await expect(umbreld.user.deleteUser(first.userId)).rejects.toThrow('simulated cleanup failure')

		// The account disappears immediately even though cleanup did not finish.
		expect(await umbreld.user.getMember(first.userId)).toBeUndefined()
		expect(await umbreld.user.listMembers()).toEqual([])
		expect(await umbreld.user.listDeletedMemberIds()).toEqual(['Alice'])
		expect(await umbreld.store.get('members')).toEqual([{id: 'Alice', deleted: true}])
		expect(umbreld.files.cloud.removeUser).toHaveBeenCalledWith('Alice')
		expect(umbreld.files.samba.removeUser).toHaveBeenCalledWith('Alice')
		expect(umbreld.files.deleteMemberDirectories).not.toHaveBeenCalled()

		// Reusing the display name creates a new security identity.
		const replacement = await umbreld.user.createUser('Alice', 'passwordpassword')
		expect(replacement.userId).toBe('Alice-2')

		// Retrying the original deletion resumes its idempotent cleanup.
		await expect(umbreld.user.deleteUser(first.userId)).resolves.toBe(true)
		expect(await umbreld.store.get('members')).toContainEqual({
			id: 'Alice',
			deleted: true,
			cleanupComplete: true,
		})
		expect(await umbreld.user.listDeletedMemberIds()).toEqual(['Alice'])
		expect(umbreld.files.cloud.removeUser).toHaveBeenCalledWith('Alice')
		expect(umbreld.photos.deleteAccount).toHaveBeenCalledWith('Alice')
		expect(umbreld.files.deleteMemberDirectories).toHaveBeenCalledWith('Alice')
		expect(umbreld.files.memberShares.removeUserFromShares).toHaveBeenCalledWith('Alice')
		expect(umbreld.apps.removeUserFromMemberShares).toHaveBeenCalledWith('Alice')
		expect(vi.mocked(umbreld.files.cloud.removeUser).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(umbreld.photos.deleteAccount).mock.invocationCallOrder[0],
		)
		expect(vi.mocked(umbreld.photos.deleteAccount).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(umbreld.files.deleteMemberDirectories).mock.invocationCallOrder[0],
		)
	})

	test('resumes pending member cleanup after restart', async () => {
		const member = await umbreld.user.createUser('Grace', 'passwordpassword')
		vi.mocked(umbreld.auth.revokeAllForAccount).mockRejectedValueOnce(new Error('simulated process interruption'))
		await expect(umbreld.user.deleteUser(member.userId)).rejects.toThrow('simulated process interruption')

		vi.restoreAllMocks()
		const restarted = new Umbreld({dataDirectory})
		vi.spyOn(restarted.files, 'deleteMemberDirectories').mockResolvedValue()
		vi.spyOn(restarted.files.cloud, 'removeUser').mockResolvedValue()
		vi.spyOn(restarted.files.samba, 'removeUser').mockResolvedValue(false)
		vi.spyOn(restarted.files.memberShares, 'removeUserFromShares').mockResolvedValue()
		vi.spyOn(restarted.apps, 'removeUserFromMemberShares').mockResolvedValue()
		vi.spyOn(restarted.auth, 'revokeAllForAccount').mockResolvedValue(0)
		vi.spyOn(restarted.photos, 'deleteAccount').mockResolvedValue()

		await restarted.user.finishPendingDeletions()

		expect(restarted.auth.revokeAllForAccount).toHaveBeenCalledWith('Grace')
		expect(restarted.files.cloud.removeUser).toHaveBeenCalledWith('Grace')
		expect(restarted.files.samba.removeUser).toHaveBeenCalledWith('Grace')
		expect(restarted.photos.deleteAccount).toHaveBeenCalledWith('Grace')
		expect(restarted.files.deleteMemberDirectories).toHaveBeenCalledWith('Grace')
		expect(await restarted.store.get('members')).toEqual([{id: 'Grace', deleted: true, cleanupComplete: true}])
	})

	test('keeps member files until retryable Cloud cleanup succeeds', async () => {
		const member = await umbreld.user.createUser('Alice', 'passwordpassword')
		vi.mocked(umbreld.files.cloud.removeUser).mockRejectedValueOnce(new Error('cloud cleanup unavailable'))

		await expect(umbreld.user.deleteUser(member.userId)).rejects.toThrow('cloud cleanup unavailable')

		expect(umbreld.files.cloud.removeUser).toHaveBeenCalledWith(member.userId)
		expect(umbreld.files.deleteMemberDirectories).not.toHaveBeenCalled()
		expect(await umbreld.store.get('members')).toEqual([{id: member.userId, deleted: true}])
	})

	test('keeps member files until retryable Samba cleanup succeeds', async () => {
		const member = await umbreld.user.createUser('Alice', 'passwordpassword')
		vi.mocked(umbreld.files.samba.removeUser).mockRejectedValueOnce(new Error('samba cleanup unavailable'))

		await expect(umbreld.user.deleteUser(member.userId)).rejects.toThrow('samba cleanup unavailable')
		expect(umbreld.files.samba.removeUser).toHaveBeenCalledWith(member.userId)
		expect(umbreld.files.deleteMemberDirectories).not.toHaveBeenCalled()
		expect(await umbreld.store.get('members')).toEqual([{id: member.userId, deleted: true}])

		await expect(umbreld.user.finishPendingDeletions()).resolves.toBeUndefined()
		expect(umbreld.files.samba.removeUser).toHaveBeenCalledTimes(2)
		expect(umbreld.files.deleteMemberDirectories).toHaveBeenCalledWith(member.userId)
	})

	test('retries member deletion when Photos cleanup fails', async () => {
		const member = await umbreld.user.createUser('Alice', 'passwordpassword')
		vi.mocked(umbreld.photos.deleteAccount).mockRejectedValueOnce(new Error('photos cleanup unavailable'))

		await expect(umbreld.user.deleteUser(member.userId)).rejects.toThrow('photos cleanup unavailable')

		expect(umbreld.photos.deleteAccount).toHaveBeenCalledWith(member.userId)
		expect(umbreld.files.deleteMemberDirectories).not.toHaveBeenCalled()
		expect(await umbreld.store.get('members')).toEqual([{id: member.userId, deleted: true}])

		await expect(umbreld.user.deleteUser(member.userId)).resolves.toBe(true)
		expect(umbreld.photos.deleteAccount).toHaveBeenCalledTimes(2)
		expect(umbreld.files.deleteMemberDirectories).toHaveBeenCalledWith(member.userId)
	})

	test('removes a deleted member avatar directory and retries an interrupted avatar cleanup', async () => {
		const member = await umbreld.user.createUser('Avatar owner', 'passwordpassword')
		const hash = 'a'.repeat(64)
		const avatarDirectory = accountAvatarDirectory(umbreld, member.userId)
		await umbreld.user.setAccountAvatarHash(member.userId, hash)
		await fse.outputFile(accountAvatarPath(umbreld, member.userId, hash), 'avatar')

		const originalRemove = fse.remove.bind(fse)
		const removeSpy = vi.spyOn(fse, 'remove').mockImplementation(async (path) => {
			if (path === avatarDirectory) throw new Error('simulated avatar cleanup failure')
			return originalRemove(path)
		})
		await expect(umbreld.user.deleteUser(member.userId)).rejects.toThrow('simulated avatar cleanup failure')
		expect(await fse.pathExists(avatarDirectory)).toBe(true)
		expect(await umbreld.store.get('members')).toEqual([{id: member.userId, deleted: true}])
		expect(umbreld.files.memberShares.removeUserFromShares).toHaveBeenCalledWith(member.userId)
		expect(umbreld.apps.removeUserFromMemberShares).toHaveBeenCalledWith(member.userId)

		removeSpy.mockRestore()
		await expect(umbreld.user.finishPendingDeletions()).resolves.toBeUndefined()
		expect(await fse.pathExists(avatarDirectory)).toBe(false)
		expect(await umbreld.store.get('members')).toEqual([{id: member.userId, deleted: true, cleanupComplete: true}])
	})

	test('does not rewrite member metadata when an existing account already has no avatar', async () => {
		const member = await umbreld.user.createUser('No avatar', 'passwordpassword')
		const originalWriteLock = umbreld.store.getWriteLock.bind(umbreld.store)
		let memberWrites = 0
		vi.spyOn(umbreld.store, 'getWriteLock').mockImplementation((job) =>
			originalWriteLock(async (methods) =>
				job({
					...methods,
					set: (async (property: string, value: unknown) => {
						if (property === 'members') memberWrites += 1
						return (methods.set as (property: string, value: unknown) => Promise<boolean>)(property, value)
					}) as typeof methods.set,
				}),
			),
		)

		await expect(umbreld.user.removeAccountAvatarHash(member.userId)).resolves.toBeUndefined()
		expect(memberWrites).toBe(0)
		await expect(umbreld.user.removeAccountAvatarHash('Missing')).rejects.toThrow('User not found')
		expect(memberWrites).toBe(0)
	})

	test('serializes display-name uniqueness checks with account renames', async () => {
		const first = await umbreld.user.createUser('Alice', 'passwordpassword')
		const second = await umbreld.user.createUser('Bob', 'passwordpassword')

		const results = await Promise.allSettled([
			umbreld.user.setAccountName(first.userId, 'Shared name'),
			umbreld.user.setAccountName(second.userId, 'Shared name'),
		])

		expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
		expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
		expect((await umbreld.user.listMembers()).filter((member) => member.name === 'Shared name')).toHaveLength(1)
	})

	test("reapplies Samba shares when the owner's display name changes", async () => {
		let nameWhenSharesApplied: string | undefined
		const applyShares = vi.spyOn(umbreld.files.samba, 'applyShares').mockImplementation(async () => {
			nameWhenSharesApplied = (await umbreld.user.get())?.name
			return undefined
		})

		await expect(umbreld.user.setAccountName('0', 'Renamed owner')).resolves.toBe(true)

		expect(await umbreld.user.get()).toMatchObject({name: 'Renamed owner'})
		expect(nameWhenSharesApplied).toBe('Renamed owner')
		expect(applyShares).toHaveBeenCalledOnce()
	})

	test("reapplies Samba shares when an enabled member's display name changes", async () => {
		const member = await umbreld.user.createUser('Alice', 'passwordpassword')
		const records = (await umbreld.store.get('members')) ?? []
		await umbreld.store.set(
			'members',
			records.map((record) =>
				record.id === member.userId && !('deleted' in record)
					? {...record, sambaPassword: 'member-samba-password'}
					: record,
			),
		)
		const applyShares = vi.spyOn(umbreld.files.samba, 'applyShares').mockResolvedValue(undefined)

		await expect(umbreld.user.setAccountName(member.userId, 'Renamed Alice')).resolves.toBe(true)
		expect((await umbreld.user.getMember(member.userId))?.name).toBe('Renamed Alice')
		expect(applyShares).toHaveBeenCalledOnce()
	})

	test('attempts the Samba refresh when the RAID mirror fails after an owner rename', async () => {
		vi.mocked(umbreld.hardware.raid.hasConfigStore).mockResolvedValue(true)
		vi.spyOn(umbreld.hardware.raid.configStore, 'set').mockRejectedValueOnce(new Error('RAID mirror unavailable'))
		const applyShares = vi.spyOn(umbreld.files.samba, 'applyShares').mockResolvedValue(undefined)

		await expect(umbreld.user.setAccountName('0', 'Renamed owner')).rejects.toThrow('RAID mirror unavailable')

		expect(await umbreld.user.get()).toMatchObject({name: 'Renamed owner'})
		expect(applyShares).toHaveBeenCalledOnce()
	})

	test("copies the owner's language when creating a member, then keeps both preferences independent", async () => {
		await umbreld.user.setAccountLanguage('0', 'fr')
		const member = await umbreld.user.createUser('Alice', 'passwordpassword')
		await expect(umbreld.user.getAccountLanguage(member.userId)).resolves.toBe('fr')
		await expect(umbreld.user.listAccounts()).resolves.toEqual([
			{userId: '0', name: 'Owner', wallpaper: undefined, language: 'fr'},
			{userId: member.userId, name: 'Alice', wallpaper: undefined, language: 'fr'},
		])

		await umbreld.user.setAccountLanguage('0', 'es')
		await expect(umbreld.user.getAccountLanguage(member.userId)).resolves.toBe('fr')

		await umbreld.user.setAccountLanguage(member.userId, 'de')
		await expect(umbreld.user.getAccountLanguage(member.userId)).resolves.toBe('de')
		await expect(umbreld.user.getAccountLanguage('0')).resolves.toBe('es')
		await expect(umbreld.user.listAccounts()).resolves.toEqual([
			{userId: '0', name: 'Owner', wallpaper: undefined, language: 'es'},
			{userId: member.userId, name: 'Alice', wallpaper: undefined, language: 'de'},
		])
	})

	test('does not issue a session from password and MFA state verified before an account reset', async () => {
		await umbreld.auth.start()
		const member = await umbreld.user.createUser('Satoshi', 'old-password')
		const totpUri = totp.generateUri('Umbrel', 'umbrel.local')
		await umbreld.user.enable2faForAccount(member.userId, totpUri)

		const staleValidation = await umbreld.user.validateAccountLogin(
			member.userId,
			'old-password',
			totp.generateToken(totpUri),
		)
		expect(staleValidation.valid).toBe(true)
		if (!staleValidation.valid) throw new Error('Expected valid login')

		await umbreld.user.resetMemberPassword(member.userId, 'new-password')

		await expect(
			umbreld.auth.createSession({
				accountId: member.userId,
				expectedSessionIssuanceRevision: staleValidation.sessionIssuanceRevision,
			}),
		).rejects.toThrow('Login credentials changed')
		await expect(umbreld.user.validateAccountLogin(member.userId, 'old-password')).resolves.toEqual({
			valid: false,
			reason: 'incorrect-password',
		})

		const currentValidation = await umbreld.user.validateAccountLogin(member.userId, 'new-password')
		expect(currentValidation.valid).toBe(true)
		if (!currentValidation.valid) throw new Error('Expected valid login')
		await expect(
			umbreld.auth.createSession({
				accountId: member.userId,
				expectedSessionIssuanceRevision: currentValidation.sessionIssuanceRevision,
			}),
		).resolves.toBeDefined()
	})
})
