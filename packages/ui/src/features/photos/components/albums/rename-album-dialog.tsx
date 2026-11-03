import {useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {TbLoader} from 'react-icons/tb'

import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {Input} from '@/components/ui/input'
import {toast} from '@/components/ui/toast'
import {useAlbumActions, useAlbums} from '@/features/photos/hooks/use-library'
import {useQueryParams} from '@/hooks/use-query-params'
import {useDialogOpenProps} from '@/utils/dialog'

// Renames an album. Opened via ?dialog=photos-rename-album with the album in
// ?photos-rename-album-id, from an album card's context menu.
export function RenameAlbumDialog() {
	const {t} = useTranslation()
	const dialogProps = useDialogOpenProps('photos-rename-album')
	const {params} = useQueryParams()
	const id = params.get('photos-rename-album-id')
	const {data: albums} = useAlbums()
	const album = albums?.find((album) => album.id === id)
	const {renameAlbum} = useAlbumActions()
	const [name, setName] = useState('')
	const [busy, setBusy] = useState(false)
	// Until the field is touched it tracks the album's current name — which on
	// a deep link can arrive after the dialog is already open
	const touched = useRef(false)
	const trimmed = name.trim()

	useEffect(() => {
		touched.current = false
	}, [dialogProps.open, id])
	useEffect(() => {
		if (dialogProps.open && !touched.current) setName(album?.name ?? '')
	}, [dialogProps.open, id, album?.name])

	const submit = async (event: React.FormEvent) => {
		event.preventDefault()
		if (!id || !trimmed || busy) return
		setBusy(true)
		try {
			await renameAlbum({id, name: trimmed})
			dialogProps.onOpenChange(false)
		} catch {
			toast.error(t('photos-album.rename-failed'), {area: 'photos'})
		} finally {
			setBusy(false)
		}
	}

	return (
		<Dialog open={dialogProps.open} onOpenChange={dialogProps.onOpenChange}>
			<DialogContent>
				<form onSubmit={submit} className='flex flex-col gap-5'>
					<DialogHeader>
						<DialogTitle>{t('photos-album.rename')}</DialogTitle>
						<DialogDescription>{t('photos-album.rename-description')}</DialogDescription>
					</DialogHeader>
					<Input
						value={name}
						onValueChange={(value) => {
							touched.current = true
							setName(value)
						}}
						placeholder={t('photos-album.name-placeholder')}
						aria-label={t('photos-album.name-placeholder')}
						autoFocus
						maxLength={100}
					/>
					<DialogFooter>
						<Button
							type='submit'
							variant='primary'
							size='dialog'
							disabled={!trimmed || busy || trimmed === album?.name}
						>
							{busy && <TbLoader className='size-4 animate-spin' />}
							{t('photos-album.rename-save')}
						</Button>
						<Button type='button' size='dialog' onClick={() => dialogProps.onOpenChange(false)}>
							{t('cancel')}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
