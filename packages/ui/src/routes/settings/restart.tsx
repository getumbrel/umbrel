import {useTranslation} from 'react-i18next'
import {RiRestartLine} from 'react-icons/ri'

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {useGlobalSystemState} from '@/providers/global-system-state/index'
import {useDialogOpenProps} from '@/utils/dialog'

export default function RestartDialog() {
	const {t} = useTranslation()
	const dialogProps = useDialogOpenProps('restart')

	const {restart, isPowerActionPending} = useGlobalSystemState()

	return (
		<AlertDialog {...dialogProps}>
			<AlertDialogContent>
				<AlertDialogHeader icon={RiRestartLine}>
					<AlertDialogTitle>{t('restart.confirm.title')}</AlertDialogTitle>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction
						variant='destructive'
						onClick={(e) => {
							// Prevent closing by default
							e.preventDefault()
							restart()
						}}
						disabled={isPowerActionPending}
					>
						{t('restart.confirm.submit')}
					</AlertDialogAction>
					<AlertDialogCancel disabled={isPowerActionPending}>{t('cancel')}</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
