import {useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbLoader} from 'react-icons/tb'
import {useNavigate} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {Input} from '@/components/ui/input'
import {toast} from '@/components/ui/toast'
import {usePhotosSelection} from '@/features/photos/components/selection-context'
import {BASE_ROUTE_PATH} from '@/features/photos/constants'
import {useAlbumActions} from '@/features/photos/hooks/use-library'
import {useDialogOpenProps} from '@/utils/dialog'

// Names a new album. With items selected (New album… from a selection) it
// is created with them and opened; otherwise it is created empty and its
// items are picked next, from anywhere in the library. Opened via
// ?dialog=photos-create-album.
export function CreateAlbumDialog() {
	const {t} = useTranslation()
	const navigate = useNavigate()
	const dialogProps = useDialogOpenProps('photos-create-album')
	const {createAlbum} = useAlbumActions()
	const selection = usePhotosSelection()
	const [name, setName] = useState('')
	const [busy, setBusy] = useState(false)
	const trimmed = name.trim()
	const withSelection = selection.ids.size > 0
	// A dismissed draft is dropped, so the next open starts blank
	const onOpenChange = (open: boolean) => {
		if (!open) setName('')
		dialogProps.onOpenChange(open)
	}

	const submit = async (event: React.FormEvent) => {
		event.preventDefault()
		if (!trimmed || busy) return
		setBusy(true)
		try {
			const album = await createAlbum({name: trimmed, ids: withSelection ? [...selection.ids] : undefined})
			setName('')
			// Neither destination has the dialog param, so this also closes the dialog
			if (withSelection) {
				selection.done()
				navigate(`${BASE_ROUTE_PATH}/albums/${album.id}`)
			} else {
				selection.pickFor(album.id)
			}
		} catch {
			toast.error(t('photos-album.create-failed'), {area: 'photos'})
		} finally {
			setBusy(false)
		}
	}

	return (
		<Dialog open={dialogProps.open} onOpenChange={onOpenChange}>
			<DialogContent>
				<form onSubmit={submit} className='flex flex-col gap-5'>
					<DialogHeader>
						<DialogTitle>{t('photos-album.create-title')}</DialogTitle>
						<DialogDescription>
							{withSelection ? t('photos-album.create-description-selected') : t('photos-album.create-description')}
						</DialogDescription>
					</DialogHeader>
					<Input
						value={name}
						onValueChange={setName}
						placeholder={t('photos-album.name-placeholder')}
						aria-label={t('photos-album.name-placeholder')}
						autoFocus
						maxLength={100}
					/>
					<DialogFooter>
						<Button type='submit' variant='primary' size='dialog' disabled={!trimmed || busy}>
							{busy && <TbLoader className='size-4 animate-spin' />}
							{withSelection ? t('photos-album.create') : t('photos-album.select-items')}
						</Button>
						<Button type='button' size='dialog' onClick={() => onOpenChange(false)}>
							{t('cancel')}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
