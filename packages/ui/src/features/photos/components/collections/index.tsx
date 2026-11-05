import {Plus} from 'lucide-react'
import {useLayoutEffect, useRef} from 'react'
import {useTranslation} from 'react-i18next'
import {TbLoader} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'

import {PillButton} from '@/components/ui/edge-controls'
import {AlbumCard} from '@/features/photos/components/albums/album-card'
import {EmptyScreen, GhostGrid} from '@/features/photos/components/listing/empty-screen'
import {FadedScroller} from '@/features/photos/components/listing/faded-scroller'
import {ListingSurface} from '@/features/photos/components/listing/surface'
import {BASE_ROUTE_PATH} from '@/features/photos/constants'
import {useAlbums} from '@/features/photos/hooks/use-library'
import {DockSpacer} from '@/modules/desktop/dock'
import {useLinkToDialog} from '@/utils/dialog'

// The listing unmounts whenever an album is opened (the routes swap the
// whole view), so its scroll position is kept here for the session and put
// back before paint — coming back from an album, or from choosing its
// cover, lands where the user left, not at the top.
const scrollPositions = new Map<string, number>()

// Albums as cover cards; each opens the album's timeline. Laid out like the
// timeline: edge to edge on the listing surface, starting under the actions
// bar and dissolving into it when scrolled.
// People and Locations are cut from v1 — their round/square cover-tile grid
// lived here too (kind: 'people' | 'locations'); restore it from git when
// face/geo clustering ships.
export function CollectionsListing({kind}: {kind: 'albums'}) {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const linkToDialog = useLinkToDialog()
	const albums = useAlbums({enabled: kind === 'albums'})
	// The scroller only exists once the albums have loaded, so the restore
	// waits for that render; the card grid's height is pure CSS (aspect-ratio
	// tiles), already laid out when this runs
	const scrollerRef = useRef<HTMLDivElement>(null)
	const loaded = !albums.isLoading
	useLayoutEffect(() => {
		const el = scrollerRef.current
		if (!el) return
		el.scrollTop = scrollPositions.get(kind) ?? 0
		return () => {
			scrollPositions.set(kind, el.scrollTop)
		}
	}, [kind, loaded])

	return (
		<ListingSurface>
			{(frame) =>
				albums.isLoading ? (
					<div className='relative isolate flex h-full items-center justify-center' style={{paddingTop: frame.inset}}>
						<GhostGrid />
						<TbLoader className='size-6 animate-spin opacity-50 shadow-xs' />
					</div>
				) : !albums.data?.length ? (
					// The same empty screen as every other listing, with the way to make the first one
					<EmptyScreen
						frame={frame}
						title={t('photos-empty.albums-title')}
						description={t('photos-empty.albums-description')}
						actions={
							<PillButton
								icon={Plus}
								className='backdrop-blur-sm'
								onClick={() => navigate(linkToDialog('photos-create-album'))}
							>
								{t('photos-actions.create-album')}
							</PillButton>
						}
					/>
				) : (
					<FadedScroller ref={scrollerRef} frame={frame}>
						{/* A little side room, so a card lifting on hover isn't clipped at the scroller's edges */}
						<div
							className='grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2.5 px-1.5 lg:grid-cols-[repeat(auto-fill,minmax(240px,1fr))]'
							style={{paddingTop: frame.inset}}
						>
							{albums.data.map((album) => (
								<AlbumCard
									key={album.id}
									album={album}
									className='aspect-[10/7]'
									onClick={() => navigate(`${BASE_ROUTE_PATH}/albums/${album.id}`)}
								/>
							))}
						</div>
						{/* Room at the end: for the last row to clear the dock the surface runs beneath */}
						<DockSpacer />
					</FadedScroller>
				)
			}
		</ListingSurface>
	)
}
