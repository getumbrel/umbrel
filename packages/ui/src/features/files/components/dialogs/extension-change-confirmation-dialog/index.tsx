import {AiOutlineFileExclamation} from 'react-icons/ai'

import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
import {splitFileName} from '@/features/files/utils/format-filesystem-name'
import {useQueryParams} from '@/hooks/use-query-params'
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
import {useDialogOpenProps} from '@/utils/dialog'
import {t} from '@/utils/i18n'

export default function ExtensionChangeConfirmationDialog() {
	const dialogProps = useDialogOpenProps('files-extension-change-confirmation')
	const {renameItem} = useFilesOperations()
	const {params} = useQueryParams()

	const currentName = params.get('currentName') || ''
	const currentPath = params.get('currentPath') || ''
	const renameTo = params.get('renameTo') || ''

	const {extension: currentExt} = splitFileName(currentName)
	const {extension: newExt} = splitFileName(renameTo)

	if (currentExt === newExt) {
		return null
	}

	const handleConfirm = () => {
		renameItem({item: {name: currentName, path: currentPath, ops: 0}, toName: renameTo})
		dialogProps.onOpenChange(false)
	}

	return (
		<AlertDialog {...dialogProps}>
			<AlertDialogContent>
				<AlertDialogHeader icon={AiOutlineFileExclamation}>
					<AlertDialogTitle>
						{newExt
							? t('files-extension-change.title-add', {extension: newExt})
							: t('files-extension-change.title-remove')}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{newExt
							? t('files-extension-change.description-add', {fileName: currentName, extension: newExt})
							: t('files-extension-change.description-remove', {fileName: currentName})}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction variant='destructive' className='px-6' onClick={handleConfirm}>
						{t('files-extension-change.confirm')}
					</AlertDialogAction>
					<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
