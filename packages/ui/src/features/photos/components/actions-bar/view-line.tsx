import {useTranslation} from 'react-i18next'
import {useParams} from 'react-router-dom'

import {formatFilesystemSize} from '@/features/files/utils/format-filesystem-size'
import {CountText} from '@/features/photos/components/actions-bar/count-text'
import {useBarRoute} from '@/features/photos/components/actions-bar/use-bar-route'
import {useRouteFilter} from '@/features/photos/components/listing'
import {usePhotosView} from '@/features/photos/components/view-context'
import {isFilterSection, type FilterSection} from '@/features/photos/constants'
import {useItems} from '@/features/photos/hooks/use-items'
import {useAlbums, useLibrarySummary, type LibrarySummary} from '@/features/photos/hooks/use-library'
import {usePhotoSource} from '@/features/photos/hooks/use-photo-sources'
import {formatNumberI18n} from '@/utils/number'

// What the timeline is showing and how much of it there is — "Library / 429
// items", "Favorites / 12 items", "Iceland / 32 items" — under the section
// date, which changes as you scroll while this line stays put. While a
// search narrows the view, the count becomes the search's: how many results
// it found (the same list query the grid shows, so it costs nothing).
// (A per-source status here — importing, needs attention — returns with the
// post-v1 source types and their states.)
export function ViewLine() {
	const {t, i18n} = useTranslation()
	const {section, sourceId, albumId} = useParams()
	const {search, mapArea} = usePhotosView()
	// The map counts its own area — it holds every point — so on it nothing is
	// asked of the server here
	const {isMap} = useBarRoute()
	const list = useItems(useRouteFilter(), {enabled: !isMap, keepPrevious: search.active})
	const total = isMap ? mapArea?.count : list.total
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
		// "In view / 248 items" (the bar's title names the place)
		name = t('photos-map.in-view')
		count = total
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
		<p className='flex min-w-0 items-center gap-2 text-12 leading-tight -tracking-2 text-white/50'>
			<span className='truncate'>{name}</span>
			{search.active
				? total !== undefined && (
						<>
							<Slash />
							<span className='shrink-0'>
								<CountText
									text={t('photos-search.result-count', {count: total, formattedCount: formattedTotal})}
									number={formattedTotal}
								/>
							</span>
						</>
					)
				: count !== undefined && (
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
					)}
		</p>
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
function sectionLabel(section: Exclude<FilterSection, 'all'>, t: (key: string) => string) {
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
