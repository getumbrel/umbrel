import {RiFile2Fill} from 'react-icons/ri'

import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {useFilesStore} from '@/features/files/store/use-files-store'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/shadcn-components/ui/alert-dialog'
import {t} from '@/utils/i18n'

export default function DownloadDialog() {
	const viewerItem = useFilesStore((s) => s.viewerItem)
	const setViewerItem = useFilesStore((s) => s.setViewerItem)
	const {downloadSelectedItems} = useFilesOperations()

	if (!viewerItem) return null

	return (
		<AlertDialog open={!!viewerItem} onOpenChange={(open) => !open && setViewerItem(null)}>
			<AlertDialogContent>
				<AlertDialogHeader icon={RiFile2Fill}>
					<AlertDialogTitle>{t('files-download.title', {name: viewerItem.name})}</AlertDialogTitle>
					<AlertDialogDescription className='whitespace-normal break-words'>
						{t('files-download.description')}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction
						variant='primary'
						className='px-6'
						onClick={() => {
							downloadSelectedItems()
							setViewerItem(null)
						}}
					>
						{t('files-download.confirm')}
					</AlertDialogAction>
					<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
