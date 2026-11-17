import {useMemo} from 'react'
import {useTranslation} from 'react-i18next'

import {
	APPS_PATH,
	BACKUPS_PATH,
	CLOUD_PATH,
	EXTERNAL_STORAGE_PATH,
	MACHINES_PATH,
	NETWORK_STORAGE_PATH,
	RECENTS_PATH,
	SEARCH_PATH,
} from '@/features/files/constants'
import {cloudAccountLabel, useCloudAccounts, useCloudProviders} from '@/features/files/hooks/use-cloud'
import {useHomePath, useIsMember, useTrashPath} from '@/features/files/hooks/use-home-path'
import {useMemberShares} from '@/features/files/hooks/use-member-shares'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useIsFilesEmbedded} from '@/features/files/providers/files-capabilities-context'
import {trpcReact} from '@/trpc/trpc'
import {firstNameFromFullName} from '@/utils/misc'

export type PathSegment = {
	id: number
	path: string
	segment: string
	type:
		| 'home'
		| 'trash'
		| 'recents'
		| 'apps'
		| 'machines'
		| 'folder'
		| 'external-storage'
		| 'network-root'
		| 'network-share'
		| 'cloud-account'
		| 'search'
}

// The folders from the root of where Files is down to the one it shows, as
// they are named on screen: the root first, the current folder last. Shared by
// the desktop's breadcrumb title and the phone's title and its way up.
export function usePathSegments(): PathSegment[] {
	const {t} = useTranslation()
	const isEmbedded = useIsFilesEmbedded()
	const {isBrowsingExternalStorage, isBrowsingNetworkStorage, isBrowsingBackups, uiPath} = useNavigate()

	// Account label for the virtual /Cloud/<accountId> route
	const isUiCloudRoot = uiPath === CLOUD_PATH
	const isUiCloudAccount = uiPath.startsWith(`${CLOUD_PATH}/`)
	const {data: cloudAccounts} = useCloudAccounts({enabled: isUiCloudAccount})
	const {data: cloudProviders} = useCloudProviders({enabled: isUiCloudAccount})

	// The current account's home and trash roots (owner: /Home and /Trash,
	// member: /Users/<slug> and /Users/<slug>/Trash) so a member's breadcrumb
	// roots at their own home rather than rendering unnavigable segments
	const homePath = useHomePath()
	const trashPath = useTrashPath()

	// For members browsing the owner's files (via paths shared with them), the
	// breadcrumb roots at "{Owner}'s Umbrel" (/Home), mirroring their sidebar
	const isMember = useIsMember()
	const {sharedWithMe} = useMemberShares()
	const ownersUmbrelName = sharedWithMe?.ownerName
		? t('files-sidebar.owners-umbrel', {name: firstNameFromFullName(sharedWithMe.ownerName)})
		: ''

	// A search looks through the whole Umbrel, named as the sidebar names it
	const userName = trpcReact.user.get.useQuery().data?.name
	const searchLabel = t('files-search.searching-label', {name: userName ? firstNameFromFullName(userName) : 'Umbrel'})

	return useMemo(() => {
		// Display path: derive from UI path to hide backups/snapshot segments
		const displayPath = uiPath

		// The results of a search are nowhere in particular: the title says what was searched
		if (displayPath === SEARCH_PATH) {
			return [{id: 0, segment: searchLabel, type: 'search' as const, path: SEARCH_PATH}]
		}

		// Determine root type and path from UI path
		const isUiTrash = displayPath.startsWith(trashPath)
		const isUiRecents = displayPath.startsWith(RECENTS_PATH)
		const isUiApps = displayPath.startsWith(APPS_PATH)
		const isUiMachines = displayPath.startsWith(MACHINES_PATH)
		const isUiNetwork = displayPath.startsWith(NETWORK_STORAGE_PATH)
		const isUiExternal = displayPath.startsWith(EXTERNAL_STORAGE_PATH)

		const displaySegments = displayPath.split('/').filter(Boolean)

		// Members browsing the owner's home root at "{Owner}'s Umbrel"
		const isOwnersUmbrel = isMember && (displayPath === '/Home' || displayPath.startsWith('/Home/'))

		const rootInfo = isOwnersUmbrel
			? {segment: ownersUmbrelName, type: 'home' as const, path: '/Home'}
			: isUiTrash
				? {segment: t('files-sidebar.trash'), type: 'trash' as const, path: trashPath}
				: isUiRecents
					? {segment: t('files-sidebar.recents'), type: 'recents' as const, path: RECENTS_PATH}
					: isUiApps
						? {segment: t('files-sidebar.apps'), type: 'apps' as const, path: APPS_PATH}
						: isUiMachines
							? {segment: t('machines'), type: 'machines' as const, path: MACHINES_PATH}
							: isUiCloudRoot || isUiCloudAccount
								? {segment: t('files-sidebar.cloud'), type: 'cloud-account' as const, path: CLOUD_PATH}
								: isUiExternal
									? {
											segment: displaySegments[1] || t('files-sidebar.external-storage'),
											type: 'external-storage' as const,
											path: `${EXTERNAL_STORAGE_PATH}/${displaySegments[1] || ''}`,
										}
									: isUiNetwork
										? {
												segment: t('files-sidebar.network-pathbar'),
												type: 'network-root' as const,
												path: NETWORK_STORAGE_PATH,
											}
										: !isEmbedded && isBrowsingBackups
											? {segment: t('backups'), type: 'folder' as const, path: BACKUPS_PATH}
											: {segment: t('files-sidebar.home'), type: 'home' as const, path: homePath}

		// Start with the root segment
		const items: PathSegment[] = [{id: 0, ...rootInfo}]

		// Add nested folder segments
		const nestedDisplayPaths = isBrowsingExternalStorage
			? displayPath.split('/').slice(3).filter(Boolean) // Skip external-storage and disk name
			: displayPath.replace(rootInfo.path, '').split('/').filter(Boolean)

		nestedDisplayPaths.forEach((segment, i) => {
			const segmentUiPath = [rootInfo.path, ...nestedDisplayPaths.slice(0, i + 1)].join('/')

			// Determine the type for the segment
			let segmentType: PathSegment['type'] = 'folder'
			let segmentLabel = segment

			// First level network share gets network-share type for NAS icon
			if (isBrowsingNetworkStorage && i === 0) {
				segmentType = 'network-share'
			}

			// First level cloud segment is the account: provider logo + account label
			if (isUiCloudAccount && i === 0) {
				segmentType = 'cloud-account'
				const account = cloudAccounts?.find(({id}) => id === segment)
				if (account) segmentLabel = cloudAccountLabel(account, cloudAccounts, cloudProviders)
			}

			items.push({id: i + 1, type: segmentType, segment: segmentLabel, path: segmentUiPath})
		})

		return items
	}, [
		uiPath,
		homePath,
		trashPath,
		isMember,
		isEmbedded,
		ownersUmbrelName,
		searchLabel,
		isBrowsingExternalStorage,
		isBrowsingNetworkStorage,
		isBrowsingBackups,
		isUiCloudRoot,
		isUiCloudAccount,
		cloudAccounts,
		cloudProviders,
		t,
	])
}

// What FileItemIcon needs to draw a segment's icon
export const segmentIconItem = ({path, type, segment}: Pick<PathSegment, 'path' | 'type' | 'segment'>) => ({
	path,
	type:
		type === 'external-storage'
			? ('external-storage' as const)
			: type === 'network-root'
				? ('network-root' as const)
				: type === 'network-share'
					? ('network-share' as const)
					: type === 'cloud-account'
						? ('cloud-account' as const)
						: ('directory' as const),
	name: segment,
	operations: [],
	size: 0,
	modified: 0,
})
