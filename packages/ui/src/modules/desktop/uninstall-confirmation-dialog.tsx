import {useAvailableApps} from '@/hooks/use-available-apps'
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
	if (!app) throw new Error('App not found')

	const appName = app?.name

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Uninstall {appName}?</AlertDialogTitle>
					<AlertDialogDescription>
						All data associated with {appName} will be permanently deleted. This action cannot be undone.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogAction variant='destructive' onClick={onConfirm}>
						Uninstall
					</AlertDialogAction>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
