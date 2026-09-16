import type {FileSystemItem} from '@/features/files/types'
import type {RouterOutput} from '@/trpc/trpc'

import {isDirectoryANetworkDevice} from './is-directory-a-network-device-or-share'

type NetworkShares = RouterOutput['files']['listNetworkShares']
type DirectoryListing = Omit<RouterOutput['files']['list'], 'files'> & {files: FileSystemItem[]}

export function networkDirectory(path: string): FileSystemItem {
	return {path, name: path.split('/').at(-1)!, type: 'directory', modified: 0, operations: []}
}

// Configuration is authoritative for network containers: mount directories may
// disappear during an outage. Keep real metadata/capabilities for mounted shares.
export function getNetworkDirectoryListing(
	path: string,
	shares: NetworkShares,
	listing?: DirectoryListing,
): DirectoryListing | undefined {
	if (path !== '/Network' && !isDirectoryANetworkDevice(path)) return
	const entries = new Map<string, FileSystemItem>()
	const mountedEntries = new Map(listing?.files.map((item) => [item.path, item]))
	for (const share of shares) {
		const hostPath = share.mountPath.slice(0, share.mountPath.lastIndexOf('/'))
		if (path === '/Network') {
			const previous = entries.get(hostPath)
			const isDisconnected = (previous?.isDisconnected ?? true) && !share.isMounted
			entries.set(hostPath, {
				...(isDisconnected ? networkDirectory(hostPath) : (mountedEntries.get(hostPath) ?? networkDirectory(hostPath))),
				isDisconnected,
			})
		} else if (path === hostPath) {
			entries.set(share.mountPath, {
				...(share.isMounted
					? (mountedEntries.get(share.mountPath) ?? networkDirectory(share.mountPath))
					: networkDirectory(share.mountPath)),
				isDisconnected: !share.isMounted,
			})
		}
	}
	return {
		...networkDirectory(path),
		files: [...entries.values()],
		totalFiles: entries.size,
		hasMore: false,
	}
}
