import {Plus, Upload} from 'lucide-react'
import {useRef, type ReactNode} from 'react'
import {useTranslation} from 'react-i18next'
import {TbLoader} from 'react-icons/tb'
import {useNavigate, useParams} from 'react-router-dom'

import {PillButton} from '@/components/ui/edge-controls'
import {useIsTouchDevice} from '@/features/files/hooks/use-is-touch-device'
import {CollectionsListing} from '@/features/photos/components/collections'
import {EmptyScreen, GhostGrid} from '@/features/photos/components/listing/empty-screen'
import {ListingSurface, type Frame} from '@/features/photos/components/listing/surface'
import {TimelineGrid} from '@/features/photos/components/listing/timeline-grid'
import {usePhotosSelection} from '@/features/photos/components/selection-context'
import {usePhotosView} from '@/features/photos/components/view-context'
import {isCollectionSection} from '@/features/photos/constants'
import {useItems, type ItemFilter} from '@/features/photos/hooks/use-items'
import {useLibraryStatus} from '@/features/photos/hooks/use-library'
import {usePhotoSources} from '@/features/photos/hooks/use-photo-sources'
import {useUpload} from '@/features/photos/hooks/use-upload'
import {useLinkToDialog} from '@/utils/dialog'

import {isWholeLibrary, useRouteFilter} from './route-filter'

export {useRouteFilter} from './route-filter'

export function PhotosListing() {
	const {section} = useParams()
	if (isCollectionSection(section)) return <CollectionsListing kind={section} />
	return <Timeline />
}

function Timeline() {
	const filter = useRouteFilter()
	const {search} = usePhotosView()
	const {data: indexingState, isLoading: isLoadingState} = useLibraryStatus()
	// The grid shows whatever is ready and fills in as enrichment progresses;
	// the Library sidebar row carries the progress ring meanwhile
	const libraryQueryable =
		indexingState?.phase === 'ready' || indexingState?.phase === 'degraded' || indexingState?.phase === 'enriching'
	// `keepPrevious` while a search is refining: the last results stay up until
	// the next arrive — the grid narrows in steps rather than blinking through
	// a spinner on every applied keystroke
	const {items, total, isLoading, hasMore, loadMore} = useItems(filter, {
		enabled: libraryQueryable,
		keepPrevious: search.active,
	})
	// A bare library that is empty mid-enrichment is still filling — keep the
	// spinner up rather than flashing the empty-library invitation. Filtered
	// views keep their own empty screens: a section may genuinely have nothing.
	// By value (see isWholeLibrary): the filter always carries its keys.
	const stillFilling = indexingState?.phase === 'enriching' && isWholeLibrary(filter)
	// A new filter is a new list: remount so scroll position and row cache start clean
	const listKey = JSON.stringify(filter)

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
					<Empty filter={filter} frame={frame} />
				) : (
					<TimelineGrid
						key={listKey}
						items={items}
						total={total}
						filter={filter}
						hasMore={hasMore}
						loadMore={loadMore}
						frame={frame}
						inDeleted={filter.deleted === true}
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
// own way forward: a search that found nothing offers the way out; an empty
// album offers to fill it — the way in is picking items from the library —
// unless that is already under way; the media sections invite the first
// upload; Favorites teaches the gesture and Deleted simply explains itself —
// neither needs a button. Hints that name a gesture use the one the device
// has: no drag and drop on touch, no tapping with a mouse. A phone source
// fills from the phone, so its screen points there instead of at the picker.
function Empty({frame}: {filter: ItemFilter; frame: Frame}) {
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
	const {section, sourceId, albumId: routeAlbumId} = useParams()
	const albumId = search.active ? undefined : routeAlbumId
	const source = search.active ? undefined : sources.find(({id}) => id === sourceId)

	let title: string
	let description: string | undefined
	let actions: ReactNode = null
	if (search.active) {
		title = t('photos-search.no-results-title')
		actions = (
			<PillButton className='backdrop-blur-sm' onClick={search.clear}>
				{t('photos-search.clear')}
			</PillButton>
		)
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

	return <EmptyScreen frame={frame} title={title} description={description} actions={actions} />
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
