import {Plus} from 'lucide-react'
import {AnimatePresence, motion, useReducedMotion} from 'motion/react'
import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {HiMenuAlt2} from 'react-icons/hi'
import {useNavigate, useParams} from 'react-router-dom'

import {FilterPills, PillButton} from '@/components/ui/edge-controls'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {CountText} from '@/features/photos/components/actions-bar/count-text'
import {DeletedActions} from '@/features/photos/components/actions-bar/deleted-actions'
import {MapControls} from '@/features/photos/components/actions-bar/map-controls'
import {MobileActions} from '@/features/photos/components/actions-bar/mobile-actions'
import {PickingActions} from '@/features/photos/components/actions-bar/picking-actions'
import {SelectionActions} from '@/features/photos/components/actions-bar/selection-actions'
import {UploadButton} from '@/features/photos/components/actions-bar/upload-button'
import {useBarRoute} from '@/features/photos/components/actions-bar/use-bar-route'
import {ViewLine} from '@/features/photos/components/actions-bar/view-line'
import {ZoomSlider} from '@/features/photos/components/actions-bar/zoom-slider'
import {SearchPill, useSearchEngaged} from '@/features/photos/components/search'
import {usePhotosSelection} from '@/features/photos/components/selection-context'
import {SourceActions} from '@/features/photos/components/sources/source-actions'
import {usePhotosView} from '@/features/photos/components/view-context'
import type {CollectionSection} from '@/features/photos/constants'
import {useAlbums} from '@/features/photos/hooks/use-library'
import {usePhotoSources} from '@/features/photos/hooks/use-photo-sources'
import {useIsMobile} from '@/hooks/use-is-mobile'
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
// Albums gets "Create album", Sources "Add source"; Deleted only what every
// page has, search. Zoom and search live in the view
// context so the listing reacts to them. Deleted additionally offers a
// media-only permanent purge of Trash. On phones the page's controls sit
// in the title row instead (MobileActions), leaving this row to the date.
//
// While items are selected the bar is the selection's: how many, and what
// can be done with them (SelectionActions) in place of the page's controls.
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
	// A phone's grid zooms under the fingers — two columns to six in one
	// pinch — so the − / + steps would only be a smaller, slower copy of the
	// gesture taking the date's row. A window merely narrowed to a phone's
	// width has a mouse, and keeps them.
	const pinchZooms = useIsTouchDevice() && isMobile
	const selection = usePhotosSelection()
	const {albumId, sourceId} = useParams()
	const reduceMotion = useReducedMotion() ?? false
	// Which way the drum turns: up as the selection's face comes in, down as it leaves
	const direction = selection.selecting ? 1 : -1
	const faceProps = (variants: typeof titleRoll) => ({
		custom: direction,
		variants: reduceMotion ? undefined : variants,
		initial: 'initial',
		animate: 'animate',
		exit: 'exit',
	})
	const {collection, isSources, isMap, inDeleted, isTimeline} = useBarRoute()
	const createAlbum = () => navigate(linkToDialog('photos-create-album'))
	const addSource = () => navigate(linkToDialog('photos-add-source'))

	return (
		<nav
			// The lg pull-up puts the bar in the sheet close button's row; xl's
			// wider sheet padding clears the × on its own, lg needs the padding.
			// A phone on its side has no title row, so this is the top row there
			className='umbrel-photos-actions relative z-10 flex h-11 w-full min-w-0 items-center gap-3 lg:-mt-[86px] lg:pr-5 xl:pr-0 phone-side:pr-9'
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
			{collection ? (
				<CollectionCount kind={collection} />
			) : isSources ? (
				<SourcesCount />
			) : (
				<div
					className={cn(
						'flex min-w-0 flex-col self-end',
						titleShadowClass,
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
									{t('photos-album.pick-cover')}
								</motion.h2>
							) : selection.selecting ? (
								<motion.h2 key='selection' className={titleClass} {...faceProps(titleRoll)}>
									<SelectionCount count={selection.ids.size} />
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
			    narrows with the title instead of squeezing it to a sliver */}
			<div
				className={cn(
					'relative -my-1.5 ml-auto flex items-center gap-2 overflow-x-visible overflow-y-clip py-1.5',
					selection.pickingFor && 'min-w-0',
				)}
			>
				<AnimatePresence mode='popLayout' initial={false} custom={direction}>
					{selection.coveringFor ? (
						<motion.div key='covering' className='flex items-center gap-2' {...faceProps(pillsRoll)}>
							{isTimeline && (
								<div className='hidden items-center gap-2 md:flex'>
									<TimelineZoom slider={!pinchZooms} />
								</div>
							)}
							<PillButton onClick={() => selection.done()}>{t('cancel')}</PillButton>
						</motion.div>
					) : selection.pickingFor ? (
						<motion.div key='picking' className='flex min-w-0 items-center gap-2' {...faceProps(pillsRoll)}>
							{isTimeline && (
								<div className='hidden items-center gap-2 md:flex'>
									<TimelineZoom slider={!pinchZooms} />
								</div>
							)}
							<PickingActions albumId={selection.pickingFor} />
						</motion.div>
					) : selection.selecting ? (
						<motion.div key='selection' className='flex items-center gap-2' {...faceProps(pillsRoll)}>
							<SelectionActions inDeleted={inDeleted} />
						</motion.div>
					) : (
						<motion.div key='page' className='flex items-center gap-2' {...faceProps(pillsRoll)}>
							{/* Phones and tablets: the page's controls live in the title row,
							    so the date's row carries only what sizes the grid beneath it —
							    the grouping where there's room, and the zoom steps for a mouse
							    (the slider folds to − / + below xl): on a touch screen the
							    date has the row. A phone on its side has no title row, so the
							    controls come here */}
							<div className='flex items-center gap-2 lg:hidden'>
								{isTimeline && (
									<div className='hidden md:flex'>
										<GroupingPills />
									</div>
								)}
								{isTimeline && !pinchZooms && <ZoomSlider />}
								{/* While a search is on, the title row is back with its field */}
								{!searchEngaged && <MobileActions className='hidden phone-side:flex' />}
							</div>
							<div className='hidden items-center gap-2 lg:flex'>
								{/* Most of the page's controls step aside while the search has
								    the stage; the zoom stays — narrowing the grid and resizing
								    its tiles go together — and everything returns when the
								    search is cleared */}
								<CollapseAside hidden={searchEngaged}>
									{isTimeline && <GroupingPills />}
									{inDeleted && <DeletedActions />}
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
										<CollapseAside hidden={searchEngaged}>
											{albumId && (
												<PillButton icon={Plus} onClick={() => selection.pickFor(albumId)}>
													{t('photos-album.add')}
												</PillButton>
											)}
											{sourceId ? <SourceActions sourceId={sourceId} /> : <UploadButton />}
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
function CollapseAside({hidden, children}: {hidden: boolean; children: React.ReactNode}) {
	return (
		<motion.div
			className='flex items-center gap-2 overflow-hidden'
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

// The grouping and the thumbnail size together (the picking face keeps them
// side by side; the page face lays them out itself so the slider can stay up
// while the search is open) — the size only where it isn't a pinch
function TimelineZoom({slider}: {slider: boolean}) {
	return (
		<>
			<GroupingPills />
			{slider && <ZoomSlider />}
		</>
	)
}

// Size and leading come from the clip box the title rolls in
const titleClass = tw`truncate font-semibold -tracking-2 text-white/90`
// A soft shadow under the date and the view line: they sit where tiles have
// all but faded back in, and a bright one would otherwise swallow them
const titleShadowClass = tw`[text-shadow:0_1px_2px_rgb(0_0_0/0.45),0_0_16px_rgb(0_0_0/0.35)]`
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
// until there is one
function SelectionCount({count}: {count: number}) {
	const {t, i18n} = useTranslation()
	if (count === 0)
		return (
			<span key='none' className={cn('block truncate', riseClass)}>
				{t('photos-selection.none')}
			</span>
		)
	const formattedCount = formatNumberI18n({n: count, showDecimals: false, locale: i18n.language})
	return (
		<span key='count' className={cn('block truncate', riseClass)}>
			<CountText text={t('photos-selection.count', {count, formattedCount})} number={formattedCount} />
		</span>
	)
}

// "7 albums" — nothing until the list is known. (People and Locations counts
// — photos-actions.people-count / location-count — return with those pages.)
function CollectionCount({kind}: {kind: CollectionSection}) {
	const {t, i18n} = useTranslation()
	const albums = useAlbums({enabled: kind === 'albums'})
	const count = albums.data?.length
	if (count === undefined) return null
	const formattedCount = formatNumberI18n({n: count, showDecimals: false, locale: i18n.language})
	// "0 albums" like "0 sources": the empty screen below says there are none yet
	return <h2 className={countClass}>{t('photos-actions.album-count', {count, formattedCount})}</h2>
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
