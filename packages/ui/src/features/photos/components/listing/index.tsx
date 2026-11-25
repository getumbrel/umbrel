import {Plus, Upload} from 'lucide-react'
import {useEffect, useMemo, useRef, type ReactNode} from 'react'
import {useTranslation} from 'react-i18next'
import {TbLoader} from 'react-icons/tb'
import {useNavigate, useParams} from 'react-router-dom'

import {PillButton} from '@/components/ui/edge-controls'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {sectionLabel} from '@/features/photos/components/actions-bar/view-line'
import {CollectionsListing} from '@/features/photos/components/collections'
import {EmptyScreen, GhostGrid} from '@/features/photos/components/listing/empty-screen'
import {ListingSurface, type Frame} from '@/features/photos/components/listing/surface'
import {TimelineGrid} from '@/features/photos/components/listing/timeline-grid'
import {useListing, type Listing} from '@/features/photos/components/listing/use-listing'
import {understoodChips} from '@/features/photos/components/search/plan'
import {usePhotosSelection} from '@/features/photos/components/selection-context'
import {usePhotosView} from '@/features/photos/components/view-context'
import {isCollectionSection, isFilterSection, sectionPath} from '@/features/photos/constants'
import {listKey} from '@/features/photos/hooks/use-items'
import {useAlbums, useLibraryStatus} from '@/features/photos/hooks/use-library'
import {usePerson} from '@/features/photos/hooks/use-people'
import {usePhotoSources} from '@/features/photos/hooks/use-photo-sources'
import {useSearchNote} from '@/features/photos/hooks/use-search'
import {useUpload} from '@/features/photos/hooks/use-upload'
import {SearchChips} from '@/features/search/search-chips'
import {trpcReact} from '@/trpc/trpc'
import {useLinkToDialog} from '@/utils/dialog'

import {isWholeLibrary} from './route-filter'

export function PhotosListing() {
	const {section} = useParams()
	if (isCollectionSection(section)) return <CollectionsListing kind={section} />
	return <Timeline />
}

function Timeline() {
	const {t} = useTranslation()
	const {data: indexingState, isLoading: isLoadingState} = useLibraryStatus()
	// The grid shows whatever is ready and fills in as enrichment progresses;
	// the Library sidebar row carries the progress ring meanwhile
	const libraryQueryable =
		indexingState?.phase === 'ready' || indexingState?.phase === 'degraded' || indexingState?.phase === 'enriching'
	// Whatever answers the view — the timeline's pages, or a search's ranked
	// results — with the last answer held up while a search is refining: the
	// grid narrows in steps rather than blinking through a spinner on every
	// applied keystroke
	const {
		mode,
		filter,
		items,
		total,
		isLoading,
		hasMore,
		before,
		loadMore,
		loadAll,
		moments,
		answer,
		pending,
		understood,
	} = useListing({
		enabled: libraryQueryable,
		owner: true,
	})
	// Results in order of relevance are one section, named by the bar
	const ranked = useMemo(
		() => (mode === 'ranked' ? {title: t('photos-search.best-matches'), moments, answer, loadAll} : undefined),
		[mode, moments, answer, loadAll, t],
	)
	// A bare library that is empty mid-enrichment is still filling — keep the
	// spinner up rather than flashing the empty-library invitation. Filtered
	// views keep their own empty screens: a section may genuinely have nothing.
	// By value (see isWholeLibrary): the filter always carries its keys.
	const stillFilling = indexingState?.phase === 'enriching' && isWholeLibrary(filter)
	// A new filter is a new list: remount so scroll position and row cache start
	// clean. A ranked search being refined is one list re-ranking: tiles that
	// stay keep their pixels and move to their new places. While a ranked
	// answer is awaited the list shown is still the one before it, so the grid
	// keeps describing that one (its key, its filter, its count) and is only
	// replaced once, when the answer lands.
	const described = {listKey: ranked ? 'ranked' : listKey(filter), filter, total}
	const settled = useRef(described)
	if (!pending) settled.current = described
	const grid = pending ? settled.current : described

	return (
		// Edge to edge below lg, like iOS Photos' grid (see ListingSurface)
		<ListingSurface bleed>
			{(frame) =>
				indexingState?.phase === 'indexing' ? (
					<Indexing frame={frame} />
				) : isLoadingState || isLoading || (items.length === 0 && stillFilling) ? (
					<div className='relative isolate flex h-full items-center justify-center' style={{paddingTop: frame.inset}}>
						<GhostGrid />
						<TbLoader className='size-6 animate-spin opacity-50 shadow-xs' />
					</div>
				) : items.length === 0 ? (
					<Empty understood={understood} frame={frame} />
				) : (
					<TimelineGrid
						key={grid.listKey}
						items={items}
						total={grid.total}
						filter={grid.filter}
						hasMore={hasMore}
						before={before}
						loadMore={loadMore}
						frame={frame}
						inDeleted={filter.deleted === true}
						ranked={ranked}
						footer={
							indexingState?.phase === 'degraded' ? (
								<DegradedFooter completed={indexingState.completed} total={indexingState.total} />
							) : undefined
						}
					/>
				)
			}
		</ListingSurface>
	)
}

// Where Photos.app puts its iCloud status: a quiet line after the last row,
// read only once you've scrolled past everything that did prepare.
function DegradedFooter({completed, total}: {completed?: number; total?: number}) {
	const {t} = useTranslation()
	const failed = completed !== undefined && total !== undefined ? total - completed : 0
	return (
		<p className='text-12 text-white/40'>
			{failed > 0 ? t('photos-degraded.footer', {count: failed}) : t('photos-degraded.description')}
		</p>
	)
}

function Indexing({frame}: {frame: Frame}) {
	const {t} = useTranslation()
	return (
		<div
			className='relative isolate flex h-full flex-col items-center justify-center gap-2 p-6 text-center'
			style={{paddingTop: frame.inset}}
		>
			<GhostGrid />
			<TbLoader className='size-6 animate-spin opacity-50 shadow-xs' />
			<p className='text-13 text-white/50'>{t('photos-indexing.description')}</p>
		</div>
	)
}

// Nothing to show. Each way into an empty screen gets its own words and its
// own way forward: a search that found nothing says what it looked for —
// the words, where (a person's photos, an album), and what it read out of
// them as filters — and offers the ways out: the same words in the whole
// library when the view was narrower than that, or no search at all; a
// person's page with nothing left explains itself; an empty
// album offers to fill it — the way in is picking items from the library —
// unless that is already under way; the media sections invite the first
// upload; Favorites teaches the gesture and Deleted simply explains itself —
// neither needs a button. Hints that name a gesture use the one the device
// has: no drag and drop on touch, no tapping with a mouse. A phone source
// fills from the phone, so its screen points there instead of at the picker.
function Empty({understood, frame}: {understood: Listing['understood']; frame: Frame}) {
	const {t} = useTranslation()
	const selection = usePhotosSelection()
	const {search} = usePhotosView()
	const navigate = useNavigate()
	const linkToDialog = useLinkToDialog()
	const {sources} = usePhotoSources()
	const isTouch = useIsTouchDevice()
	// An album or source with nothing in it, as opposed to a search that finds
	// nothing there — from the route, not the filter (a search token also
	// fills albumIds/sourceIds)
	const {section, sourceId, albumId: routeAlbumId, personId} = useParams()
	const searchNote = useSearchNote(search.appliedText !== '')
	const albumId = search.active ? undefined : routeAlbumId
	const source = search.active ? undefined : sources.find(({id}) => id === sourceId)
	// The view a search was made in, when it is narrower than the library
	const person = usePerson(personId)
	// Someone merged into another person, or left without a photo, from
	// another window has no page any more: back to People, and Back does not
	// return here. Only once both lists have been read and neither holds
	// them: a list that could not be read says nothing of who is in it.
	const shown = trpcReact.photos.people.list.useQuery({hidden: false}, {enabled: personId !== undefined})
	const hidden = trpcReact.photos.people.list.useQuery({hidden: true}, {enabled: personId !== undefined})
	const gone =
		personId !== undefined &&
		!search.active &&
		shown.isSuccess &&
		hidden.isSuccess &&
		![...shown.data, ...hidden.data].some(({id}) => id === personId)
	useEffect(() => {
		if (gone) navigate(sectionPath('people'), {replace: true})
	}, [gone, navigate])
	const {data: albums} = useAlbums({enabled: routeAlbumId !== undefined})
	const searchedView = routeAlbumId
		? albums?.find(({id}) => id === routeAlbumId)?.name
		: sourceId
			? sources.find(({id}) => id === sourceId)?.name
			: isFilterSection(section) && section !== 'all'
				? sectionLabel(section, t)
				: undefined

	let title: string
	let description: string | undefined
	let actions: ReactNode = null
	// What Search read out of the words as filters, shown under a search that
	// found nothing: usually the reason ("2019" taken as a date) is right there
	let chips: ReactNode = null
	if (search.active) {
		const words = search.appliedText
		title = !words
			? t('photos-search.no-results-title')
			: personId
				? person?.name
					? t('photos-search.no-match-person-title', {name: person.name, query: words})
					: t('photos-search.no-match-unnamed-person-title', {query: words})
				: searchedView
					? t('photos-search.no-match-in-title', {view: searchedView, query: words})
					: t('photos-search.no-match-title', {query: words})
		// Why there may yet be something: the models are still loading, or
		// have not read the whole library
		if (words && searchNote) description = searchNote.text
		const read = understoodChips(understood?.chips ?? []).map(({chip}) => chip)
		if (read.length > 0)
			chips = (
				<div className='mt-2 flex flex-wrap items-center justify-center gap-2'>
					<span className='text-12 text-white/40'>{t('photos-search.understood-as')}</span>
					<SearchChips chips={read} />
				</div>
			)
		actions = (
			<>
				{/* The words may well be in the library, just not in this corner of it */}
				{words && (personId || searchedView) && (
					<PillButton className='backdrop-blur-sm' onClick={search.widen}>
						{t('photos-search.search-library')}
					</PillButton>
				)}
				<PillButton className='backdrop-blur-sm' onClick={search.clear}>
					{t('photos-search.clear')}
				</PillButton>
			</>
		)
	} else if (personId) {
		title = t('photos-people.person-empty-title')
		description = t('photos-people.person-empty-description')
	} else if (albumId) {
		title = t('photos-album.empty-title')
		description = t('photos-album.empty-description')
		actions = selection.pickingFor ? null : (
			<PillButton icon={Plus} className='backdrop-blur-sm' onClick={() => selection.pickFor(albumId)}>
				{t('photos-album.add-items')}
			</PillButton>
		)
	} else if (source) {
		title = t('photos-empty.source-title')
		if (source.type === 'iphone') {
			description = t('photos-empty.source-iphone-description')
		} else if (source.type === 'android') {
			description = t('photos-empty.source-android-description')
		} else {
			description = t('photos-empty.source-umbrel-description')
			actions = <UploadPill />
		}
	} else if (section === 'deleted') {
		title = t('photos-empty.deleted-title')
		description = t('photos-empty.deleted-description')
	} else if (section === 'favorites') {
		title = t('photos-empty.favorites-title')
		description = isTouch ? t('photos-empty.favorites-description') : t('photos-empty.favorites-description-pointer')
	} else {
		title =
			section === 'videos'
				? t('photos-empty.videos-title')
				: section === 'live-photos'
					? t('photos-empty.live-photos-title')
					: section === 'panoramas'
						? t('photos-empty.panoramas-title')
						: section === 'screenshots'
							? t('photos-empty.screenshots-title')
							: section === '360'
								? t('photos-empty.360-title')
								: t('photos-empty.library-title')
		description = isTouch ? t('photos-empty.library-description-touch') : t('photos-empty.library-description')
		actions = (
			<>
				<UploadPill />
				<PillButton
					icon={Plus}
					className='backdrop-blur-sm'
					onClick={() => navigate(linkToDialog('photos-add-source'))}
				>
					{t('photos-sources.add')}
				</PillButton>
			</>
		)
	}

	return <EmptyScreen frame={frame} title={title} description={description} chips={chips} actions={actions} />
}

// The actions bar's picker into the shared upload queue, but always with its
// word — on the empty screen it is the protagonist, not a toolbar squeeze
function UploadPill() {
	const {t} = useTranslation()
	const inputRef = useRef<HTMLInputElement>(null)
	const {upload} = useUpload()
	return (
		<>
			<input
				ref={inputRef}
				type='file'
				multiple
				accept='image/*,video/*'
				className='hidden'
				onChange={(event) => {
					if (event.target.files?.length) upload(event.target.files)
					event.target.value = ''
				}}
			/>
			<PillButton icon={Upload} className='backdrop-blur-sm' onClick={() => inputRef.current?.click()}>
				{t('photos-actions.upload')}
			</PillButton>
		</>
	)
}
