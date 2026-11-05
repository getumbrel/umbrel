import {useState} from 'react'
import {useTranslation} from 'react-i18next'

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {secondaryButtonClasss} from '@/layouts/bare/shared'

// Only shown after a sustained wait. Re-enter through the root's fresh status and
// account checks; never reload a setup route that registers automatically on mount.
// Navigation does not cancel, repeat, or declare the server operation failed.
export function ReturnToStart() {
	const {t} = useTranslation()
	const [open, setOpen] = useState(false)
	return (
		<>
			<button className={secondaryButtonClasss} onClick={() => setOpen(true)}>
				{t('onboarding.raid.return-to-start')}
			</button>
			<AlertDialog open={open} onOpenChange={setOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t('onboarding.raid.return-to-start')}</AlertDialogTitle>
						<AlertDialogDescription>{t('onboarding.raid.return-to-start-warning')}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogAction
							onClick={() => {
								window.location.href = '/'
							}}
						>
							{t('onboarding.raid.return-to-start')}
						</AlertDialogAction>
						<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	)
}
