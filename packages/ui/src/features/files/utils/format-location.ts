import {APPS_PATH, HOME_PATH, MACHINES_PATH, NETWORK_STORAGE_PATH, TRASH_PATH} from '@/features/files/constants'

// Where an item lives, for listings that gather items from all over (a
// search's results, Recents): the folders down to the one that holds it, the
// root named as the sidebar names it. "Home › Documents › Taxes 2025".
export function formatLocation(
	path: string,
	{
		homePath,
		labels,
	}: {homePath: string; labels: {home: string; apps: string; machines: string; network: string; trash: string}},
): string {
	const parent = path.slice(0, path.lastIndexOf('/')) || '/'
	const roots: [string, string][] = [
		[homePath, labels.home],
		[HOME_PATH, labels.home],
		[APPS_PATH, labels.apps],
		[MACHINES_PATH, labels.machines],
		[NETWORK_STORAGE_PATH, labels.network],
		[TRASH_PATH, labels.trash],
	]
	for (const [root, label] of roots) {
		if (parent === root) return label
		if (parent.startsWith(`${root}/`)) {
			return [label, ...parent.slice(root.length).split('/').filter(Boolean)].join(' › ')
		}
	}
	// External drives and anything else are named by their own folders (/External/<drive>/…)
	const segments = parent.split('/').filter(Boolean)
	return (segments[0] === 'External' ? segments.slice(1) : segments).join(' › ')
}
