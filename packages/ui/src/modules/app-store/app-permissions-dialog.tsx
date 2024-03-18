import {Close} from '@radix-ui/react-dialog'

import {AppWithName} from '@/modules/app-store/shared'
import {useApps} from '@/providers/apps'
import {useAllAvailableApps} from '@/providers/available-apps'
import {Button} from '@/shadcn-components/ui/button'
import {Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle} from '@/shadcn-components/ui/dialog'
import {t} from '@/utils/i18n'

export function AppPermissionsDialog({
	appId,
	open,
	onOpenChange,
	appsUsed,
	onNext,
}: {
	appId: string
	open: boolean
	onOpenChange: (open: boolean) => void
	registryId?: string
	appsUsed: string[]
	onNext: () => void
}) {
	const availableApps = useAllAvailableApps()
	const userApps = useApps()
	const app = availableApps.appsKeyed?.[appId]

	if (userApps.isLoading) return null
	if (availableApps.isLoading) return null
	if (!app) throw new Error('App not found')

	const appName = app?.name
	const appPermissions = appsUsed.map((id) => availableApps.appsKeyed?.[id])

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t('install-first.title', {app: appName})}</DialogTitle>
				</DialogHeader>
				<div className='space-y-3'>
					{appPermissions.map((app) => (
						<AppWithName key={app.id} icon={app.icon} appName={app.name} />
					))}
				</div>
				<DialogFooter>
					<Close asChild>
						<Button variant='primary' size='dialog' onClick={() => onNext()}>
							{t('continue')}
						</Button>
					</Close>
					<Close asChild>
						<Button size='dialog'>{t('cancel')}</Button>
					</Close>
				</DialogFooter>
				{/* <JSONTree data={{appPermissions, dependencies: appsUsed}} /> */}
			</DialogContent>
		</Dialog>
	)
}
