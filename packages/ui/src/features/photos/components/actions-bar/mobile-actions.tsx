import {CircleCheck, Ellipsis, Plus, Search} from 'lucide-react'
import {AnimatePresence, motion, useReducedMotion} from 'motion/react'
import {useTranslation} from 'react-i18next'
import {useNavigate, useParams} from 'react-router-dom'

import {PillButton} from '@/components/ui/edge-controls'
import {DeletedActions} from '@/features/photos/components/actions-bar/deleted-actions'
import {MapControls} from '@/features/photos/components/actions-bar/map-controls'
import {UploadButton} from '@/features/photos/components/actions-bar/upload-button'
import {useBarRoute} from '@/features/photos/components/actions-bar/use-bar-route'
import {usePhotosSelection} from '@/features/photos/components/selection-context'
import {usePhotosView} from '@/features/photos/components/view-context'
import {cn} from '@/lib/utils'
import {useLinkToDialog} from '@/utils/dialog'

// CircleCheck's ring sits inset within its viewBox, so at the pills' shared
// size-4 it reads a step smaller than its neighbours; drawn a touch larger
// it sits optically equal
function SelectGlyph({className}: {className?: string}) {
	return <CircleCheck className={cn(className, 'size-[18px]')} />
}

// On phones the page's controls live in the title row, in the room to the
// right of "Photos" — as the desktop bar sits in the sheet's title row —
// so the row over the grid keeps only the date and the zoom steps. Nothing
// can be hovered, so selecting starts from a button here; while selecting,
// the selection's actions take the bar's row and these step aside. Every
// button is a glyph: upload, the tile's own circled check for select, search.
// They float over the page as the bar's do — over the map, which runs up
// beneath the row — so they are the same glass (.umbrel-photos-actions, whose
// scroll-pinned ride is lg-only, where these are hidden)
export function MobileActions({className}: {className?: string}) {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const linkToDialog = useLinkToDialog()
	const selection = usePhotosSelection()
	const {search, mapControls} = usePhotosView()
	const reduceMotion = useReducedMotion() ?? false
	const {collection, isSources, isMap, inDeleted, hasGrid, isTimeline} = useBarRoute()
	const {albumId, sourceId} = useParams()

	return (
		<AnimatePresence initial={false}>
			{!selection.selecting && (
				<motion.div
					key='page'
					className={cn('umbrel-photos-actions flex items-center gap-2', className)}
					initial={reduceMotion ? false : {opacity: 0, y: -4}}
					animate={{opacity: 1, y: 0}}
					exit={reduceMotion ? undefined : {opacity: 0, y: -4}}
					transition={{duration: 0.2, ease: [0.215, 0.61, 0.355, 1]}}
				>
					{albumId && (
						<PillButton icon={Plus} aria-label={t('photos-album.add')} onClick={() => selection.pickFor(albumId)} />
					)}
					{sourceId && (
						<PillButton
							icon={Ellipsis}
							aria-label={t('photos-source.manage')}
							onClick={() => navigate(linkToDialog('photos-source', {id: sourceId}))}
						/>
					)}
					{isTimeline && !sourceId && <UploadButton iconOnly />}
					{/* The map's zoom, its way back to everything and its list, beside the search */}
					{isMap && mapControls && <MapControls controls={mapControls} compact />}
					{inDeleted && <DeletedActions iconOnly />}
					{/* The same circled check a tile wears when selected — the row
					    stays a clean run of glyphs */}
					{hasGrid && (
						<PillButton icon={SelectGlyph} aria-label={t('photos-selection.select')} onClick={selection.start} />
					)}
					{collection === 'albums' && (
						<PillButton
							icon={Plus}
							aria-label={t('photos-actions.create-album')}
							onClick={() => navigate(linkToDialog('photos-create-album'))}
						/>
					)}
					{isSources && (
						<PillButton
							icon={Plus}
							aria-label={t('photos-sidebar.add-source')}
							onClick={() => navigate(linkToDialog('photos-add-source'))}
						/>
					)}
					{/* Opens the title-row search (MobileSearch in PhotosLayout) */}
					<PillButton icon={Search} aria-label={t('photos-actions.search')} onClick={() => search.setOpen(true)} />
				</motion.div>
			)}
		</AnimatePresence>
	)
}
