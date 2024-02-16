import {useAvailableApps} from '@/providers/available-apps'
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
	registryId,
	onConfirm,
}: {
	appId: string
	registryId?: string
	open: boolean
	onOpenChange: (open: boolean) => void
	onConfirm: () => void
}) {
	const {appsKeyed, isLoading} = useAvailableApps(registryId)
	const app = appsKeyed?.[appId]

	if (isLoading) return null
	if (!app) throw new Error(t('app-not-found', {app: appId}))

	const appName = app?.name

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
