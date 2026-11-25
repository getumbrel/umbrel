import {CircleCheck} from 'lucide-react'
import {AnimatePresence, motion, useReducedMotion} from 'motion/react'
import {useTranslation} from 'react-i18next'
import {HiMenuAlt2} from 'react-icons/hi'

import {FadeScroller} from '@/components/fade-scroller'
import {CountText} from '@/components/ui/count-text'
import {DarkTooltip} from '@/components/ui/dark-tooltip'
import {PillButton} from '@/components/ui/edge-controls'
import {useActionsBarConfig} from '@/features/files/components/listing/actions-bar/actions-bar-context'
import {MobileActions} from '@/features/files/components/listing/actions-bar/mobile-actions'
import {NavigationControls} from '@/features/files/components/listing/actions-bar/navigation-controls'
import {PathBar} from '@/features/files/components/listing/actions-bar/path-bar'
import {MobileSearch, SearchPill} from '@/features/files/components/listing/actions-bar/search'
import {
	PointerSelectionActions,
	SelectionActions,
	useHasPointerSelection,
} from '@/features/files/components/listing/actions-bar/selection-actions'
import {SortMenu, ViewOptionsButton, ViewToggle} from '@/features/files/components/listing/actions-bar/view-controls'
import {useFilesSearch, useFilesSearchEngaged} from '@/features/files/hooks/use-files-search'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {useNavigate} from '@/features/files/hooks/use-navigate'
import {useIsFilesEmbedded, useIsFilesReadOnly} from '@/features/files/providers/files-capabilities-context'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {SearchNote} from '@/features/search/search-note'
import {useSearchStatus} from '@/features/search/use-search'
import {useSearchFootnote, type SearchFootnoteLine} from '@/features/search/use-search-footnote'
import {useIsPhone, useIsPhoneNow, useIsTablet} from '@/hooks/use-is-mobile'
import {cn} from '@/lib/utils'
import {touchTargetClass} from '@/utils/element-classes'
import {formatNumberI18n} from '@/utils/number'
import {tw, useBreakpoint} from '@/utils/tw'

// The bar over every Files listing, a sibling of the one over Photos: on a
// desktop it sits in the sheet's title row, level with "Files". On the left
// it says where you are, the path as its title over a line counting what the
// folder holds; on the right are the folder's own controls, in the same pills
// and the same places Photos keeps its own, ending in the search.
//
// What it offers is the listing's to say (see actions-bar-context.tsx). On a
// phone the page's buttons live in the title row instead (MobileActions),
// leaving this row to the folder's name. A tablet has the width for one row,
// as a desktop does: the bar comes up beside "Files" and carries those same
// few buttons itself, and its search opens in their place.
//
// While a touch screen is selecting, the bar is the selection's: how many,
// and what can be done with them, in place of the page's controls. The two
// faces turn over like a drum, as they do in Photos: the selection's rolls up
// into view as the page's rolls up and out, and on Done it turns back down.
// With a pointer, selecting is no mode and the bar keeps its face: only the
// folder's own actions give their place to the selection's
// (PointerSelectionActions), by the same turn of the drum.
const EASE_OUT = [0.215, 0.61, 0.355, 1] as const
const ROLL = {duration: 0.25, ease: EASE_OUT}
// `distance` is the roll in the face's own height: 100% for the title, a
// little more for the pills so their focus rings clear the clip too
const roll = (distance: string) => ({
	initial: (direction: number) => ({y: direction > 0 ? distance : `-${distance}`}),
	animate: {y: 0, transition: ROLL},
	exit: (direction: number) => ({y: direction > 0 ? `-${distance}` : distance, transition: ROLL}),
})
const titleRoll = roll('100%')
const pillsRoll = roll('115%')

export function ActionsBar({onOpenSidebar}: {onOpenSidebar?: () => void}) {
	const {t} = useTranslation()
	const {
		hidePath,
		pathAccessory,
		hideSearch,
		hideViewOptions,
		actions = [],
		selectable = true,
		summary,
	} = useActionsBarConfig()
	const isReadOnly = useIsFilesReadOnly()
	const isEmbedded = useIsFilesEmbedded()
	const isTouchDevice = useIsTouchDevice()
	const isPhone = useIsPhoneNow()
	const breakpoint = useBreakpoint()
	const searchEngaged = useFilesSearchEngaged()
	// A tablet's search has this row: the field and its Cancel stand where the
	// page's buttons were (a phone's takes the title row: see FilesLayout)
	const isTablet = useIsTablet()
	// (Not isPhone above, which follows the keyboard: this is the one that
	// puts a phone's field in the title row)
	const isPhoneTitleRow = useIsPhone()
	const search = useFilesSearch()
	const searchingHere = isTablet && !isEmbedded && !!search && (search.open || search.query !== '')
	const reduceMotion = useReducedMotion() ?? false
	const isSelecting = useFilesStore((state) => state.isSelectingOnMobile)
	const setIsSelecting = useFilesStore((state) => state.setIsSelectingOnMobile)
	const selectedCount = useFilesStore((state) => state.selectedItems.length)

	// Which way the drum turns: up as the selection's face (or a tablet's
	// search) comes in, down as it leaves
	const direction = isSelecting || searchingHere ? 1 : -1
	const faceProps = (variants: typeof titleRoll, custom = direction) => ({
		custom,
		variants: reduceMotion ? undefined : variants,
		initial: 'initial',
		animate: 'animate',
		exit: 'exit',
	})
	// With a pointer only the folder's own actions turn over, to the selection's
	const hasPointerSelection = useHasPointerSelection()
	const slotDirection = hasPointerSelection ? 1 : -1

	// The pills carry their names where the bar has the room for them beside a
	// path a few folders deep. Below that they are glyphs, named on hover.
	const labelled = breakpoint === '2xl'
	// The listing's actions run from the one done most, which in the bar
	// stands last of them, nearest the controls that stay
	const pills = isReadOnly ? [] : actions.filter((action) => action.pill).reverse()
	const showSearch = !hideSearch && !isReadOnly && !isEmbedded
	// Search results come ranked by relevance; a sort control would reorder nothing
	const {isBrowsingSearch} = useNavigate()
	const showAccessory = !hidePath && !isSelecting && !searchingHere && !!pathAccessory

	return (
		<nav
			className={cn(
				'relative z-10 flex h-11 w-full min-w-0 items-center gap-2 lg:gap-3',
				// Up into the sheet's title row on a desktop, level with "Files". A
				// phone on its side has no title row, and the window's close button
				// sits at this row's end
				// A tablet's too, where the row is level with the sheet's close
				// button. Under a finger that button answers across the whole 44px of
				// the sheet's corner, so the row ends short of that square, as a
				// phone's does on its side: by 36px beside the sheet's 12px of padding,
				// and from md by 8px beside its 40px
				!isEmbedded && 'phone-side:pr-9',
				// It only comes up where the title row is not a phone's, whose search
				// field takes the whole of it: the one answer that puts the field
				// there (see TitleRow) keeps the bar out, so the two cannot be drawn
				// over each other whatever CSS makes of the window
				!isEmbedded && !isPhoneTitleRow && 'lg:-mt-14 tablet:-mt-14 tablet:max-md:pr-9 tablet:md:pr-2',
			)}
			aria-label={t('files-view.actions')}
		>
			{onOpenSidebar && (
				<button
					type='button'
					onClick={onOpenSidebar}
					aria-label={t('files-sidebar.navigation')}
					className={cn(touchTargetClass, 'hidden shrink-0 self-center px-1 phone-side:block')}
				>
					<HiMenuAlt2 className='h-5 w-5 text-white/90' />
				</button>
			)}

			{/* Left side: the way up or back, then where this is over how much it holds.
			    While a touch screen is selecting the title is how many are selected,
			    and the line under it stays put. */}
			{/* Always mounted: it keeps the history it steps through, and the last
			    folder for the dock to reopen */}
			<div className={cn('flex shrink-0 items-center empty:hidden', isSelecting && 'hidden')}>
				<NavigationControls />
			</div>
			{/* Beside a tablet's search the count under the title keeps room to be
			    read, and what Search has to say after it to be begun: the room
			    Photos' title keeps there */}
			<div
				className={cn(
					'flex min-w-0 flex-1 flex-col justify-center',
					searchingHere && 'min-w-36',
					// What a search understood stands right after its title
					showAccessory && 'flex-initial',
				)}
			>
				<div className='relative h-[1lh] overflow-y-clip text-17 leading-tight'>
					<AnimatePresence mode='popLayout' initial={false} custom={direction}>
						{isSelecting ? (
							<motion.h2 key='selection' className={titleClass} {...faceProps(titleRoll)}>
								<SelectionCount count={selectedCount} />
							</motion.h2>
						) : (
							<motion.div key='page' className='min-w-0' {...faceProps(titleRoll)}>
								{hidePath ? null : <PathBar compact={isPhone} />}
							</motion.div>
						)}
					</AnimatePresence>
				</div>
				<ListingMeta />
			</div>
			{/* Short of room it scrolls under a faded edge, rather than squeeze
			    what it holds to nothing or run under the controls, and is never
			    narrower than one short token */}
			{showAccessory && (
				<FadeScroller
					direction='x'
					fadeSize={16}
					className='umbrel-hide-scrollbar hidden min-w-16 shrink overflow-x-auto sm:block'
				>
					{pathAccessory}
				</FadeScroller>
			)}

			{/* Right side: the page's actions, or the selection's. Clipped above and
			    below (with room for focus rings), not at the sides: menus and
			    tooltips are portaled, and the wider face must not be cut while it rolls. */}
			<div
				className={cn(
					'relative -my-1.5 ml-auto flex items-center gap-2 overflow-x-visible overflow-y-clip py-1.5',
					// A search field is as wide as the bar can spare, and no wider than it needs
					searchingHere ? 'min-w-0 shrink basis-[320px]' : 'shrink-0',
				)}
			>
				<AnimatePresence mode='popLayout' initial={false} custom={direction}>
					{isSelecting ? (
						<motion.div key='selection' className='flex items-center gap-2' {...faceProps(pillsRoll)}>
							<SelectionActions />
						</motion.div>
					) : searchingHere ? (
						<motion.div key='search' className='flex w-full min-w-0 items-center' {...faceProps(pillsRoll)}>
							<MobileSearch />
						</motion.div>
					) : (
						<motion.div key='page' className='flex min-w-0 items-center gap-2' {...faceProps(pillsRoll)}>
							{/* Phones: the page's controls live in the title row, so this row
							    carries only how the folder is shown. A tablet's title row is
							    this one and a phone on its side has none, so the controls
							    come here. */}
							<div className={cn('flex items-center gap-2', !isEmbedded && 'lg:hidden')}>
								{isEmbedded ? (
									<>
										<ViewToggle />
										{!isBrowsingSearch && <SortMenu />}
									</>
								) : (
									<>
										{/* A pointer in a narrow window selects with a click, and
										    finds what to do with the selection here */}
										{hasPointerSelection ? (
											<PointerSelectionActions />
										) : (
											!hideViewOptions && <ViewOptionsButton quiet={!isTablet} />
										)}
										{!searchEngaged && <MobileActions className='hidden shrink-0 phone-side:flex tablet:flex' />}
									</>
								)}
							</div>
							{!isEmbedded && (
								<div className='hidden min-w-0 items-center gap-2 lg:flex'>
									{/* The page's controls step aside while the search has the
									    stage, and return when it is cleared */}
									<CollapseAside hidden={searchEngaged}>
										{/* What can be done here: to the folder, or to what is
										    selected in it. One place, at the head of the controls
										    so nothing else moves as the two take turns, and each
										    rolls in as the other rolls out. */}
										<div className='relative -my-1.5 flex items-center overflow-x-visible overflow-y-clip py-1.5'>
											<AnimatePresence mode='popLayout' initial={false} custom={slotDirection}>
												{hasPointerSelection ? (
													<motion.div
														key='selection'
														className='flex items-center gap-2'
														{...faceProps(pillsRoll, slotDirection)}
													>
														<PointerSelectionActions />
													</motion.div>
												) : (
													<motion.div
														key='page'
														className='flex items-center gap-2'
														{...faceProps(pillsRoll, slotDirection)}
													>
														{pills.map((action) => (
															<BarPill key={action.id} labelled={labelled} {...action} />
														))}
													</motion.div>
												)}
											</AnimatePresence>
										</div>
										{!hideViewOptions && (
											<>
												<ViewToggle />
												{!isBrowsingSearch && <SortMenu />}
											</>
										)}
										{/* Fingers can't drag a marquee or hold Shift, so a tablet selects from here */}
										{isTouchDevice && selectable && !isReadOnly && summary?.count !== 0 && (
											<PillButton
												icon={CircleCheck}
												aria-label={t('files-action.select')}
												onClick={() => setIsSelecting(true)}
											/>
										)}
									</CollapseAside>
									{showSearch && <SearchPill />}
								</div>
							)}
						</motion.div>
					)}
				</AnimatePresence>
			</div>
		</nav>
	)
}

// One of the folder's own actions as a pill: named where there is room, a
// glyph with its name on hover where there isn't
function BarPill({
	label,
	pill,
	icon,
	onSelect,
	disabled,
	labelled,
}: {
	label: string
	pill?: string | true
	icon: React.ComponentType<{className?: string}>
	onSelect: () => void
	disabled?: boolean
	labelled: boolean
}) {
	const name = typeof pill === 'string' ? pill : label
	if (labelled)
		return (
			<PillButton icon={icon} onClick={onSelect} disabled={disabled}>
				{name}
			</PillButton>
		)
	return (
		<DarkTooltip label={label} side='bottom'>
			<PillButton icon={icon} aria-label={label} onClick={onSelect} disabled={disabled} />
		</DarkTooltip>
	)
}

// A run of bar controls that steps aside while the search has the stage:
// width to zero under a fading clip. It returns when the search is cleared.
// The collapsed negative margin swallows one flex gap, so the neighbours close
// ranks to their usual spacing rather than leaving a double gap around a
// zero-width box. (The same move the Photos bar makes.)
function CollapseAside({hidden, children}: {hidden: boolean; children: React.ReactNode}) {
	return (
		<motion.div
			className={cn('flex items-center gap-2', hidden && 'overflow-hidden')}
			initial={false}
			animate={hidden ? {width: 0, opacity: 0, marginLeft: -8} : {width: 'auto', opacity: 1, marginLeft: 0}}
			transition={ROLL}
			inert={hidden || undefined}
		>
			{children}
		</motion.div>
	)
}

// Size and leading come from the clip box the title rolls in
const titleClass = tw`truncate font-semibold -tracking-2 text-white/90`
const riseClass = tw`motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in motion-safe:slide-in-from-bottom-1`

// "3 selected", its number rolling as the selection changes; "Select items"
// until there is one
function SelectionCount({count}: {count: number}) {
	const {t, i18n} = useTranslation()
	if (count === 0)
		return (
			<span key='none' className={cn('block truncate', riseClass)}>
				{t('files-selection.none')}
			</span>
		)
	const formattedCount = formatNumberI18n({n: count, showDecimals: false, locale: i18n.language})
	return (
		<span key='count' className={cn('block truncate', riseClass)}>
			<CountText text={t('files-selection.count', {count, formattedCount})} number={formattedCount} />
		</span>
	)
}

// How much the listing holds, under the title: "15 items / 10.5 MB". With a
// pointer it is also where a selection is counted ("3 of 15 selected"), so
// the title above keeps saying where you are. A search counts its results,
// and says when there may be more to come.
// Nothing until the listing has said what it holds, with the line's height
// kept so the title doesn't drop when it does.
function ListingMeta() {
	const {t, i18n} = useTranslation()
	const {summary, hidePath} = useActionsBarConfig()
	const isTouchDevice = useIsTouchDevice()
	const selectedItems = useFilesStore((state) => state.selectedItems)
	const format = (n: number) => formatNumberI18n({n, showDecimals: false, locale: i18n.language})

	const count = summary?.count
	// Beside a search's count, Search admitting it is not at full strength yet
	// (the line the command palette shows under its results)
	const typed = (useFilesSearch()?.query.trim() ?? '') !== ''
	const footnote = useSearchFootnote('files', useSearchStatus(summary?.isSearch === true && typed))
	const selectedCount = selectedItems.length
	// With a pointer the line counts the selection; a touch screen's title does
	const countsSelection = !isTouchDevice && selectedCount > 0 && count !== undefined

	let text: string | undefined
	let number: string | undefined
	let size: number | null | undefined
	let note: SearchFootnoteLine | undefined
	if (hidePath || count === undefined) {
		text = undefined
	} else if (countsSelection) {
		number = format(selectedCount)
		text = summary?.truncatedAt
			? t('files-listing.selected-count-truncated', {selectedCount: number, totalCount: format(summary.truncatedAt)})
			: t('files-listing.selected-count', {selectedCount: number, totalCount: format(count)})
		// What the selection weighs, when every item in it says
		size = selectedItems.every((item) => item.size != null)
			? selectedItems.reduce((total, item) => total + (item.size ?? 0), 0)
			: undefined
	} else if (summary?.isSearch) {
		number = format(count)
		text = summary.truncatedAt
			? t('files-search.result-count-truncated', {formattedCount: number})
			: t('files-search.result-count', {count, formattedCount: number})
		note = footnote
	} else if (summary?.truncatedAt) {
		number = format(summary.truncatedAt)
		text = t('files-listing.item-count-truncated', {formattedCount: number})
	} else {
		number = format(count)
		text = t('files-listing.item-count', {count, formattedCount: number})
		size = summary?.size
	}

	return (
		<p className='flex min-w-0 items-center gap-2 overflow-hidden text-12 leading-tight -tracking-2 text-white/50'>
			{text === undefined || number === undefined ? (
				<span aria-hidden>&nbsp;</span>
			) : (
				<>
					<span className='shrink-0'>
						<CountText text={text} number={number} />
					</span>
					{size != null && size > 0 && (
						// When the line runs out of room the size gives way, whole or not at all
						<span className='flex h-[1lh] min-w-0 shrink-[999] flex-wrap overflow-hidden'>
							<span aria-hidden className='h-full' />
							<span className='whitespace-nowrap'>
								<span aria-hidden className='text-white/25'>
									/
								</span>
								<span className='ms-2'>{formatFilesystemSize(size)}</span>
							</span>
						</span>
					)}
					{/* One line at every width, in a row that is one line tall: the
					    count stays whole and this gives way, all of it if need be (see
					    SearchNote) */}
					{note && <SearchNote line={note} />}
				</>
			)}
		</p>
	)
}
