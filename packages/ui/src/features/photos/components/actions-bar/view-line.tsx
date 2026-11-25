import {useMemo, useRef} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate, useParams} from 'react-router-dom'

import {FadeScroller} from '@/components/fade-scroller'
import {CountText} from '@/components/ui/count-text'
import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {useBarRoute} from '@/features/photos/components/actions-bar/use-bar-route'
import {useListing, type Listing} from '@/features/photos/components/listing/use-listing'
import {PersonAvatar} from '@/features/photos/components/people/person-avatar'
import {PersonName} from '@/features/photos/components/people/person-name'
import {understoodChips} from '@/features/photos/components/search/plan'
import {TokenIcon} from '@/features/photos/components/search/token-badge'
import {usePhotosView} from '@/features/photos/components/view-context'
import {isFilterSection, personPath, type FilterSection} from '@/features/photos/constants'
import {useAlbums, useLibrarySummary, type LibrarySummary} from '@/features/photos/hooks/use-library'
import {usePerson} from '@/features/photos/hooks/use-people'
import {usePhotoSource} from '@/features/photos/hooks/use-photo-sources'
import {useSearchNote} from '@/features/photos/hooks/use-search'
import {SearchChips} from '@/features/search/search-chips'
import {SearchNote} from '@/features/search/search-note'
import type {SearchChip} from '@/features/search/types'
import {cn} from '@/lib/utils'
import {formatNumberI18n} from '@/utils/number'

// What the timeline is showing and how much of it there is — "Library / 429
// items", "Favorites / 12 items", "Iceland / 32 items" — under the section
// date, which changes as you scroll while this line stays put. A person's
// page names them here with their face, and the name is theirs to edit in
// place. While a search narrows the view, the count becomes the search's:
// how many results it found (the same listing the grid shows, so it costs
// nothing), then what smart search read out of the words as filters ("dad in
// thailand 2026": a person, a place, a year), drawn as every search surface
// draws them — and, while smart search is still loading its models or reading
// the library, a word that its answer is not yet all it will be, after the
// count. The name, the count and that word are one line at every width: the
// word gives way first, all of it if need be, then the name, and the count
// stays whole.
// (A per-source status here — importing, needs attention — returns with the
// post-v1 source types and their states.)
export function ViewLine() {
	const {t, i18n} = useTranslation()
	const {section, sourceId, albumId, personId} = useParams()
	const navigate = useNavigate()
	const {search, mapArea} = usePhotosView()
	// The map counts its own area — it holds every point — so on it nothing is
	// asked of the server here
	const {isMap} = useBarRoute()
	const listing = useListing({enabled: !isMap})
	// While a search is being refined the grid holds its last answer, and so
	// does this line, dimmed: what it says is still true of the photos shown,
	// and it does not blink at every pause in the typing. A first answer has
	// nothing to hold: the list before it is not a search's.
	const said = useRef<Pick<Listing, 'total' | 'understood'>>({})
	if (!listing.pending) said.current = {total: listing.total, understood: listing.understood}
	const refining = listing.pending && listing.mode === 'ranked'
	const {total: listed, understood} = refining ? said.current : listing
	const total = isMap ? mapArea?.count : listed
	const read = useMemo(() => understoodChips(understood?.chips ?? []), [understood])
	const chips = useMemo(() => read.map(({chip}) => chip), [read])
	// Taking a chip off is disagreeing with that reading: the words it was
	// read from stay in the field, in quotes, as the words they are, the other
	// chips become tokens, and the search runs again
	const removeChip = (chip: SearchChip) =>
		search.replace(chip.asTyped, [
			...search.tokens,
			...read.flatMap((other) => (other.chip === chip ? [] : [other.token])),
		])
	const person = usePerson(personId)
	// A search that found nothing says this where it says so (see Listing)
	const found = useSearchNote(search.appliedText !== '')
	const note = total !== undefined && total > 0 ? found : undefined
	const {data: summary} = useLibrarySummary()
	// Only fetched on an album page; other routes leave it idle
	const {data: albums} = useAlbums({enabled: albumId !== undefined})
	const {source} = usePhotoSource(sourceId)

	let name: string | undefined
	let count: number | undefined
	// The library's total bytes, shown beside the whole-library count only —
	// the summary doesn't split sizes any finer
	let size: string | undefined
	if (isMap) {
		// "In view / 248 items" (the bar's title names the place), or the one
		// spot the list is narrowed to: "This spot / 70 items"
		name = t(mapArea?.spot ? 'photos-map.this-spot' : 'photos-map.in-view')
		count = total
	} else if (personId) {
		// Named by the editable name below, once the person is known
		name = person ? '' : undefined
		count = person?.count
	} else if (albumId) {
		const album = albums?.find((a) => a.id === albumId)
		name = album?.name
		count = album?.count
	} else if (sourceId) {
		name = source?.name
		count = summary?.bySource[sourceId]
	} else if (isFilterSection(section) && section !== 'all') {
		name = sectionLabel(section, t)
		count = summary && sectionCount(section, summary)
	} else {
		name = t('photos-actions.view-library')
		count = summary?.counts.items
		if (summary && summary.sizeBytes > 0) size = formatFilesystemSize(summary.sizeBytes)
	}
	if (name === undefined) return null
	const formattedCount =
		count === undefined ? '' : formatNumberI18n({n: count, showDecimals: false, locale: i18n.language})

	const formattedTotal =
		total === undefined ? '' : formatNumberI18n({n: total, showDecimals: false, locale: i18n.language})

	return (
		<div
			className={cn(
				'flex min-w-0 gap-x-2 gap-y-1.5 text-12 leading-tight -tracking-2 max-lg:flex-col lg:items-center',
				// Over the map it is read against the map's own names: a step brighter
				isMap ? 'text-white/75' : 'text-white/50',
				// A search's count is as long as it is, and beside an open search
				// field the block has what room the bar can spare: a line longer than
				// that is cut at the block's edge and not drawn under the control
				// after it. Only sideways: a person's name and the filters stand
				// taller than the line
				search.active && 'overflow-x-clip',
			)}
		>
			{/* The line itself. From lg what a search understood stands on it too,
			    after the count (this box is not one there); below, on a line of
			    its own under it */}
			<div className='flex min-w-0 items-center gap-2 lg:contents'>
				{person ? (
					<span className='flex min-w-0 items-center gap-0.5'>
						<PersonAvatar person={person} size={16} />
						<PersonName
							person={person}
							align='left'
							onMerged={(intoId) => navigate(personPath(intoId), {replace: true})}
							className='text-12 leading-6 -tracking-2'
						/>
					</span>
				) : (
					<span className='truncate'>{name}</span>
				)}
				{search.active ? (
					<>
						{total !== undefined && (
							<>
								<Slash />
								<span
									className={cn('shrink-0 transition-opacity duration-200', refining && 'opacity-50')}
									aria-busy={refining}
								>
									<CountText
										text={t('photos-search.result-count', {count: total, formattedCount: formattedTotal})}
										number={formattedTotal}
									/>
								</span>
								{/* When the line runs out of room this gives way before the name,
								    all of it if need be (see SearchNote) */}
								{note && <SearchNote line={note} />}
							</>
						)}
					</>
				) : (
					count !== undefined && (
						<>
							<Slash />
							<span className='shrink-0'>
								<CountText text={t('photos-actions.item-count', {count, formattedCount})} number={formattedCount} />
							</span>
							{/* When the line runs out of room, the size gives way first, then the
							    name, so the count always shows in full. The size shows whole or
							    not at all: once it doesn't fit, it wraps onto a second line this
							    one-line box clips, instead of ending in a lone ellipsis. The
							    empty first item holds the first line at full height, or the
							    second would start at the top */}
							{size && (
								<span className='flex h-[1lh] min-w-0 shrink-[999] flex-wrap overflow-hidden'>
									<span aria-hidden className='h-full' />
									<span className='whitespace-nowrap'>
										<Slash />
										<span className='ms-2'>{size}</span>
									</span>
								</span>
							)}
						</>
					)
				)}
			</div>
			{/* One line, however many chips: past the room there is they
			    scroll sideways under a faded edge, and the line stays as
			    tall as its words (the chips overhang it), so the title
			    above does not move when they come and go. On a phone, and
			    on a tablet, whose search field takes most of the row, the
			    count leaves them too little of the line, so they have one
			    of their own, held open for as long as the search is, so it
			    does not open and close under the grid as they come and go.
			    Inert while held — a chip of the last answer must not
			    rewrite words typed since. */}
			{search.active && (
				<FadeScroller
					direction='x'
					fadeSize={16}
					className={cn(
						'umbrel-hide-scrollbar min-w-0 overflow-x-auto transition-opacity duration-200 max-lg:h-6 max-lg:shrink-0 lg:-my-[5px] lg:flex-1',
						chips.length === 0 && 'lg:hidden',
						refining && 'pointer-events-none opacity-50',
					)}
				>
					<div className='flex h-full w-max items-center gap-2'>
						{chips.length > 0 && (
							<SearchChips
								chips={chips}
								className='w-max flex-nowrap [&>li]:shrink-0'
								onRemove={removeChip}
								// Someone is shown by their face, as they are in the field
								icon={(chip) => {
									const person = chip.type === 'person' && read.find((other) => other.chip === chip)?.token
									return person ? <TokenIcon token={person} size={12} /> : undefined
								}}
								removeLabel={(chip) => t('photos-search.remove-filter', {label: chip.label})}
							/>
						)}
					</div>
				</FadeScroller>
			)}
		</div>
	)
}

function Slash() {
	return (
		<span aria-hidden className='shrink-0 text-white/25'>
			/
		</span>
	)
}

// The sidebar's names for the filter sections (literal keys, for the i18n scanner)
export function sectionLabel(section: Exclude<FilterSection, 'all'>, t: (key: string) => string) {
	switch (section) {
		case 'favorites':
			return t('photos-sidebar.favorites')
		case 'photos':
			return t('photos-sidebar.photos')
		case 'videos':
			return t('photos-sidebar.videos')
		case 'live-photos':
			return t('photos-sidebar.live-photos')
		case 'panoramas':
			return t('photos-sidebar.panoramas')
		case 'screenshots':
			return t('photos-sidebar.screenshots')
		case '360':
			return t('photos-sidebar.spherical')
		case 'deleted':
			return t('photos-sidebar.deleted')
	}
}

// … and each section's whole-library count from the summary
function sectionCount(section: Exclude<FilterSection, 'all'>, summary: LibrarySummary) {
	switch (section) {
		case 'favorites':
			return summary.counts.favorites
		case 'photos':
			return summary.counts.photos
		case 'videos':
			return summary.counts.videos
		case 'live-photos':
			return summary.bySubKind.live
		case 'panoramas':
			return summary.bySubKind.panorama
		case 'screenshots':
			return summary.bySubKind.screenshot
		case '360':
			return summary.bySubKind.spherical
		case 'deleted':
			return summary.counts.deleted
	}
}
