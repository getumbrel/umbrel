import {CircleCheck, Plus} from 'lucide-react'
import {AnimatePresence, motion, useReducedMotion} from 'motion/react'
import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {HiMenuAlt2} from 'react-icons/hi'
import {TbLoader} from 'react-icons/tb'
import {useNavigate, useParams} from 'react-router-dom'

import {CountText} from '@/components/ui/count-text'
import {FilterPills, PillButton} from '@/components/ui/edge-controls'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {DeletedActions} from '@/features/photos/components/actions-bar/deleted-actions'
import {MapControls} from '@/features/photos/components/actions-bar/map-controls'
import {MobileActions} from '@/features/photos/components/actions-bar/mobile-actions'
import {PeopleSelectionActions} from '@/features/photos/components/actions-bar/people-selection-actions'
import {PickingActions} from '@/features/photos/components/actions-bar/picking-actions'
import {SelectionActions} from '@/features/photos/components/actions-bar/selection-actions'
import {UploadButton} from '@/features/photos/components/actions-bar/upload-button'
import {useBarRoute} from '@/features/photos/components/actions-bar/use-bar-route'
import {ViewLine} from '@/features/photos/components/actions-bar/view-line'
import {ZoomSlider} from '@/features/photos/components/actions-bar/zoom-slider'
import {useListing} from '@/features/photos/components/listing/use-listing'
import {MobileSearch, SearchPill, useSearchEngaged} from '@/features/photos/components/search'
import {usePhotosSelection} from '@/features/photos/components/selection-context'
import {SourceActions} from '@/features/photos/components/sources/source-actions'
import {usePhotosView} from '@/features/photos/components/view-context'
import type {CollectionSection} from '@/features/photos/constants'
import {useAlbums} from '@/features/photos/hooks/use-library'
import {usePeople} from '@/features/photos/hooks/use-people'
import {usePhotoSources} from '@/features/photos/hooks/use-photo-sources'
import {useIsMobile, useIsPhone, useIsTablet} from '@/hooks/use-is-mobile'
import {cn} from '@/lib/utils'
import {useLinkToDialog} from '@/utils/dialog'
import {touchTargetClass} from '@/utils/element-classes'
import {formatNumberI18n} from '@/utils/number'
import {tw} from '@/utils/tw'

// Actions bar floating over the top of the Photos listing (which fades out
// beneath it); on desktop it sits in the sheet's close button's row, 10px
// under the sheet's top edge — the title row's top is 96px down, hence the
// pull-up (ListingSurface's BAR_TOP is the other half of that sum). What it
// offers follows the route: timeline pages get the timeline zoom, grid zoom
// and upload, a source's page its Import now / Manage, an album's its Add;
// Albums gets "Create album", People "Select", Sources "Add source"; Deleted
// only what every page has, search. A ranked search's results have no dates
// to group by, so the grouping steps aside while one is up. Zoom and search live in the view
// context so the listing reacts to them. Deleted additionally offers a
// media-only permanent purge of Trash. On phones the page's controls sit
// in the title row instead (MobileActions), leaving this row to the date. A
// tablet has the width for one row, as a desktop does: the bar comes up
// beside "Photos" and carries those same few buttons itself, and its search
// opens in their place.
//
// While items are selected the bar is the selection's: how many, and what
// can be done with them (SelectionActions) in place of the page's controls —
// on the People page, people (PeopleSelectionActions).
// While they are being picked for an album (from its Add button, or a new
// album's dialog) the bar keeps the timeline's zoom — it is for browsing to
// the right items — with Add and Cancel (PickingActions) in place of the
// rest, on every page the picking passes through.
// The two faces — title and controls together — turn over like a drum: the
// selection's rolls up into view as the page's rolls up and out, and on
// Done it turns back down. Pure transforms, each face rolling by its own
// height inside a clip: the pills are glass, and an opacity fade anywhere
// above a backdrop-filter takes its backdrop away for the duration. The
// leaving face is popped out of the layout so the arriving one takes its
// place at once.
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
	const navigate = useNavigate()
	const linkToDialog = useLinkToDialog()
	const {section, mapArea, mapControls} = usePhotosView()
	const searchEngaged = useSearchEngaged()
	const isMobile = useIsMobile()
	// A tablet's search has this row: the field and its Cancel stand where the
	// page's buttons were (a phone's takes the title row: see PhotosLayout)
	const isTablet = useIsTablet()
	const isPhone = useIsPhone()
	const searchingHere = isTablet && searchEngaged
	// A phone's grid zooms under the fingers — two columns to six in one
	// pinch — so the − / + steps would only be a smaller, slower copy of the
	// gesture taking the date's row. A window merely narrowed to a phone's
	// width has a mouse, and keeps them.
	const pinchZooms = useIsTouchDevice() && isMobile
	const selection = usePhotosSelection()
	const {albumId, sourceId, personId} = useParams()
	// Dates group a timeline; a ranked search's results are in order of relevance
	const ranked = useListing().mode === 'ranked'
	// Below the desktop layout the grouping is in the bar only where the bar
	// can hold it whole beside the longest date it may have to show, a day's
	// ("Wed, September 23, 2026"), whatever the grid is grouped by: a control
	// that came and went as the date changed, or with the grouping it sets,
	// would be worse than none. The bar's own width decides (it is a
	// container). What it must hold is 212px for the date, a 12px gap, the
	// grouping's 188px, and the buttons after it at 52px apiece: upload,
	// select and search under a finger (an album's page has its Add too);
	// under a mouse no select, and the zoom steps' 100px.
	const groupingRoomClass = pinchZooms
		? albumId
			? 'md:@min-[620px]/bar:flex'
			: 'md:@min-[568px]/bar:flex'
		: albumId
			? 'md:@min-[668px]/bar:flex'
			: 'md:@min-[616px]/bar:flex'
	const reduceMotion = useReducedMotion() ?? false
	// Which way the drum turns: up as the selection's face comes in, down as it leaves
	const direction = selection.selecting || searchingHere ? 1 : -1
	const faceProps = (variants: typeof titleRoll) => ({
		custom: direction,
		variants: reduceMotion ? undefined : variants,
		initial: 'initial',
		animate: 'animate',
		exit: 'exit',
	})
	const {collection, isSources, isMap, inDeleted, isTimeline} = useBarRoute()
	// Nobody to select on an empty People page
	const hasPeople = usePeople({enabled: collection === 'people'}).people.length > 0
	const timelineFace = isTimeline && !selection.coveringFor && !selection.pickingFor && !selection.selecting
	const createAlbum = () => navigate(linkToDialog('photos-create-album'))
	const addSource = () => navigate(linkToDialog('photos-add-source'))

	return (
		<nav
			// The lg pull-up puts the bar in the sheet close button's row; xl's
			// wider sheet padding clears the × on its own, lg needs the padding.
			// A phone on its side has no title row, so this is the top row there.
			// On a tablet it comes up into the title's row and starts after the
			// menu button and the title's box (20 + 16 + 124, and a gap). The row
			// is level with the sheet's close button there, which under a finger
			// answers across the whole 44px of the sheet's corner, so the row ends
			// short of that square, as a phone's does on its side: by 36px beside
			// the sheet's 12px of padding, and from md by 8px beside its 40px. Its
			// own width decides what it has room for (the grouping). Below the
			// desktop layout a search's filters have a line of their own under the
			// count, and the bar grows by it and does not let it rise into the
			// search field above.
			// The bar only comes up into the title's row where that row is not a
			// phone's, whose search field takes the whole of it: the one answer
			// that puts the field there (see TitleRow) keeps the bar out, so the
			// two cannot be drawn over each other whatever CSS makes of the window
			className={cn(
				'umbrel-photos-actions @container/bar relative z-10 flex min-h-11 w-full min-w-0 items-center gap-3 phone-side:pr-9',
				!isPhone &&
					'lg:-mt-[86px] lg:h-11 lg:pr-5 xl:pr-0 tablet:-mt-14 tablet:ml-[184px] tablet:w-auto tablet:max-md:pr-9 tablet:md:pr-2',
			)}
			aria-label={t('photos-actions.navigation')}
		>
			{onOpenSidebar && (
				<button
					type='button'
					onClick={onOpenSidebar}
					aria-label={t('photos-sidebar.navigation')}
					className={cn(touchTargetClass, 'hidden shrink-0 self-center pl-1 phone-side:block')}
				>
					<HiMenuAlt2 className='h-5 w-5 text-white/90' />
				</button>
			)}
			{/* Left side: on a collection page how many it holds; on a timeline the
			    section it is scrolled to — this row is where the grid's headers
			    would pin, so the title lives here instead and slides in as sections
			    pass (nothing until the grid has one) — or, while selecting, how
			    many are — over a line naming the view and its size, which stays
			    put. The block sits on the bar's bottom edge, as close above the
			    first row as the grid's own headers are above theirs. */}
			{/* (People are not what is being selected while photos are gathered
			    for an album, which follows the user here, or a cover is chosen) */}
			{collection === 'people' && selection.selecting && !selection.pickingFor && !selection.coveringFor ? (
				<h2 className={countClass}>
					<SelectionCount count={selection.ids.size} none={t('photos-people.select-none')} />
				</h2>
			) : collection ? (
				<CollectionCount kind={collection} />
			) : isSources ? (
				<SourcesCount />
			) : (
				<div
					className={cn(
						'flex min-w-0 flex-col self-end',
						// Beside a tablet's search the field has the say: this block
						// gives first, down to the room its line needs for the view's
						// name and the count whole in the longer languages, and from
						// md, where the row can spare it, for the start of what Search
						// has to say after them as well. That is the same whether or
						// not it has anything to say, so the field keeps its width as
						// those words come and go
						searchingHere && 'min-w-40 shrink-[999] md:min-w-52',
						// Over the map the title stands on the map itself, names and all,
						// under a light shade: its own shadow is deeper there
						isMap ? mapTitleShadowClass : titleShadowClass,
						// On desktop the map runs beneath the sidebar's glass card, which
						// reaches 8px past its column (the map's SIDEBAR_OVERHANG): the
						// title stands 20px clear of it
						isMap && 'lg:ml-7',
					)}
				>
					<div className='relative h-[1lh] overflow-y-clip text-17 leading-tight'>
						<AnimatePresence mode='popLayout' initial={false} custom={direction}>
							{selection.coveringFor ? (
								<motion.h2 key='covering' className={titleClass} {...faceProps(titleRoll)}>
									{selection.coveringFor.kind === 'person'
										? t('photos-people.pick-cover')
										: t('photos-album.pick-cover')}
								</motion.h2>
							) : selection.selecting ? (
								<motion.h2 key='selection' className={titleClass} {...faceProps(titleRoll)}>
									<SelectionCount count={selection.ids.size} gathering={selection.selectingAll} />
								</motion.h2>
							) : (
								<motion.div key='page' className='min-w-0' {...faceProps(titleRoll)}>
									{/* On the map, the place in view stands where the date would */}
									<SectionTitle section={isMap ? (mapArea?.place ?? t('photos-sidebar.map')) : section} />
								</motion.div>
							)}
						</AnimatePresence>
					</div>
					<ViewLine />
				</div>
			)}

			{/* Right side: the page's actions, or the selection's. Clipped above and
			    below (with room for focus rings), not at the sides: menus and
			    tooltips are portaled, and the wider face must not be cut while it rolls.
			    While picking, the album's name in Add can give way, so this side
			    narrows with the title instead of squeezing it to a sliver. On a
			    timeline's own face (from md, where it has the grouping) this side
			    takes the squeeze first: the grouping scrolls so the date stays whole.
			    A tablet shows the grouping only where the date has room beside it
			    (see below), so there nothing is squeezed. While a tablet's search
			    has this side it is the field's alone to size, at every width a
			    tablet has: giving as the title's block does, it gave the block
			    the width of whatever Search had to say after the count, and the
			    field changed width as those words came and went */}
			<div
				className={cn(
					'relative -my-1.5 ml-auto flex items-center gap-2 overflow-x-visible overflow-y-clip py-1.5',
					selection.pickingFor && 'min-w-0',
					timelineFace && !searchingHere && 'md:min-w-0 md:shrink-[999]',
					searchEngaged && 'lg:shrink-0',
					timelineFace && !searchingHere && 'tablet:shrink-0',
					// A search field is as wide as the bar can spare, and no wider than it
					// needs. It keeps to the title's row, level with the sheet's close
					// button, when the filters' line makes the bar taller
					searchingHere && 'min-w-0 shrink basis-[380px] self-start',
				)}
			>
				<AnimatePresence mode='popLayout' initial={false} custom={direction}>
					{selection.coveringFor ? (
						<motion.div key='covering' className='flex items-center gap-2' {...faceProps(pillsRoll)}>
							{isTimeline && <TimelineZoom slider={!pinchZooms} groupingClassName={groupingRoomClass} />}
							<PillButton onClick={() => selection.done()}>{t('cancel')}</PillButton>
						</motion.div>
					) : selection.pickingFor ? (
						<motion.div key='picking' className='flex min-w-0 items-center gap-2' {...faceProps(pillsRoll)}>
							{isTimeline && <TimelineZoom slider={!pinchZooms} groupingClassName={groupingRoomClass} />}
							<PickingActions albumId={selection.pickingFor} />
						</motion.div>
					) : selection.selecting ? (
						<motion.div key='selection' className='flex items-center gap-2' {...faceProps(pillsRoll)}>
							{collection === 'people' ? <PeopleSelectionActions /> : <SelectionActions inDeleted={inDeleted} />}
						</motion.div>
					) : searchingHere ? (
						<motion.div key='search' className='flex w-full min-w-0 items-center' {...faceProps(pillsRoll)}>
							<MobileSearch />
						</motion.div>
					) : (
						<motion.div key='page' className='flex min-w-0 items-center gap-2' {...faceProps(pillsRoll)}>
							{/* Phones: the page's controls live in the title row, so the
							    date's row carries only what sizes the grid beneath it: the
							    zoom steps for a mouse (the slider folds to − / + below xl),
							    and on a touch screen the date has the row. A tablet's title
							    row is this one and a phone on its side has none, so the
							    controls come here */}
							<div className='flex min-w-0 items-center gap-2 lg:hidden'>
								{isTimeline && !ranked && (
									<div className={cn('hidden min-w-0', groupingRoomClass)}>
										<GroupingPills />
									</div>
								)}
								{isTimeline && !pinchZooms && <ZoomSlider />}
								{/* While a search is on, the title row is back with its field */}
								{!searchEngaged && <MobileActions className='hidden shrink-0 phone-side:flex tablet:flex' />}
							</div>
							<div className='hidden min-w-0 items-center gap-2 lg:flex'>
								{/* Most of the page's controls step aside while the search has
								    the stage; the zoom stays — narrowing the grid and resizing
								    its tiles go together — and everything returns when the
								    search is cleared */}
								<CollapseAside hidden={searchEngaged}>
									{isTimeline && !ranked && <GroupingPills />}
									{inDeleted && <DeletedActions />}
									{collection === 'people' && hasPeople && (
										<PillButton icon={CircleCheck} onClick={selection.start}>
											{t('photos-selection.select')}
										</PillButton>
									)}
									{collection === 'albums' && (
										<PillButton icon={Plus} onClick={createAlbum}>
											{t('photos-actions.create-album')}
										</PillButton>
									)}
									{isSources && (
										<PillButton icon={Plus} onClick={addSource}>
											{t('photos-sidebar.add-source')}
										</PillButton>
									)}
								</CollapseAside>
								{isTimeline && (
									<>
										{!pinchZooms && <ZoomSlider />}
										<CollapseAside hidden={searchEngaged} className='shrink-0'>
											{albumId && (
												<PillButton icon={Plus} onClick={() => selection.pickFor(albumId)}>
													{t('photos-album.add')}
												</PillButton>
											)}
											{/* A person's page is made by recognition, not by uploading into it */}
											{sourceId ? <SourceActions sourceId={sourceId} /> : personId ? null : <UploadButton />}
										</CollapseAside>
									</>
								)}
								{/* The map's zoom, and its way back to everything and to the list */}
								{isMap && mapControls && <MapControls controls={mapControls} />}
								{/* Phones search from the title row (MobileSearch); mounting this
								    too would portal a second suggestion panel over it */}
								{!isMobile && <SearchPill />}
							</div>
						</motion.div>
					)}
				</AnimatePresence>
			</div>
		</nav>
	)
}

// A run of bar controls that steps aside while the search has the stage —
// width to zero under a fading clip — and returns when it is cleared. The
// collapsed negative margin swallows one flex gap, so the neighbours close
// ranks to their usual spacing rather than leaving a double gap around a
// zero-width box.
function CollapseAside({
	hidden,
	className,
	children,
}: {
	hidden: boolean
	className?: string
	children: React.ReactNode
}) {
	return (
		<motion.div
			className={cn('flex items-center gap-2 overflow-hidden', className)}
			initial={false}
			animate={hidden ? {width: 0, opacity: 0, marginLeft: -8} : {width: 'auto', opacity: 1, marginLeft: 0}}
			transition={ROLL}
			inert={hidden || undefined}
		>
			{children}
		</motion.div>
	)
}

// Years / months / days: what the grid is grouped by, which below the zoom
// seam is always years however the timeline was last set; picking another
// there is a zoom, and the grid comes back up to meet it.
function GroupingPills() {
	const {t} = useTranslation()
	const {zoom, setZoom, grid} = usePhotosView()
	return (
		<FilterPills
			value={grid?.grouping ?? zoom}
			onValueChange={(picked) => {
				setZoom(picked)
				grid?.regroup(picked)
			}}
			ariaLabel={t('photos-actions.zoom-label')}
			tabs={[
				{id: 'years', label: t('photos-actions.zoom.years')},
				{id: 'months', label: t('photos-actions.zoom.months')},
				{id: 'days', label: t('photos-actions.zoom.days')},
			]}
		/>
	)
}

// The grouping and the thumbnail size together, for the faces that keep them
// side by side while photos are being picked (the page face lays them out
// itself so the slider can stay up while the search is open): the grouping
// where the bar has the room for it, the size only where it isn't a pinch
function TimelineZoom({slider, groupingClassName}: {slider: boolean; groupingClassName: string}) {
	return (
		<>
			{/* (The desktop layout always has the room) */}
			<div className={cn('hidden min-w-0 lg:flex', groupingClassName)}>
				<GroupingPills />
			</div>
			{slider && (
				<div className='hidden md:flex'>
					<ZoomSlider />
				</div>
			)}
		</>
	)
}

// Size and leading come from the clip box the title rolls in
const titleClass = tw`truncate font-semibold -tracking-2 text-white/90`
// A soft shadow under the date and the view line: they sit where tiles have
// all but faded back in, and a bright one would otherwise swallow them
const titleShadowClass = tw`[text-shadow:0_1px_2px_rgb(0_0_0/0.45),0_0_16px_rgb(0_0_0/0.35)] contrast-more:[text-shadow:0_0_2px_rgb(0_0_0),0_1px_3px_rgb(0_0_0/0.9),0_0_16px_rgb(0_0_0/0.8)]`
const mapTitleShadowClass = tw`[text-shadow:0_1px_2px_rgb(0_0_0/0.8),0_0_10px_rgb(0_0_0/0.7),0_0_24px_rgb(0_0_0/0.5)]`
const riseClass = tw`motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in motion-safe:slide-in-from-bottom-1`
const countClass = 'min-w-0 truncate text-17 font-semibold -tracking-2 text-white/75'

// The date the grid is scrolled to, rising in as sections pass — except the
// one this mounts already knowing (the page face returning after a
// selection), which is simply there
function SectionTitle({section}: {section: string | null}) {
	// The section at mount, until it changes (undefined from then on)
	const [first, setFirst] = useState<string | null | undefined>(section)
	if (first !== undefined && section !== first) setFirst(undefined)
	if (section === null) return null
	return (
		<h2 key={section} className={cn(titleClass, first === undefined && riseClass)}>
			{section}
		</h2>
	)
}

// "3 selected", its number rolling as the selection changes; "Select items"
// until there is one (or what `none` says to pick). While a Select all is still
// loading the rest of the view (`gathering`) the number is only what has arrived
// so far, and says so with a spinner beside it until it rolls to the whole.
function SelectionCount({count, gathering = false, none}: {count: number; gathering?: boolean; none?: string}) {
	const {t, i18n} = useTranslation()
	if (count === 0)
		return (
			<span key='none' className={cn('block truncate', riseClass)}>
				{none ?? t('photos-selection.none')}
			</span>
		)
	const formattedCount = formatNumberI18n({n: count, showDecimals: false, locale: i18n.language})
	const text = t('photos-selection.count', {count, formattedCount})
	const at = text.indexOf(formattedCount)
	const spinner = gathering && (
		<TbLoader aria-hidden className='ml-2 size-3.5 shrink-0 animate-spin self-center opacity-60' />
	)
	if (at === -1)
		return (
			<span key='count' aria-busy={gathering} className={cn('flex min-w-0', riseClass)}>
				<span className='truncate'>{text}</span>
				{spinner}
			</span>
		)
	// Short of room the words give way, before or after the number by
	// language, and the number always shows whole
	return (
		<span key='count' aria-busy={gathering} className={cn('flex min-w-0', riseClass)}>
			<span className={countWordsClass}>{text.slice(0, at)}</span>
			<span className='shrink-0'>
				<CountText text={formattedCount} number={formattedCount} />
			</span>
			<span className={countWordsClass}>{text.slice(at + formattedCount.length)}</span>
			{spinner}
		</span>
	)
}
// whitespace-pre, not truncate, so the space beside the number is kept
const countWordsClass = tw`min-w-0 overflow-hidden text-ellipsis whitespace-pre`

// "7 albums", "12 people" — nothing until the list is known, and nothing over
// an empty People page, whose own words say it better. (The Locations count
// — photos-actions.location-count — returns with that page.)
function CollectionCount({kind}: {kind: CollectionSection}) {
	const {t, i18n} = useTranslation()
	const albums = useAlbums({enabled: kind === 'albums'})
	const people = usePeople({enabled: kind === 'people'})
	const count = kind === 'albums' ? albums.data?.length : people.isLoading ? undefined : people.people.length
	if (count === undefined || (kind === 'people' && count === 0)) return null
	const formattedCount = formatNumberI18n({n: count, showDecimals: false, locale: i18n.language})
	const label =
		kind === 'people'
			? t('photos-actions.people-count', {count, formattedCount})
			: // "0 albums" like "0 sources": the empty screen below says there are none yet
				t('photos-actions.album-count', {count, formattedCount})
	return <h2 className={countClass}>{label}</h2>
}

// "5 sources"
function SourcesCount() {
	const {t, i18n} = useTranslation()
	const {sources, isLoading} = usePhotoSources()
	if (isLoading) return null
	return (
		<h2 className={countClass}>
			{t('photos-actions.source-count', {
				count: sources.length,
				formattedCount: formatNumberI18n({n: sources.length, showDecimals: false, locale: i18n.language}),
			})}
		</h2>
	)
}
