import {ChevronRight, MoreHorizontal} from 'lucide-react'
import {Fragment, useCallback, useLayoutEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {FadeScroller} from '@/components/fade-scroller'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {fitPathSegments} from '@/features/files/components/listing/actions-bar/path-bar/fit-path-segments'
import {pathFocusClass, useMenuFocusReturn} from '@/features/files/components/listing/actions-bar/path-bar/path-focus'
import {
	segmentIconItem,
	usePathSegments,
	type PathSegment,
} from '@/features/files/components/listing/actions-bar/path-bar/use-path-segments'
import {Droppable} from '@/features/files/components/shared/drag-and-drop'
import {FileItemIcon} from '@/features/files/components/shared/file-item-icon'
import {SYSTEM_MANAGED_ROOT_PATHS} from '@/features/files/constants'
import {MachineFolderMetadata} from '@/features/files/hooks/use-machine-folder'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {formatItemName} from '@/features/files/utils/format-filesystem-name'
import type {Machine} from '@/features/machines/types'
import {cn} from '@/lib/utils'

// The narrowest the current folder's name gets, once everything above it is folded away
const CURRENT_MIN_WIDTH = 72

// A folder's name is cut in its middle when it is very long. A search's title is a sentence, and reads whole.
const segmentLabel = ({segment, type}: PathSegment, machine: Machine | undefined) =>
	machine ? machine.name : type === 'search' ? segment : segment && formatItemName({name: segment})

// Where Files is, as the bar's title: the way down from the root with the
// current folder at its end, in the title's own type and in words alone. The
// folders above are dimmed and each is a way back up, and somewhere to drop
// what is being dragged. A path too long for the bar folds the folders in
// the middle into a menu, the ones nearest the root first, so the root, the
// folder above and the current folder stay in view and whole. Shorter of
// room still the folder above joins them, then the root, and the current
// folder's name is cut only once it stands beside the menu alone.
//
// Every folder keeps a little room either side of its name, except the root
// at its start: the path begins at the bar's own edge, where the line under
// it (what the folder holds) begins too.
export function PathCrumbs() {
	const {t} = useTranslation()
	// The list measures and lays out the segments; its scroller is the last
	// resort for a bar too narrow even for the menu beside the current folder
	const listRef = useRef<HTMLUListElement | null>(null)
	const scrollerRef = useRef<HTMLDivElement | null>(null)
	const {navigateToDirectory} = useNavigate()
	const segments = usePathSegments()

	// Whether the root, and how many folders after it, are folded into the overflow menu
	const [foldsRoot, setFoldsRoot] = useState(false)
	const [folded, setFolded] = useState(0)
	const menuFocus = useMenuFocusReturn()

	// Widths and visibility are set on the elements directly, so measuring and
	// laying out happen in one pass before paint
	const fitSegments = useCallback(() => {
		const list = listRef.current
		if (!list) return

		const items = Array.from(list.children).filter((i): i is HTMLElement => i instanceof HTMLElement)
		const overflowItem = items.find((item) => item.hasAttribute('data-overflow'))
		const segmentItems = items.filter((item) => item !== overflowItem)

		// Measure everything at its natural width
		items.forEach((item) => {
			item.hidden = false
			item.style.removeProperty('--item-width')
		})
		delete overflowItem?.dataset.leads
		const widths = segmentItems.map((item) => item.getBoundingClientRect().width)

		const fit = fitPathSegments({
			available: list.clientWidth,
			widths,
			// A title's folders fold into the menu whole rather than narrow to stubs
			minWidth: Infinity,
			minCurrentWidth: CURRENT_MIN_WIDTH,
			overflowWidth: overflowItem?.getBoundingClientRect().width ?? 0,
		})

		if (overflowItem) {
			overflowItem.hidden = !fit.foldsRoot && fit.folded === 0
			// With the root folded into it the menu is what the path starts with,
			// and starts at the bar's edge as the root does
			if (fit.foldsRoot) overflowItem.dataset.leads = ''
		}
		segmentItems.forEach((item, i) => {
			if (i === 0 ? fit.foldsRoot : i <= fit.folded) item.hidden = true
			const width = fit.widths[i]
			if (width !== undefined) item.style.setProperty('--item-width', `${Math.floor(width)}px`)
		})
		setFoldsRoot(fit.foldsRoot)
		setFolded(fit.folded)
	}, [])

	useLayoutEffect(() => {
		if (!listRef.current) return

		const resizeObserver = new ResizeObserver(fitSegments)
		resizeObserver.observe(listRef.current)

		fitSegments()

		// If even the menu beside a narrowed current folder doesn't fit, show the current folder
		requestAnimationFrame(() => {
			if (scrollerRef.current) scrollerRef.current.scrollLeft = scrollerRef.current.scrollWidth
		})

		return () => resizeObserver.disconnect()
	}, [fitSegments, segments])

	return (
		<FadeScroller direction='x' className='umbrel-hide-scrollbar overflow-x-auto' ref={scrollerRef}>
			<ul
				ref={listRef}
				className='flex items-center text-17 leading-tight font-semibold -tracking-2 whitespace-nowrap'
				aria-label={t('files-path.label')}
			>
				{segments.map((segment, i) => (
					<Fragment key={segment.id}>
						<Crumb
							segment={segment}
							isCurrent={i === segments.length - 1}
							isRoot={i === 0}
							onClick={() => navigateToDirectory(segment.path)}
						/>
						{i === 0 && segments.length > 1 && (
							<li className='group/overflow inline-flex shrink-0 items-center' data-overflow>
								<DropdownMenu>
									<DropdownMenuTrigger
										aria-label={t('files-path.more-folders')}
										className={cn(
											'rounded-6 px-1 text-white/45 transition-colors group-data-leads/overflow:ps-0 hover:text-white/90 data-[state=open]:text-white/90',
											pathFocusClass,
										)}
										{...menuFocus.trigger}
									>
										<MoreHorizontal className='size-[18px]' />
									</DropdownMenuTrigger>
									<DropdownMenuContent align='start' className='max-w-72' {...menuFocus.content}>
										{segments.slice(foldsRoot ? 0 : 1, folded + 1).map((hidden) => (
											<PathMenuItem
												key={hidden.id}
												segment={hidden}
												onSelect={() => navigateToDirectory(hidden.path)}
											/>
										))}
									</DropdownMenuContent>
								</DropdownMenu>
								<Separator />
							</li>
						)}
					</Fragment>
				))}
			</ul>
		</FadeScroller>
	)
}

const Separator = () => (
	<ChevronRight className='mx-0.5 size-3.5 shrink-0 text-white/25' strokeWidth={2.5} aria-hidden />
)

function Crumb({
	segment,
	isCurrent,
	isRoot,
	onClick,
}: {
	segment: PathSegment
	isCurrent: boolean
	isRoot: boolean
	onClick: () => void
}) {
	return (
		<MachineFolderMetadata path={segment.path}>
			{({machine}) => {
				const name = <span className='min-w-0 truncate'>{segmentLabel(segment, machine)}</span>
				return (
					<li className='inline-flex w-(--item-width) shrink-0 items-center'>
						{isCurrent ? (
							// The folder on screen is the title itself, not a way anywhere
							<h2 aria-current='page' className={cn('inline-flex min-w-0 px-1 text-white/90', isRoot && 'ps-0')}>
								{name}
							</h2>
						) : (
							<>
								<Droppable
									as='button'
									id={`path-segment-${segment.path}`}
									path={segment.path}
									onClick={onClick}
									// Nothing can be dropped into a system-managed root (/Apps, /Machines)
									disabled={SYSTEM_MANAGED_ROOT_PATHS.has(segment.path)}
									className={cn(
										'inline-flex min-w-0 rounded-6 px-1 text-white/45 transition-colors hover:text-white/90 contrast-more:text-white/80',
										isRoot && 'ps-0',
										pathFocusClass,
									)}
								>
									{name}
								</Droppable>
								<Separator />
							</>
						)}
					</li>
				)
			}}
		</MachineFolderMetadata>
	)
}

// A folder folded into the overflow menu
const PathMenuItem = ({segment, onSelect}: {segment: PathSegment; onSelect: () => void}) => (
	<MachineFolderMetadata path={segment.path}>
		{({machine}) => (
			<DropdownMenuItem onSelect={onSelect} className='gap-2'>
				<FileItemIcon item={segmentIconItem(segment)} className='size-4 shrink-0' machine={machine ?? null} />
				<span className='truncate'>{segmentLabel(segment, machine)}</span>
			</DropdownMenuItem>
		)}
	</MachineFolderMetadata>
)
