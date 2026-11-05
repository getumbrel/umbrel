import {describe, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'
import type {Context} from '../server/trpc/context.ts'
import routes from './routes.ts'

function createCaller(accountId: string) {
	const samba = {
		getSharePassword: vi.fn(async () => 'share-password'),
		setSharePassword: vi.fn(async () => true),
		listShares: vi.fn(async () => []),
		addShare: vi.fn(async (path: string) => path),
		removeShare: vi.fn(async () => true),
		listMemberAccess: vi.fn(async () => []),
		setMemberAccess: vi.fn(async (userId: string, enabled: boolean) => ({
			userId,
			enabled,
			username: userId.toLowerCase(),
		})),
	}
	const umbreld = {
		auth: {validatePrincipal: vi.fn(async () => {})},
		files: {samba},
	} as unknown as Umbreld
	const context = {
		umbreld,
		transport: 'ws',
		principal: {sessionId: `${accountId}-session`, accountId, actor: 'account'},
		logger: {verbose: vi.fn(), error: vi.fn()},
		dangerouslyBypassAuthentication: false,
	} as unknown as Context
	return {caller: routes.createCaller(context), samba}
}

describe('account-scoped Samba routes', () => {
	test('derives every member share operation from the authenticated principal', async () => {
		const {caller, samba} = createCaller('Alice')

		await expect(caller.sharePassword()).resolves.toBe('share-password')
		await expect(caller.setSharePassword({password: 'new-password'})).resolves.toBe(true)
		await expect(caller.shares()).resolves.toEqual([])
		await expect(caller.addShare({path: '/Users/Alice/Documents'})).resolves.toBe('/Users/Alice/Documents')
		await expect(caller.removeShare({path: '/Users/Alice/Documents'})).resolves.toBe(true)

		expect(samba.getSharePassword).toHaveBeenCalledWith('Alice')
		expect(samba.setSharePassword).toHaveBeenCalledWith('Alice', 'new-password')
		expect(samba.listShares).toHaveBeenCalledWith('Alice')
		expect(samba.addShare).toHaveBeenCalledWith('/Users/Alice/Documents', 'Alice')
		expect(samba.removeShare).toHaveBeenCalledWith('/Users/Alice/Documents', 'Alice')
	})

	test('keeps member access administration owner-only', async () => {
		const member = createCaller('Alice')
		const owner = createCaller('0')
		const ownerOnly = 'This action can only be performed by the owner'

		await expect(member.caller.memberSambaAccess()).rejects.toThrow(ownerOnly)
		await expect(member.caller.setMemberSambaAccess({userId: 'Alice', enabled: true})).rejects.toThrow(ownerOnly)
		expect(member.samba.listMemberAccess).not.toHaveBeenCalled()
		expect(member.samba.setMemberAccess).not.toHaveBeenCalled()

		await expect(owner.caller.memberSambaAccess()).resolves.toEqual([])
		await expect(owner.caller.setMemberSambaAccess({userId: 'Alice', enabled: true})).resolves.toEqual({
			userId: 'Alice',
			enabled: true,
			username: 'alice',
		})
	})

	test('rejects Samba passwords that cannot be passed safely to smbpasswd', async () => {
		const {caller, samba} = createCaller('Alice')

		await expect(caller.setSharePassword({password: 'short'})).rejects.toThrow('at least 6')
		await expect(caller.setSharePassword({password: 'x'.repeat(128)})).rejects.toThrow('at most 127')
		await expect(caller.setSharePassword({password: 'unsafe\npassword'})).rejects.toThrow('unsupported characters')
		expect(samba.setSharePassword).not.toHaveBeenCalled()
	})
})
