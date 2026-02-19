import {useEffect, useRef} from 'react'
import {RiFile2Fill} from 'react-icons/ri'

import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {useConfirmation} from '@/providers/confirmation'
import {t} from '@/utils/i18n'

export default function DownloadDialog() {
	const viewerItem = useFilesStore((s) => s.viewerItem)
	const setViewerItem = useFilesStore((s) => s.setViewerItem)
	const {downloadSelectedItems} = useFilesOperations()
	const confirm = useConfirmation()
	const hasShown = useRef(false)

	useEffect(() => {
		if (!viewerItem || hasShown.current) return
		hasShown.current = true

		const showConfirmation = async () => {
			try {
				await confirm({
					title: t('files-download.title', {name: viewerItem.name}),
					message: t('files-download.description'),
					actions: [
						{label: t('files-download.confirm'), value: 'confirm', variant: 'primary'},
						{label: t('cancel'), value: 'cancel', variant: 'default'},
					],
					icon: RiFile2Fill,
				})
				downloadSelectedItems()
			} catch {
				// User cancelled or dismissed
			} finally {
				setViewerItem(null)
			}
		}

		showConfirmation()
	}, [viewerItem, confirm, downloadSelectedItems, setViewerItem])

	return null
}
