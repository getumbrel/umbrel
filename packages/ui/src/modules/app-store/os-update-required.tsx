import {t} from 'i18next'
import {RiArrowUpLine} from 'react-icons/ri'
import {useNavigate} from 'react-router-dom'

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
import {RegistryApp} from '@/trpc/trpc'

export function OSUpdateRequiredDialog({
	app,
	open,
	onOpenChange,
}: {
	app: RegistryApp
	open: boolean
	onOpenChange: (open: boolean) => void
}) {
	const navigate = useNavigate()
	const version = app.manifestVersion.replace(/\.0$/, '')

	const handleConfirm = () => {
		onOpenChange(false)
		navigate('/settings/software-update')
	}

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader icon={RiArrowUpLine}>
					<AlertDialogTitle>{t('app.os-update-required.title')}</AlertDialogTitle>
					<AlertDialogDescription>
						{t('app.os-update-required.description', {appName: app.name, version})}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction variant='primary' className='px-6' onClick={handleConfirm}>
						{t('app.os-update-required.confirm')}
					</AlertDialogAction>
					<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
