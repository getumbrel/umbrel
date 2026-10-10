import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import nodePath from 'node:path'

import fse from 'fs-extra'
import {expect, test, vi} from 'vitest'

import type Umbreld from '../../index.js'
import MemberShares, {type MemberShare} from './member-shares.js'

function createMemberShares(fileShares: MemberShare[] = []) {
	const get = vi.fn(async (key: string) => {
		if (key === 'files.memberShares') return fileShares
		if (key === 'appMemberShares') return [{appId: 'sparkles-hello-world', sharedWith: 'all'}]
		return undefined
	})
	const sharedAppIdsForUser = vi.fn(async () => ['sparkles-hello-world'])
	const logger = {log: vi.fn(), error: vi.fn()}

	const memberShares = new MemberShares({
		apps: {sharedAppIdsForUser},
		logger: {createChildLogger: () => logger},
		store: {get},
	} as unknown as Umbreld)

	return {get, memberShares, sharedAppIdsForUser}
}

function normalizeVirtualPath(virtualPath: string): string {
	const normalizedPath = nodePath.posix.normalize(virtualPath)
	if (normalizedPath === '/') return normalizedPath
	return normalizedPath.endsWith('/') ? normalizedPath.slice(0, -1) : normalizedPath
}

async function createMemberSharesWithFilesystem() {
	const root = await mkdtemp(nodePath.join(tmpdir(), 'member-shares-'))
	await fse.ensureDir(nodePath.join(root, 'home'))
	await fse.ensureDir(nodePath.join(root, 'app-data', 'sparkles-hello-world', 'subdir'))
	await fse.ensureDir(nodePath.join(root, 'external'))
	await fse.ensureDir(nodePath.join(root, 'network'))
	await fse.ensureDir(nodePath.join(root, 'raid'))

	let fileShares: MemberShare[] = []
	const get = vi.fn(async (key: string) => {
		if (key === 'files.memberShares') return fileShares
		return undefined
	})
	const set = vi.fn(async (key: string, value: MemberShare[]) => {
		if (key === 'files.memberShares') fileShares = value
	})
	const logger = {log: vi.fn(), error: vi.fn()}
	const emit = vi.fn(async () => {})

	const virtualToSystemPath = vi.fn(async (virtualPath: string) => {
		const segments = normalizeVirtualPath(virtualPath).split('/').filter(Boolean)
		if (segments[0] === 'Home') return nodePath.join(root, 'home', ...segments.slice(1))
		if (segments[0] === 'Apps') return nodePath.join(root, 'app-data', ...segments.slice(1))
		if (segments[0] === 'External') return nodePath.join(root, 'external', ...segments.slice(1))
		if (segments[0] === 'Network') return nodePath.join(root, 'network', ...segments.slice(1))
		if (segments[0] === 'Raid') return nodePath.join(root, 'raid', ...segments.slice(1))
		throw new Error(`[invalid-base] ${virtualPath}`)
	})

	const memberShares = new MemberShares({
		eventBus: {emit},
		files: {
			normalizeVirtualPath,
			virtualToSystemPath,
		},
		logger: {createChildLogger: () => logger},
		store: {
			get,
			getWriteLock: async (callback: (methods: {get: typeof get; set: typeof set}) => Promise<void>) =>
				callback({get, set}),
		},
		user: {listMembers: vi.fn(async () => [{id: 'member-1'}])},
	} as unknown as Umbreld)

	return {
		cleanup: () => rm(root, {recursive: true, force: true}),
		emit,
		fileShares: () => fileShares,
		memberShares,
		root,
		virtualToSystemPath,
	}
}

test('app member shares do not grant raw app data file shares', async () => {
	const {get, memberShares, sharedAppIdsForUser} = createMemberShares()

	await expect(memberShares.listForUser('member-1')).resolves.toStrictEqual([])
	expect(get).toHaveBeenCalledWith('files.memberShares')
	expect(sharedAppIdsForUser).not.toHaveBeenCalled()
})

test('member file shares still resolve from persisted file share records', async () => {
	const {memberShares} = createMemberShares([
		{path: '/Home/Shared', sharedWith: 'all'},
		{path: '/Home/Member One', sharedWith: ['member-1']},
		{path: '/Home/Member Two', sharedWith: ['member-2']},
	])

	await expect(memberShares.listForUser('member-1')).resolves.toStrictEqual([
		{path: '/Home/Shared', sharedWith: 'all'},
		{path: '/Home/Member One', sharedWith: ['member-1']},
	])
})

test('explicit app data file shares can target an app directory or subdirectory', async () => {
	const {cleanup, fileShares, memberShares, virtualToSystemPath} = await createMemberSharesWithFilesystem()
	try {
		await expect(memberShares.add('/Apps/sparkles-hello-world', 'all')).resolves.toStrictEqual({
			path: '/Apps/sparkles-hello-world',
			sharedWith: 'all',
		})
		await expect(memberShares.add('/Apps/sparkles-hello-world/subdir/', ['member-1'])).resolves.toStrictEqual({
			path: '/Apps/sparkles-hello-world/subdir',
			sharedWith: ['member-1'],
		})

		expect(fileShares()).toStrictEqual([
			{path: '/Apps/sparkles-hello-world', sharedWith: 'all'},
			{path: '/Apps/sparkles-hello-world/subdir', sharedWith: ['member-1']},
		])
		expect(virtualToSystemPath).toHaveBeenCalledWith('/Apps/sparkles-hello-world', '0')
		expect(virtualToSystemPath).toHaveBeenCalledWith('/Apps/sparkles-hello-world/subdir', '0')
	} finally {
		await cleanup()
	}
})

test('explicit app data file shares reject the /Apps root', async () => {
	const {cleanup, memberShares, virtualToSystemPath} = await createMemberSharesWithFilesystem()
	try {
		await expect(memberShares.add('/Apps', 'all')).rejects.toThrow('invalid-base')
		expect(virtualToSystemPath).not.toHaveBeenCalled()
	} finally {
		await cleanup()
	}
})

test('storage shares accept only category roots and cover devices added later', async () => {
	const {cleanup, fileShares, memberShares, root, virtualToSystemPath} = await createMemberSharesWithFilesystem()
	try {
		await expect(memberShares.add('/External', ['member-1'])).resolves.toMatchObject({
			path: '/External',
			sharedWith: ['member-1'],
		})
		await expect(memberShares.add('/Network', ['member-1'])).resolves.toMatchObject({
			path: '/Network',
			sharedWith: ['member-1'],
		})

		await expect(memberShares.add('/External', 'all')).rejects.toThrow('invalid-users')
		await expect(memberShares.add('/Network', 'all')).rejects.toThrow('invalid-users')
		await expect(memberShares.add('/External/photos', 'all')).rejects.toThrow('invalid-base')
		await expect(memberShares.add('/Network/nas/media', 'all')).rejects.toThrow('invalid-base')

		// The grants are category-wide rather than tied to devices that happened
		// to exist when they were created.
		await fse.ensureDir(nodePath.join(root, 'external', 'future-usb'))
		await fse.ensureDir(nodePath.join(root, 'network', 'future-nas', 'media'))
		await expect(memberShares.shareGrantFor('/External/future-usb/photo.jpg', 'member-1')).resolves.toMatchObject({
			path: '/External',
		})
		await expect(memberShares.shareGrantFor('/Network/future-nas/media/movie.mp4', 'member-1')).resolves.toMatchObject({
			path: '/Network',
		})
		await expect(memberShares.shareGrantFor('/External/future-usb/photo.jpg', 'member-2')).resolves.toBeUndefined()
		await expect(memberShares.shareGrantFor('/Network/future-nas/media/movie.mp4', 'member-2')).resolves.toBeUndefined()

		expect(fileShares()).toStrictEqual([
			{path: '/External', sharedWith: ['member-1']},
			{path: '/Network', sharedWith: ['member-1']},
		])
		expect(virtualToSystemPath).not.toHaveBeenCalledWith('/External/photos', '0')
		expect(virtualToSystemPath).not.toHaveBeenCalledWith('/Network/nas/media', '0')
	} finally {
		await cleanup()
	}
})

test('RAID storage shares behave like the other storage categories', async () => {
	const {cleanup, memberShares, root} = await createMemberSharesWithFilesystem()
	try {
		await expect(memberShares.add('/Raid', ['member-1'])).resolves.toMatchObject({
			path: '/Raid',
			sharedWith: ['member-1'],
		})

		// RAID storage must target specific users, never everyone
		await expect(memberShares.add('/Raid', 'all')).rejects.toThrow('invalid-users')
		// Only the category root is shareable, not an individual array
		await expect(memberShares.add('/Raid/umbrel-md', ['member-1'])).rejects.toThrow('invalid-base')

		// The grant covers arrays created after it was made
		await fse.ensureDir(nodePath.join(root, 'raid', 'future-array'))
		await expect(memberShares.shareGrantFor('/Raid/future-array/file.txt', 'member-1')).resolves.toMatchObject({
			path: '/Raid',
		})
		await expect(memberShares.shareGrantFor('/Raid/future-array/file.txt', 'member-2')).resolves.toBeUndefined()
	} finally {
		await cleanup()
	}
})

test('removing a filesystem subtree clears exact and nested shares without matching sibling prefixes', async () => {
	const {cleanup, emit, fileShares, memberShares, root} = await createMemberSharesWithFilesystem()
	try {
		await Promise.all([
			fse.ensureDir(nodePath.join(root, 'home', 'shared', 'nested')),
			fse.ensureDir(nodePath.join(root, 'home', 'shared-sibling')),
		])
		await memberShares.add('/Home/shared', 'all')
		await memberShares.add('/Home/shared/nested', ['member-1'])
		await memberShares.add('/Home/shared-sibling', 'all')
		emit.mockClear()

		await expect(memberShares.removeWithin('/Home/shared/')).resolves.toBe(true)
		expect(fileShares()).toStrictEqual([{path: '/Home/shared-sibling', sharedWith: 'all'}])
		expect(emit).toHaveBeenCalledWith('files:member-shares:change', {sharedWith: 'all'})
		await expect(memberShares.removeWithin('/Home/missing')).resolves.toBe(false)
	} finally {
		await cleanup()
	}
})

test('share revocation waits for listeners to stop affected work', async () => {
	const {cleanup, emit, memberShares, root} = await createMemberSharesWithFilesystem()
	try {
		await fse.ensureDir(nodePath.join(root, 'home', 'shared'))
		await memberShares.add('/Home/shared', ['member-1'])
		emit.mockClear()

		let releaseListener!: () => void
		const listenerFinished = new Promise<void>((resolve) => {
			releaseListener = resolve
		})
		emit.mockImplementationOnce(async () => listenerFinished)

		let settled = false
		const removal = memberShares.remove('/Home/shared').finally(() => {
			settled = true
		})
		await vi.waitFor(() => expect(emit).toHaveBeenCalledOnce())
		expect(settled).toBe(false)

		releaseListener()
		await expect(removal).resolves.toBe(true)
	} finally {
		await cleanup()
	}
})
