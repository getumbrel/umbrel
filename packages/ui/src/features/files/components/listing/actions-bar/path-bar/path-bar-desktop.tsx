import {MoreHorizontal} from 'lucide-react'
import {Fragment, useCallback, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {FadeScroller} from '@/components/fade-scroller'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {CaretRightIcon} from '@/features/files/assets/caret-right'
import {fitPathSegments} from '@/features/files/components/listing/actions-bar/path-bar/fit-path-segments'
import {Droppable} from '@/features/files/components/shared/drag-and-drop'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {
	APPS_PATH,
	CLOUD_PATH,
	EXTERNAL_STORAGE_PATH,
	MACHINES_PATH,
	NETWORK_STORAGE_PATH,
	RECENTS_PATH,
	SYSTEM_MANAGED_ROOT_PATHS,
} from '@/features/files/constants'
import {cloudAccountLabel, useCloudAccounts, useCloudProviders} from '@/features/files/hooks/use-cloud'
import {useHomePath, useIsMember, useTrashPath} from '@/features/files/hooks/use-home-path'
import {MachineFolderMetadata} from '@/features/files/hooks/use-machine-folder'
import {useMemberShares} from '@/features/files/hooks/use-member-shares'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {formatItemName} from '@/features/files/utils/format-filesystem-name'
import type {Machine} from '@/features/machines/types'
import {cn} from '@/lib/utils'
import {focusRingClass} from '@/utils/element-classes'
import {firstNameFromFullName} from '@/utils/misc'

// A narrowed folder's icon and caret, matching its button's min-w-[42px]
const SEGMENT_MIN_WIDTH = 42

type PathSegment = {
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
}

export function PathBarDesktop() {
	const {t} = useTranslation()
	// Ref for the list element that handles width calculations and overflow behavior for path segments
	const breadcrumbsRef = useRef<HTMLUListElement | null>(null)

	// Ref for the scrollable container that handles horizontal scrolling and fade effect
	const fadeScrollerRef = useRef<HTMLDivElement | null>(null)

	const {navigateToDirectory, isBrowsingExternalStorage, isBrowsingNetworkStorage, uiPath} = useNavigate()

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

	const segments = useMemo(() => {
		// Display path: derive from UI path to hide backups/snapshot segments
		const displayPath = uiPath

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
			? {
					segment: ownersUmbrelName,
					type: 'home' as const,
					path: '/Home',
				}
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
												segment: displayPath === NETWORK_STORAGE_PATH ? t('files-sidebar.network-pathbar') : '',
												type: 'network-root' as const,
												path: NETWORK_STORAGE_PATH,
											}
										: {segment: t('files-sidebar.home'), type: 'home' as const, path: homePath}

		// Start with the root segment
		const items: PathSegment[] = [
			{
				id: 0,
				...rootInfo,
			},
		]

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

			items.push({
				id: i + 1,
				type: segmentType,
				segment: segmentLabel,
				path: segmentUiPath,
			})
		})

		return items
	}, [
		uiPath,
		homePath,
		trashPath,
		isMember,
		ownersUmbrelName,
		isBrowsingExternalStorage,
		isBrowsingNetworkStorage,
		isUiCloudRoot,
		isUiCloudAccount,
		cloudAccounts,
		cloudProviders,
	])

	// Whether the root, and how many folders after it, are folded into the overflow menu
	const [foldsRoot, setFoldsRoot] = useState(false)
	const [folded, setFolded] = useState(0)

	// Narrows and folds segments to keep the current folder, and the root when it fits, in view.
	// Widths and visibility are set on the elements directly, so measuring and
	// laying out happen in one pass before paint.
	const fitSegments = useCallback(() => {
		const list = breadcrumbsRef.current
		if (!list) return

		const items = Array.from(list.children).filter((i): i is HTMLElement => i instanceof HTMLElement)
		const overflowItem = items.find((item) => item.hasAttribute('data-overflow'))
		const segmentItems = items.filter((item) => item !== overflowItem)

		// Measure everything at its natural width
		items.forEach((item) => {
			item.hidden = false
			item.style.removeProperty('--natural-width')
			item.style.removeProperty('--item-width')
			item.classList.remove('has-overflow')
		})
		const widths = segmentItems.map((item) => item.getBoundingClientRect().width)

		const fit = fitPathSegments({
			available: list.clientWidth,
			widths,
			minWidth: SEGMENT_MIN_WIDTH,
			overflowWidth: overflowItem?.getBoundingClientRect().width ?? 0,
		})

		if (overflowItem) overflowItem.hidden = !fit.foldsRoot && fit.folded === 0
		segmentItems.forEach((item, i) => {
			if (i === 0 ? fit.foldsRoot : i <= fit.folded) item.hidden = true
			const width = fit.widths[i]
			if (width === undefined) return
			item.classList.add('has-overflow')
			item.style.setProperty('--natural-width', `${Math.ceil(widths[i])}px`)
			item.style.setProperty('--item-width', `${Math.floor(width)}px`)
		})
		setFoldsRoot(fit.foldsRoot)
		setFolded(fit.folded)
	}, [])

	useLayoutEffect(() => {
		if (!breadcrumbsRef.current) return

		const resizeObserver = new ResizeObserver(fitSegments)
		resizeObserver.observe(breadcrumbsRef.current)

		fitSegments()

		// If even the menu beside a narrowed current folder doesn't fit, show the current folder
		requestAnimationFrame(() => {
			if (fadeScrollerRef.current) {
				fadeScrollerRef.current.scrollLeft = fadeScrollerRef.current.scrollWidth
			}
		})

		return () => {
			resizeObserver.disconnect()
		}
	}, [fitSegments, segments])

	return (
		<FadeScroller direction='x' className='umbrel-hide-scrollbar overflow-x-auto' ref={fadeScrollerRef}>
			<ul className='flex h-8 items-center border border-transparent py-1 whitespace-nowrap' ref={breadcrumbsRef}>
				{segments.map((segment, i) => (
					<Fragment key={segment.id}>
						<PathSegment
							type={segment.type}
							segment={segment.segment}
							hasArrow={i < segments.length - 1}
							onClick={() => navigateToDirectory(segment.path)}
							path={segment.path}
						/>
						{i === 0 && segments.length > 1 && (
							<li className='inline-flex' data-overflow>
								<DropdownMenu>
									<DropdownMenuTrigger
										aria-label={t('files-path.more-folders')}
										className={cn('group inline-flex items-center gap-1 rounded-sm p-1', focusRingClass)}
									>
										<MoreHorizontal className='size-4 opacity-70 transition-opacity group-hover:opacity-100' />
										<CaretRightIcon className='mt-[1px] ml-1 shrink-0 text-white/50' />
									</DropdownMenuTrigger>
									<DropdownMenuContent align='start' className='max-w-72'>
										{segments.slice(foldsRoot ? 0 : 1, folded + 1).map((hidden) => (
											<PathMenuItem
												key={hidden.id}
												segment={hidden}
												onSelect={() => navigateToDirectory(hidden.path)}
											/>
										))}
									</DropdownMenuContent>
								</DropdownMenu>
							</li>
						)}
					</Fragment>
				))}
			</ul>
		</FadeScroller>
	)
}

type PathSegmentProps = Omit<PathSegment, 'id'> & {
	hasArrow: boolean
	onClick: () => void
}

const PathSegment = ({segment, hasArrow, onClick, path, type}: PathSegmentProps) => {
	return (
		<MachineFolderMetadata path={path}>
			{({machine}) => (
				<PathSegmentContent
					segment={segment}
					hasArrow={hasArrow}
					onClick={onClick}
					path={path}
					type={type}
					machine={machine}
				/>
			)}
		</MachineFolderMetadata>
	)
}

const segmentIconItem = ({path, type, segment}: Pick<PathSegment, 'path' | 'type' | 'segment'>) => ({
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

const segmentLabel = (segment: string, machine: Machine | undefined) =>
	machine ? machine.name : segment && formatItemName({name: segment})

const PathSegmentContent = ({
	segment,
	hasArrow,
	onClick,
	path,
	type,
	machine,
}: PathSegmentProps & {machine: Machine | undefined}) => {
	const label = segmentLabel(segment, machine)

	return (
		<li className='inline-flex'>
			<Droppable
				as='button'
				id={`path-segment-${path}`}
				path={path}
				onClick={onClick}
				// Nothing can be dropped into a system-managed root (/Apps, /Machines)
				disabled={SYSTEM_MANAGED_ROOT_PATHS.has(path)}
				className={cn(
					'group inline-flex w-(--item-width) min-w-[42px] items-center gap-1 rounded-sm p-1 transition-[width] duration-300 ease-in-out hover:w-(--natural-width)',
					focusRingClass,
				)}
			>
				<FileItemIcon
					item={segmentIconItem({path, type, segment})}
					className='h-4 w-4 opacity-70 transition-opacity group-hover:opacity-100'
					machine={machine ?? null}
				/>
				<span
					className={cn(
						'group-hover:[mask-image:none] [.has-overflow_&]:[mask-image:linear-gradient(to_left,transparent_0%,black_40px)]',
						'overflow-hidden text-xs opacity-70 transition-opacity group-hover:opacity-100',
						label && 'ml-1',
					)}
				>
					{label}
				</span>
				{hasArrow && <CaretRightIcon className='mt-[1px] ml-1 shrink-0 text-white/50' />}
			</Droppable>
		</li>
	)
}

// A folder folded into the overflow menu
const PathMenuItem = ({segment, onSelect}: {segment: PathSegment; onSelect: () => void}) => (
	<MachineFolderMetadata path={segment.path}>
		{({machine}) => (
			<DropdownMenuItem onSelect={onSelect} className='gap-2'>
				<FileItemIcon item={segmentIconItem(segment)} className='size-4 shrink-0' machine={machine ?? null} />
				<span className='truncate'>{segmentLabel(segment.segment, machine)}</span>
			</DropdownMenuItem>
		)}
	</MachineFolderMetadata>
)
