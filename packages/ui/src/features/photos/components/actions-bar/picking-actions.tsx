import {Album} from 'lucide-react'
import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useNavigate} from 'react-router-dom'

import {PillButton} from '@/components/ui/edge-controls'
import {toast} from '@/components/ui/toast'
import {usePhotosSelection} from '@/features/photos/components/selection-context'
import {BASE_ROUTE_PATH} from '@/features/photos/constants'
import {useAlbumActions, useAlbums} from '@/features/photos/hooks/use-library'
import {useBreakpoint} from '@/utils/tw'

// What the actions bar offers while items are being picked for an album,
// on every page (the picking follows the user around the library): add
// what has been picked to the album, or cancel. Either way the flow ends
// on the album's page — with the items, or as it was. Below xl the button
// says just "Add", as Upload drops its label there: the title already counts
// the picks, and the name would crowd the grouping and zoom controls.
export function PickingActions({albumId}: {albumId: string}) {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const selection = usePhotosSelection()
	const {addToAlbum} = useAlbumActions()
	const {data: albums} = useAlbums()
	const breakpoint = useBreakpoint()
	const [busy, setBusy] = useState(false)
	const album = albums?.find((candidate) => candidate.id === albumId)
	const label =
		album && (breakpoint === 'xl' || breakpoint === '2xl') ? (
			<AddToAlbumLabel name={album.name} />
		) : (
			t('photos-album.add')
		)

	const finish = () => {
		selection.done()
		navigate(`${BASE_ROUTE_PATH}/albums/${albumId}`)
	}
	const add = async () => {
		setBusy(true)
		try {
			await addToAlbum({id: albumId, ids: [...selection.ids]})
			finish()
		} catch {
			toast.error(t('photos-selection.failed'), {area: 'photos'})
		} finally {
			setBusy(false)
		}
	}

	return (
		<>
			{/* Up to 256px, and narrower when the bar is, clipping rather than spilling at its narrowest */}
			<PillButton
				icon={Album}
				disabled={selection.ids.size === 0 || busy}
				onClick={add}
				className='max-w-64 min-w-0 shrink overflow-hidden'
			>
				{label}
			</PillButton>
			<PillButton onClick={finish}>{t('cancel')}</PillButton>
		</>
	)
}

// "Add to <album>" with only the album's name truncating: the name is the
// user's and can be any length, so the pill stays a pill and Cancel stays
// beside it, while the words around the name (before or after it, by
// language) always show.
const NAME_MARK = '\uE000'
function AddToAlbumLabel({name}: {name: string}) {
	const {t} = useTranslation()
	const [before, after] = t('photos-album.add-to', {album: NAME_MARK}).split(NAME_MARK)
	return (
		<span className='flex min-w-0 whitespace-pre'>
			{before}
			<span className='truncate'>{name}</span>
			{after}
		</span>
	)
}
