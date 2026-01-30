import {RiShutDownLine} from 'react-icons/ri'

import {useGlobalSystemState} from '@/providers/global-system-state/index'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/shadcn-components/ui/alert-dialog'
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
						hideEnterIcon
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
