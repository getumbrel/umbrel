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
import {t} from '@/utils/i18n'

type ShutdownConfirmationDialogProps = {
	open: boolean
	onOpenChange: (open: boolean) => void
}

export function ShutdownConfirmationDialog({open, onOpenChange}: ShutdownConfirmationDialogProps) {
	const {shutdown} = useGlobalSystemState()

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader icon={RiShutDownLine}>
					<AlertDialogTitle>{t('shut-down.confirm.title')}</AlertDialogTitle>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction
						variant='destructive'
						onClick={(e) => {
							e.preventDefault()
							shutdown()
						}}
					>
						{t('shut-down.confirm.submit')}
					</AlertDialogAction>
					<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
