import {EXTERNAL_STORAGE_PATH, HOME_PATH, NETWORK_STORAGE_PATH, RAID_STORAGE_PATH} from '@/features/files/constants'
import type {CloudAccount, CloudProvider, CloudSync} from '@/features/files/hooks/use-cloud'

// The webdav provider presented as the servers people actually run.
// Connecting through a flavor constructs the server's WebDAV endpoint from a
// plain host and flows through the ordinary webdav connect route; the backend
// stores the flavor on the account so the UI can keep branding it.
export type CloudWebDavFlavorId = 'nextcloud' | 'owncloud'

// The example URLs feed the connect form's placeholder and tooltip, so users
// paste the address they already use in the browser rather than hunting for
// the WebDAV endpoint Nextcloud/ownCloud advertise
export const CLOUD_WEBDAV_FLAVORS: {
	id: CloudWebDavFlavorId
	displayName: string
	exampleUrl: string
	exampleLocalUrl: string
}[] = [
	{
		id: 'nextcloud',
		displayName: 'Nextcloud',
		exampleUrl: 'https://nextcloud.example.com',
		exampleLocalUrl: 'http://umbrel.local:8081',
	},
	{
		id: 'owncloud',
		displayName: 'ownCloud',
		exampleUrl: 'https://owncloud.example.com',
		exampleLocalUrl: 'http://umbrel.local:8666',
	},
]

// Brands whose logos are full app-icon squares with their own baked corner
// rounding; they render edge to edge (picker tiles, folder badges) while
// other marks sit on a backing chip
export const CLOUD_SELF_TILE_BRANDS = new Set(['webdav', 'nextcloud', 'owncloud'])

// The brand an account presents across the UI (sidebar, banners, listings,
// badges): WebDAV accounts show the server product they were connected as
// (Nextcloud, ownCloud) rather than the protocol underneath
export function cloudAccountBrand(account: Pick<CloudAccount, 'provider' | 'connection'>): string {
	if (account.connection.kind === 'webdav') return account.connection.flavor
	return account.provider
}

export function cloudBrandName(brand: string | undefined, providers?: CloudProvider[]): string | undefined {
	if (!brand) return undefined
	return (
		CLOUD_WEBDAV_FLAVORS.find(({id}) => id === brand)?.displayName ??
		providers?.find(({id}) => id === brand)?.displayName
	)
}

export function soleRootCloudDestination(clouds: CloudSync[]): string | undefined {
	const cloud = clouds.length === 1 ? clouds[0] : undefined
	return cloud?.remote.path.split('/').filter(Boolean).length === 0 ? cloud.destination.path : undefined
}

// Builds the WebDAV endpoint for a Nextcloud/ownCloud server from the address
// a user would naturally type ("cloud.example.com"). A pasted URL that already
// carries the WebDAV path is respected, and plain http is kept for LAN servers.
export function buildWebDavFlavorUrl(server: string, username: string): string {
	let base = server.trim().replace(/\/+$/, '')
	if (!/^https?:\/\//i.test(base)) base = `https://${base}`
	if (/remote\.php\//i.test(base)) return base
	return `${base}/remote.php/dav/files/${encodeURIComponent(username.trim())}`
}

// Valid parents for an auto-created cloud destination folder, per the
// backend's destination grammar: /Home/**, /External/<volume>/**,
// /Network/<host>/<share>/**, /Raid/<array>/**. The base roots and mount roots
// themselves cannot contain a destination's parent below these depths.
export function isValidCloudDestinationParent(path: string, homePath: string = HOME_PATH) {
	if (path === homePath || path.startsWith(`${homePath}/`)) return true
	const componentCount = path.split('/').filter(Boolean).length
	if (path.startsWith(`${EXTERNAL_STORAGE_PATH}/`)) return componentCount >= 2
	if (path.startsWith(`${NETWORK_STORAGE_PATH}/`)) return componentCount >= 3
	if (path.startsWith(`${RAID_STORAGE_PATH}/`)) return componentCount >= 2
	return false
}

// Whether an existing (empty) folder can itself become a cloud destination
export function isValidCloudDestination(path: string, homePath: string = HOME_PATH) {
	const lastSlash = path.lastIndexOf('/')
	if (lastSlash <= 0) return false
	return isValidCloudDestinationParent(path.slice(0, lastSlash), homePath)
}

// Clouds whose destination overlaps the given directory in either direction:
// writing into the directory would write into the mirror (directory is at or
// inside a destination), or the directory contains a mirror (a destination is
// at or inside the directory)
export function cloudsOverlappingPath(clouds: CloudSync[] | undefined, path: string): CloudSync[] {
	if (!clouds) return []
	return clouds.filter(({destination}) => {
		const destinationPath = destination.path
		return path === destinationPath || path.startsWith(`${destinationPath}/`) || destinationPath.startsWith(`${path}/`)
	})
}
