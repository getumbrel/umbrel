import {useCallback, useLayoutEffect, useMemo, useRef} from 'react'

import {FadeScroller} from '@/components/fade-scroller'
import {CaretRightIcon} from '@/features/files/assets/caret-right'
import {Droppable} from '@/features/files/components/shared/drag-and-drop'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {
	APPS_PATH,
	EXTERNAL_STORAGE_PATH,
	HOME_PATH,
	NETWORK_STORAGE_PATH,
	RECENTS_PATH,
	TRASH_PATH,
} from '@/features/files/constants'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {formatItemName} from '@/features/files/utils/format-filesystem-name'
import {cn} from '@/shadcn-lib/utils'
import {t} from '@/utils/i18n'

type PathSegment = {
	id: number
	path: string
	segment: string
	type: 'home' | 'trash' | 'recents' | 'apps' | 'folder' | 'external-storage' | 'network-root' | 'network-share'
}

export function PathBarDesktop({path}: {path: string}) {
	// Ref for the list element that handles width calculations and overflow behavior for path segments
	const breadcrumbsRef = useRef<HTMLUListElement | null>(null)

	// Ref for the scrollable container that handles horizontal scrolling and fade effect
	const fadeScrollerRef = useRef<HTMLDivElement | null>(null)

	const {navigateToDirectory, isBrowsingExternalStorage, isBrowsingNetworkStorage, uiPath} = useNavigate()

	const segments = useMemo(() => {
		// Display path: derive from UI path to hide backups/snapshot segments
		const displayPath = uiPath

		// Determine root type and path from UI path
		const isUiTrash = displayPath.startsWith(TRASH_PATH)
		const isUiRecents = displayPath.startsWith(RECENTS_PATH)
		const isUiApps = displayPath.startsWith(APPS_PATH)
		const isUiNetwork = displayPath.startsWith(NETWORK_STORAGE_PATH)
		const isUiExternal = displayPath.startsWith(EXTERNAL_STORAGE_PATH)

		const displaySegments = displayPath.split('/').filter(Boolean)

		const rootInfo = isUiTrash
			? {segment: t('files-sidebar.trash'), type: 'trash' as const, path: TRASH_PATH}
			: isUiRecents
				? {segment: t('files-sidebar.recents'), type: 'recents' as const, path: RECENTS_PATH}
				: isUiApps
					? {segment: t('files-sidebar.apps'), type: 'apps' as const, path: APPS_PATH}
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
							: {segment: t('files-sidebar.home'), type: 'home' as const, path: HOME_PATH}

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

			// First level network share gets network-share type for NAS icon
			if (isBrowsingNetworkStorage && i === 0) {
				segmentType = 'network-share'
			}

			items.push({
				id: i + 1,
				type: segmentType,
				segment,
				path: segmentUiPath,
			})
		})

		return items
	}, [uiPath, isBrowsingExternalStorage, isBrowsingNetworkStorage])

	const deriveIsOverflow = useCallback(() => {
		if (!breadcrumbsRef.current) return

		const children = Array.from(breadcrumbsRef.current.children).filter(
			(i): i is HTMLElement => i instanceof HTMLElement,
		)

		// Reset children inline styles
		children.forEach((child) => {
			child.style.removeProperty('--natural-width')
			child.style.removeProperty('--item-width')
			child.classList.remove('has-overflow')
		})

		let availableWidth = breadcrumbsRef.current.clientWidth

		// Subtract space for the static elements
		children
			.filter((child) => child.dataset.static)
			.forEach((child) => {
				availableWidth -= child.getBoundingClientRect().width
			})

		let remainingSpace = availableWidth
		let totalUsedWidth = 0

		children
			.filter((child) => !child.dataset.static)
			.forEach((child, i, filteredChildren) => {
				const naturalWidth = child.clientWidth
				const collapsibleCount = filteredChildren.length

				// Calculate proportional width for the current child
				const proportionalWidth = remainingSpace / (collapsibleCount - i)

				// Determine the final width for the child
				const width = naturalWidth > proportionalWidth ? proportionalWidth : naturalWidth

				// Update total used width and remaining space
				totalUsedWidth += width
				remainingSpace = availableWidth - totalUsedWidth

				if (naturalWidth > proportionalWidth) {
					child.classList.add('has-overflow')
				}

				child.style.setProperty('--natural-width', `${Math.round(naturalWidth)}px`)
				child.style.setProperty('--item-width', `${Math.round(width)}px`)
			})
	}, [])

	useLayoutEffect(() => {
		if (!breadcrumbsRef.current) return

		const resizeObserver = new ResizeObserver(deriveIsOverflow)
		resizeObserver.observe(breadcrumbsRef.current)

		deriveIsOverflow()

		// Auto-scroll to the right after widths are calculated
		requestAnimationFrame(() => {
			if (fadeScrollerRef.current) {
				fadeScrollerRef.current.scrollLeft = fadeScrollerRef.current.scrollWidth
			}
		})

		return () => {
			resizeObserver.disconnect()
		}
	}, [deriveIsOverflow, path])

	return (
		<FadeScroller direction='x' className='umbrel-hide-scrollbar overflow-x-auto' ref={fadeScrollerRef}>
			<ul className='flex h-8 items-center whitespace-nowrap border border-transparent py-1' ref={breadcrumbsRef}>
				{segments.map((segment, i) => {
					/* First and last two segments are static, they always be fully visible */
					const isStatic = i === 0 || i > segments.length - 3 ? true : undefined

					return (
						<PathSegment
							key={segment.id}
							type={segment.type}
							segment={segment.segment}
							hasArrow={i < segments.length - 1}
							onClick={() => navigateToDirectory(segment.path)}
							path={segment.path}
							isStatic={isStatic}
						/>
					)
				})}
			</ul>
		</FadeScroller>
	)
}

type PathSegmentProps = Omit<PathSegment, 'id'> & {
	hasArrow: boolean
	onClick: () => void
	isStatic?: boolean
}

const PathSegment = ({segment, hasArrow, onClick, isStatic, path, type}: PathSegmentProps) => (
	<li className='inline-flex' data-static={isStatic}>
		<Droppable
			as='button'
			id={`path-segment-${path}`}
			path={path}
			onClick={onClick}
			className='group inline-flex w-[--item-width] min-w-[42px] cursor-pointer items-center gap-1 rounded p-1 transition-[width] duration-300 ease-in-out hover:w-[--natural-width]'
		>
			<FileItemIcon
				item={{
					path,
					type:
						type === 'external-storage'
							? 'external-storage'
							: type === 'network-root'
								? 'network-root'
								: type === 'network-share'
									? 'network-share'
									: 'directory',
					name: segment,
					operations: [],
					size: 0,
					modified: 0,
				}}
				className='h-4 w-4'
			/>
			<span
				className={cn(
					'group-hover:[mask-image:none] [.has-overflow_&]:[mask-image:linear-gradient(to_left,transparent_0%,black_40px)]',
					'overflow-hidden text-xs',
					segment && 'ml-1',
				)}
			>
				{segment && formatItemName({name: segment})}
			</span>
			{hasArrow && <CaretRightIcon className='ml-1 mt-[1px] shrink-0 text-white/50' />}
		</Droppable>
	</li>
)
