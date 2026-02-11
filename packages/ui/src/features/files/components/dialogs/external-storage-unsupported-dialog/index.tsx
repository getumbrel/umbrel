import {TbAlertTriangleFilled} from 'react-icons/tb'

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import externalStorageIcon from '@/features/files/assets/external-storage-icon.png'
import {useDialogOpenProps} from '@/utils/dialog'
import {t} from '@/utils/i18n'

export default function ExternalStorageUnsupportedDialog() {
	const dialogProps = useDialogOpenProps('files-external-storage-unsupported')

	return (
		<AlertDialog {...dialogProps}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{t('files-external-storage.unsupported.title')}</AlertDialogTitle>
				</AlertDialogHeader>
				<div className='mt-2 flex justify-center'>
					<div className='relative'>
						<img src={externalStorageIcon} alt={t('external-drive')} className='size-16' draggable={false} />
						<div className='absolute -top-2 -right-2'>
							<TbAlertTriangleFilled className='h-8 w-8 text-yellow-400' />
						</div>
					</div>
				</div>
				<AlertDialogDescription className='text-center'>
					{t('files-external-storage.unsupported.description')}
				</AlertDialogDescription>
				<AlertDialogFooter>
					<AlertDialogAction onClick={() => dialogProps.onOpenChange(false)}>{t('ok')}</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
