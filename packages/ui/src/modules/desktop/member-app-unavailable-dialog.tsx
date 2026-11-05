import {useTranslation} from 'react-i18next'
import {FaRegCirclePause} from 'react-icons/fa6'
import {TbAlertTriangle} from 'react-icons/tb'

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'

// Shown when a member clicks a shared app that isn't running. Members can't
// start or fix apps, so instead of a failed action this explains the state and
// points at the person who can act on it.
export function MemberAppUnavailableDialog({
	appName,
	variant,
	open,
	onOpenChange,
}: {
	appName: string
	variant: 'stopped' | 'problem'
	open: boolean
	onOpenChange: (open: boolean) => void
}) {
	const {t} = useTranslation()

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader icon={variant === 'stopped' ? FaRegCirclePause : TbAlertTriangle}>
					<AlertDialogTitle>
						{variant === 'stopped'
							? t('desktop.app.member-unavailable.stopped-title', {app: appName})
							: t('desktop.app.member-unavailable.problem-title', {app: appName})}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{variant === 'stopped'
							? t('desktop.app.member-unavailable.stopped-description')
							: t('desktop.app.member-unavailable.problem-description')}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction variant='primary' onClick={() => onOpenChange(false)}>
						{t('ok')}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
