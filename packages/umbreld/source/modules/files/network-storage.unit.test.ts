import os from 'node:os'
import nodePath from 'node:path'

import fse from 'fs-extra'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

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

// Stop any watcher a test left running (e.g. after a failed assertion) and remove its temp files
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup()
})

// Simulates a CIFS mount on the host. An unresponsive mount is still in the kernel mount
// table, but stat on it fails, which is what `mountpoint` sees once the server stops
// responding. Mounting over it fails, like it does for umbreld on a dead mount directory.
async function createNetworkStorageWithMount(
	initialState: 'healthy' | 'unresponsive' | 'absent',
	{reconnectAfterChecks}: {reconnectAfterChecks?: number} = {},
) {
	const baseDirectory = await fse.mkdtemp(nodePath.join(os.tmpdir(), 'umbrel-network-storage-'))
	const share = {
		host: 'nas.local',
		share: 'Backups',
		username: 'ada',
		password: 'secret',
		mountPath: '/Network/nas.local/Backups',
	}
	const systemMountPath = nodePath.join(baseDirectory, 'nas.local', 'Backups')
	await fse.ensureDir(systemMountPath)

	let shares = [share]
	let state = initialState
	let mountpointChecks = 0
	const commands: string[] = []
	runCommand.mockImplementation(async (command: string) => {
		commands.push(command)
		if (command === `mountpoint ${systemMountPath}`) {
			mountpointChecks++
			const currentState = state
			// The kernel reconnects the existing mount on its own after this many checks
			if (state === 'unresponsive' && reconnectAfterChecks !== undefined && mountpointChecks >= reconnectAfterChecks) {
				state = 'healthy'
			}
			if (currentState === 'healthy') return {stdout: ''}
			throw new Error(
				currentState === 'unresponsive' ? `mountpoint: ${systemMountPath}: Host is down` : 'not a mountpoint',
			)
		}
		if (command === `findmnt --nocanonicalize --noheadings --mountpoint ${systemMountPath}`) {
			if (state === 'absent') throw new Error('not in mount table')
			return {stdout: systemMountPath}
		}
		if (command === `umount --lazy --no-canonicalize ${systemMountPath}` || command === `umount ${systemMountPath}`) {
			state = 'absent'
			return {stdout: ''}
		}
		if (command.startsWith(`mount -t cifs //nas.local/Backups ${systemMountPath} `)) {
			if (state !== 'absent') throw new Error(`mkdir '${systemMountPath}': Host is down`)
			state = 'healthy'
			return {stdout: ''}
		}
		throw new Error(`Unexpected command: ${command}`)
	})

	const logger = {
		log: vi.fn(),
		error: vi.fn(),
		verbose: vi.fn(),
	}
	const umbreld = {
		store: {
			get: vi.fn(async () => shares),
			getWriteLock: vi.fn(async (operation: (store: {set: (key: string, value: typeof shares) => void}) => void) =>
				operation({set: (_key, value) => (shares = value)}),
			),
		},
		files: {
			virtualToSystemPathUnsafe: () => systemMountPath,
			getBaseDirectory: () => baseDirectory,
			fileOwner: {userId: 1000, groupId: 1000},
			cloud: {blockNetworkStorage: vi.fn(async () => () => {})},
		},
		apps: {blockStoragePaths: vi.fn(async () => () => {})},
		machines: {blockStoragePaths: vi.fn(async () => () => {})},
		eventBus: {emit: vi.fn()},
		logger: {createChildLogger: () => logger},
	} as unknown as Umbreld

	const storage = new NetworkStorage(umbreld)
	// Check continuously instead of once a minute
	storage.shareWatchInterval = 0

	cleanups.push(async () => {
		if (storage.isRunning) await storage.stop()
		await fse.remove(baseDirectory)
	})

	return {
		storage,
		share,
		logger,
		commands,
		getShares: () => shares,
		getState: () => state,
	}
}

test('detaches an unresponsive CIFS mount after one watch interval and mounts the share again', async () => {
	const {storage, share, logger, commands} = await createNetworkStorageWithMount('unresponsive')

	await storage.start()
	await vi.waitFor(() => expect(storage.mountedShares).toContain(share.mountPath), {timeout: 5000})
	await storage.stop()

	// The first check only notes the share as unresponsive so the kernel gets a chance to
	// reconnect. The second check detaches it, after confirming once more that it still
	// doesn't respond.
	const firstDetach = commands.findIndex((command) => command.startsWith('umount --lazy --no-canonicalize '))
	expect(firstDetach).toBeGreaterThan(-1)
	expect(commands.slice(0, firstDetach).filter((command) => command.startsWith('mountpoint '))).toHaveLength(3)
	expect(commands.filter((command) => command.startsWith('umount --lazy '))).toHaveLength(1)
	expect(commands.findIndex((command) => command.startsWith('mount -t cifs '))).toBeGreaterThan(firstDetach)
	// No attempt to mount over the dead mount
	expect(commands.slice(0, firstDetach).some((command) => command.startsWith('mount -t cifs '))).toBe(false)
	expect(logger.log).toHaveBeenCalledWith(`Network share is not responding: ${share.mountPath}`)
	expect(logger.log).toHaveBeenCalledWith(`Detaching unresponsive network share: ${share.mountPath}`)
	expect(logger.error).not.toHaveBeenCalled()
})

test('leaves a mount alone when the kernel reconnects it within one watch interval', async () => {
	const {storage, share, commands, getState} = await createNetworkStorageWithMount('unresponsive', {
		reconnectAfterChecks: 1,
	})

	await storage.start()
	await vi.waitFor(() => expect(storage.mountedShares).toContain(share.mountPath), {timeout: 5000})
	// Let a few more watch intervals pass
	await new Promise((resolve) => setTimeout(resolve, 500))
	const commandsBeforeStop = [...commands]
	await storage.stop()

	expect(commandsBeforeStop.some((command) => command.startsWith('umount '))).toBe(false)
	expect(commandsBeforeStop.some((command) => command.startsWith('mount -t cifs '))).toBe(false)
	expect(storage.unresponsiveShares).not.toContain(share.mountPath)
	expect(getState()).toBe('absent') // Unmounted cleanly by stop()
})

test('mounts a configured share that is not in the mount table without detaching anything', async () => {
	const {storage, share, commands} = await createNetworkStorageWithMount('absent')

	await storage.start()
	await vi.waitFor(() => expect(storage.mountedShares).toContain(share.mountPath), {timeout: 5000})
	await storage.stop()

	expect(commands.some((command) => command.startsWith('umount --lazy '))).toBe(false)
	expect(commands.filter((command) => command.startsWith('mount -t cifs '))).toHaveLength(1)
})

test('detaches an unresponsive CIFS mount when removing its share', async () => {
	const {storage, share, logger, commands, getShares, getState} = await createNetworkStorageWithMount('unresponsive')

	await expect(storage.removeShare(share.mountPath)).resolves.toBe(true)

	expect(commands.filter((command) => command.startsWith('umount --lazy '))).toHaveLength(1)
	expect(getState()).toBe('absent')
	expect(getShares()).toEqual([])
	expect(logger.error).not.toHaveBeenCalled()
})

test('detaches an unresponsive CIFS mount when umbreld stops', async () => {
	const {storage, commands, getState} = await createNetworkStorageWithMount('unresponsive')

	await storage.stop()

	expect(commands.filter((command) => command.startsWith('umount --lazy '))).toHaveLength(1)
	expect(getState()).toBe('absent')
})
