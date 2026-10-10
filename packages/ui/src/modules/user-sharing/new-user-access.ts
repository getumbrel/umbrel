export type SharedWith = 'all' | string[]

type AppShare = {appId: string; sharedWith: SharedWith}
type FolderShare = {path: string; sharedWith: SharedWith}

const unique = (values: string[]) => [...new Set(values)]

export function isCoveredByHomeShare(path: string) {
	return path === '/Home' || path.startsWith('/Home/')
}

export function isStorageCategoryPath(path: string) {
	return path === '/External' || path === '/Network' || path === '/Raid'
}

export function removeUserFromSharedWith(sharedWith: SharedWith, userId: string, memberIds: string[]) {
	const explicitUserIds = sharedWith === 'all' ? memberIds : sharedWith
	return unique(explicitUserIds).filter((id) => id !== userId)
}

export function getNewUserAccessDefaults(appShares: AppShare[], folderShares: FolderShare[]) {
	const inheritedAppIds = unique(appShares.filter((share) => share.sharedWith === 'all').map((share) => share.appId))
	const inheritedFolderPaths = unique(
		folderShares.filter((share) => share.sharedWith === 'all').map((share) => share.path),
	)

	return {
		inheritedAppIds,
		inheritedFolderPaths,
		pickedAppIds: inheritedAppIds.filter((appId) => appId !== '*'),
		pickedFolderPaths: inheritedFolderPaths.filter((path) => path !== '/Home' && !isStorageCategoryPath(path)),
		shareAllApps: inheritedAppIds.includes('*'),
		shareHome: inheritedFolderPaths.includes('/Home'),
	}
}

export function planNewUserAccessChanges({
	inheritedAppIds,
	inheritedFolderPaths,
	pickedAppIds,
	pickedFolderPaths,
	shareAllApps,
	shareHome,
	allowExternalStorage,
	allowNetworkStorage,
	allowRaidStorage,
}: {
	inheritedAppIds: string[]
	inheritedFolderPaths: string[]
	pickedAppIds: string[]
	pickedFolderPaths: string[]
	shareAllApps: boolean
	shareHome: boolean
	allowExternalStorage: boolean
	allowNetworkStorage: boolean
	allowRaidStorage?: boolean
}) {
	const pickedApps = new Set(pickedAppIds)
	const pickedFolders = new Set([
		...pickedFolderPaths,
		...(allowExternalStorage ? ['/External'] : []),
		...(allowNetworkStorage ? ['/Network'] : []),
		...(allowRaidStorage ? ['/Raid'] : []),
	])

	return {
		appIdsToAdd: unique(shareAllApps ? ['*'] : pickedAppIds),
		appIdsToRemove: unique(
			inheritedAppIds.filter((appId) => {
				if (shareAllApps) return false
				return appId === '*' || !pickedApps.has(appId)
			}),
		),
		folderPathsToAdd: unique([
			...(shareHome ? ['/Home'] : []),
			...pickedFolderPaths.filter((path) => !shareHome || !isCoveredByHomeShare(path)),
			...(allowExternalStorage ? ['/External'] : []),
			...(allowNetworkStorage ? ['/Network'] : []),
			...(allowRaidStorage ? ['/Raid'] : []),
		]),
		folderPathsToRemove: unique(
			inheritedFolderPaths.filter((path) => {
				if (shareHome && isCoveredByHomeShare(path)) return false
				return path === '/Home' || !pickedFolders.has(path)
			}),
		),
	}
}
