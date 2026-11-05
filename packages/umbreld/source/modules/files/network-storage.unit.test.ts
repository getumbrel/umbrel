import {beforeEach, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'
import NetworkStorage from './network-storage.ts'

const runCommand = vi.hoisted(() => vi.fn())

vi.mock('execa', () => ({
	$: (strings: TemplateStringsArray, ...values: unknown[]) => {
		const command = strings.reduce(
			(result, part, index) => `${result}${part}${index < values.length ? String(values[index]) : ''}`,
			'',
		)
		return runCommand(command)
	},
}))

beforeEach(() => {
	runCommand.mockReset()
})

test('keeps a configured network share when unmounting fails', async () => {
	const share = {
		host: 'nas.local',
		share: 'Media',
		username: 'ada',
		password: 'secret',
		mountPath: '/Network/nas.local/Media',
	}
	let shares = [share]
	const set = vi.fn(async (_key: string, value: typeof shares) => {
		shares = value
	})
	const getWriteLock = vi.fn(async (operation: (store: {set: typeof set}) => Promise<void>) => operation({set}))
	const releaseCloud = vi.fn()
	const blockNetworkStorage = vi.fn(async () => releaseCloud)
	const releaseMachines = vi.fn()
	const blockStoragePaths = vi.fn(async () => releaseMachines)
	const releaseApps = vi.fn()
	const blockAppStoragePaths = vi.fn(async () => releaseApps)
	const logger = {
		log: vi.fn(),
		error: vi.fn(),
		verbose: vi.fn(),
	}
	const umbreld = {
		store: {
			get: vi.fn(async () => shares),
			getWriteLock,
		},
		files: {
			virtualToSystemPathUnsafe: () => '/tmp/network/nas.local/Media',
			getBaseDirectory: () => '/tmp/network',
			cloud: {blockNetworkStorage},
		},
		apps: {blockStoragePaths: blockAppStoragePaths},
		machines: {blockStoragePaths},
		logger: {createChildLogger: () => logger},
	} as unknown as Umbreld
	runCommand.mockImplementation(async (command: string) => {
		if (command.startsWith('mountpoint ')) return {stdout: ''}
		if (command.startsWith('umount ')) throw new Error('device is busy')
		throw new Error(`Unexpected command: ${command}`)
	})

	const storage = new NetworkStorage(umbreld)
	storage.mountedShares.add(share.mountPath)

	await expect(storage.removeShare(share.mountPath)).rejects.toThrow('device is busy')
	expect(shares).toEqual([share])
	expect(getWriteLock).not.toHaveBeenCalled()
	expect(storage.mountedShares).toContain(share.mountPath)
	expect(blockNetworkStorage).toHaveBeenCalledWith(share)
	expect(blockStoragePaths).toHaveBeenCalledWith([share.mountPath])
	expect(blockAppStoragePaths).toHaveBeenCalledWith([share.mountPath])
	expect(releaseCloud).toHaveBeenCalledOnce()
	expect(releaseMachines).toHaveBeenCalledOnce()
	expect(releaseApps).toHaveBeenCalledOnce()
})

test('removes an unmounted configured share when its mount directory is already absent', async () => {
	const share = {
		host: 'offline-nas.local',
		share: 'Archive',
		username: 'ada',
		password: 'secret',
		mountPath: '/Network/offline-nas.local/Archive',
	}
	let shares = [share]
	const set = vi.fn(async (_key: string, value: typeof shares) => {
		shares = value
	})
	const getWriteLock = vi.fn(async (operation: (store: {set: typeof set}) => Promise<void>) => operation({set}))
	const releaseCloud = vi.fn()
	const blockNetworkStorage = vi.fn(async () => releaseCloud)
	const releaseMachines = vi.fn()
	const blockStoragePaths = vi.fn(async () => releaseMachines)
	const releaseApps = vi.fn()
	const blockAppStoragePaths = vi.fn(async () => releaseApps)
	const logger = {
		log: vi.fn(),
		error: vi.fn(),
		verbose: vi.fn(),
	}
	const umbreld = {
		store: {
			get: vi.fn(async () => shares),
			getWriteLock,
		},
		files: {
			virtualToSystemPathUnsafe: () => '/tmp/network/offline-nas.local/Archive',
			getBaseDirectory: () => '/tmp/network',
			cloud: {blockNetworkStorage},
		},
		apps: {blockStoragePaths: blockAppStoragePaths},
		machines: {blockStoragePaths},
		logger: {createChildLogger: () => logger},
	} as unknown as Umbreld
	runCommand.mockRejectedValue(new Error('not a mountpoint'))

	const storage = new NetworkStorage(umbreld)

	await expect(storage.removeShare(share.mountPath)).resolves.toBe(true)
	expect(shares).toEqual([])
	expect(getWriteLock).toHaveBeenCalledOnce()
	expect(blockNetworkStorage).toHaveBeenCalledWith(share)
	expect(blockStoragePaths).toHaveBeenCalledWith([share.mountPath])
	expect(blockAppStoragePaths).toHaveBeenCalledWith([share.mountPath])
	expect(releaseCloud).toHaveBeenCalledOnce()
	expect(releaseMachines).toHaveBeenCalledOnce()
	expect(releaseApps).toHaveBeenCalledOnce()
	expect(logger.error).not.toHaveBeenCalled()
})

test('unmounts every stacked filesystem before removing a configured share', async () => {
	const share = {
		host: 'nas.local',
		share: 'Media',
		username: 'ada',
		password: 'secret',
		mountPath: '/Network/nas.local/Media',
	}
	let shares = [share]
	let mountLayers = 2
	const set = vi.fn(async (_key: string, value: typeof shares) => {
		shares = value
	})
	const getWriteLock = vi.fn(async (operation: (store: {set: typeof set}) => Promise<void>) => operation({set}))
	const releaseCloud = vi.fn()
	const blockNetworkStorage = vi.fn(async () => releaseCloud)
	const releaseMachines = vi.fn()
	const blockStoragePaths = vi.fn(async () => releaseMachines)
	const releaseApps = vi.fn()
	const blockAppStoragePaths = vi.fn(async () => releaseApps)
	const logger = {
		log: vi.fn(),
		error: vi.fn(),
		verbose: vi.fn(),
	}
	const umbreld = {
		store: {
			get: vi.fn(async () => shares),
			getWriteLock,
		},
		files: {
			virtualToSystemPathUnsafe: () => '/tmp/network/nas.local/Media',
			getBaseDirectory: () => '/tmp/network',
			cloud: {blockNetworkStorage},
		},
		apps: {blockStoragePaths: blockAppStoragePaths},
		machines: {blockStoragePaths},
		logger: {createChildLogger: () => logger},
	} as unknown as Umbreld
	runCommand.mockImplementation(async (command: string) => {
		if (command.startsWith('mountpoint ')) {
			if (mountLayers > 0) return {stdout: ''}
			throw new Error('not a mountpoint')
		}
		if (command.startsWith('umount ')) {
			mountLayers--
			return {stdout: ''}
		}
		throw new Error(`Unexpected command: ${command}`)
	})

	const storage = new NetworkStorage(umbreld)
	storage.mountedShares.add(share.mountPath)

	await expect(storage.removeShare(share.mountPath)).resolves.toBe(true)
	expect(mountLayers).toBe(0)
	expect(runCommand.mock.calls.filter(([command]) => String(command).startsWith('umount '))).toHaveLength(2)
	expect(shares).toEqual([])
	expect(storage.mountedShares).not.toContain(share.mountPath)
	expect(releaseCloud).toHaveBeenCalledOnce()
	expect(blockStoragePaths).toHaveBeenCalledWith([share.mountPath])
	expect(blockAppStoragePaths).toHaveBeenCalledWith([share.mountPath])
	expect(releaseMachines).toHaveBeenCalledOnce()
	expect(releaseApps).toHaveBeenCalledOnce()
})
