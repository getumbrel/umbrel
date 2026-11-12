import {useTranslation} from 'react-i18next'
import {RiShutDownLine} from 'react-icons/ri'

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

export default function ShutdownDialog() {
	const {t} = useTranslation()
	const dialogProps = useDialogOpenProps('shutdown')

	const {shutdown, isPowerActionPending} = useGlobalSystemState()

	return (
		<AlertDialog {...dialogProps}>
			<AlertDialogContent>
				<AlertDialogHeader icon={RiShutDownLine}>
					<AlertDialogTitle>{t('shut-down.confirm.title')}</AlertDialogTitle>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction
						variant='destructive'
						onClick={(e) => {
							// Prevent closing by default
							e.preventDefault()
							shutdown()
						}}
						disabled={isPowerActionPending}
					>
						{t('shut-down.confirm.submit')}
					</AlertDialogAction>
					<AlertDialogCancel autoFocus disabled={isPowerActionPending}>
						{t('cancel')}
					</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
