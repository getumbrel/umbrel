import {describe, expect, test} from 'vitest'

import {getNetworkDirectoryListing, networkDirectory} from './network-directory-listing'

const offline = {host: 'nas.local', share: 'Photos', mountPath: '/Network/nas.local/Photos', isMounted: false}
const online = {...offline, share: 'Documents', mountPath: '/Network/nas.local/Documents', isMounted: true}

describe('configured network directories', () => {
	test('keeps an offline host and its shares visible after mount directories are removed', () => {
		const root = getNetworkDirectoryListing('/Network', [offline])!
		expect(root.files).toEqual([expect.objectContaining({path: '/Network/nas.local', isDisconnected: true})])
		const host = getNetworkDirectoryListing('/Network/nas.local', [offline])!
		expect(host.files).toEqual([
			expect.objectContaining({path: offline.mountPath, isDisconnected: true, operations: []}),
		])
		expect(host.hasMore).toBe(false)
	})

	test('groups mixed mounted and unmounted shares into one connected host, regardless of order', () => {
		for (const shares of [
			[offline, online],
			[online, offline],
		]) {
			const root = getNetworkDirectoryListing('/Network', shares)!
			expect(root.files).toHaveLength(1)
			expect(root.files[0].isDisconnected).toBe(false)
		}
	})

	test('preserves mounted share capabilities but discards stale capabilities for offline shares', () => {
		const listing = {
			...networkDirectory('/Network/nas.local'),
			files: [offline, online].map((share) => ({
				...networkDirectory(share.mountPath),
				operations: ['writable', 'copy'] as ['writable', 'copy'],
				modified: 123,
			})),
			totalFiles: 2,
			hasMore: false,
		}
		const host = getNetworkDirectoryListing('/Network/nas.local', [offline, online], listing)!
		expect(host.files[0]).toMatchObject({isDisconnected: true, operations: []})
		expect(host.files[1]).toMatchObject({isDisconnected: false, operations: ['writable', 'copy'], modified: 123})
		expect(host.operations).toEqual([])
	})

	test('removal does not leave ghost entries from a stale filesystem listing', () => {
		const oldRoot = getNetworkDirectoryListing('/Network', [offline])!
		const oldHost = getNetworkDirectoryListing('/Network/nas.local', [offline, online])!
		expect(getNetworkDirectoryListing('/Network', [], oldRoot)!.files).toEqual([])
		expect(getNetworkDirectoryListing('/Network/nas.local', [online], oldHost)!.files.map((item) => item.path)).toEqual(
			[online.mountPath],
		)
	})

	test('reconnection clears the disconnected state and restores backend operations', () => {
		const connected = {...offline, isMounted: true}
		const listing = {
			...getNetworkDirectoryListing('/Network/nas.local', [connected])!,
			files: [{...networkDirectory(offline.mountPath), operations: ['writable'] as ['writable']}],
		}
		expect(getNetworkDirectoryListing('/Network/nas.local', [connected], listing)!.files[0]).toMatchObject({
			isDisconnected: false,
			operations: ['writable'],
		})
	})

	test('matches sanitized host paths and leaves normal share contents to the filesystem', () => {
		const share = {...offline, host: 'nas_name', mountPath: '/Network/nasname/Photos'}
		expect(getNetworkDirectoryListing('/Network/nasname', [share])!.files).toHaveLength(1)
		expect(getNetworkDirectoryListing(share.mountPath, [share])).toBeUndefined()
		expect(getNetworkDirectoryListing('/Home', [share])).toBeUndefined()
	})
})
