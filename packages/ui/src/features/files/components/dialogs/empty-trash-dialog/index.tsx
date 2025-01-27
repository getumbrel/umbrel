import {FlameIcon} from '@/features/files/assets/flame-icon'
import {useFilesOperations} from '@/features/files/hooks/use-files-operations'
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

export default function EmptyTrashDialog() {
	const dialogProps = useDialogOpenProps('files-empty-trash-confirmation')
	const {emptyTrash} = useFilesOperations()
	return (
		<AlertDialog {...dialogProps}>
			<AlertDialogContent>
				<AlertDialogHeader icon={FlameIcon}>
					<AlertDialogTitle>{t('files-empty-trash.title')}</AlertDialogTitle>
					<AlertDialogDescription>{t('files-empty-trash.description')}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction
						variant='destructive'
						className='px-6'
						onClick={() => {
							emptyTrash()
							dialogProps.onOpenChange(false)
						}}
					>
						{t('files-empty-trash.confirm')}
					</AlertDialogAction>
					<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
