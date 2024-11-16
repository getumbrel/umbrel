import {useAllAvailableApps} from '@/providers/available-apps'
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
import {t} from '@/utils/i18n'

export function UninstallConfirmationDialog({
	open,
	onOpenChange,
	appId,
	onConfirm,
}: {
	appId: string
	open: boolean
	onOpenChange: (open: boolean) => void
	onConfirm: () => void
}) {
	const {appsKeyed, isLoading} = useAllAvailableApps()
	const app = appsKeyed?.[appId]

	if (isLoading) return null
	// The app may have been removed from the app store
	// so we just allow to continue uninstallation
	// TODO: refactor to check for the app against the
	// installed apps instead of apps in the app store
	if (!app) {
		console.error(`${appId} not found`)
	}

	const appName = app?.name || t('app')

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{t('app.uninstall.confirm.title', {app: appName})}</AlertDialogTitle>
					<AlertDialogDescription>{t('app.uninstall.confirm.description', {app: appName})}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction variant='destructive' onClick={onConfirm}>
						{t('app.uninstall.confirm.submit')}
					</AlertDialogAction>
					<AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
