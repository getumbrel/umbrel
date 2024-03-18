import {Close} from '@radix-ui/react-dialog'
import {TbCircleCheckFilled} from 'react-icons/tb'
import {Link} from 'react-router-dom'
import {arrayIncludes} from 'ts-extras'

import {appStateToString} from '@/components/cmdk'
import {AppWithName} from '@/modules/app-store/shared'
import {useApps} from '@/providers/apps'
import {useAllAvailableApps} from '@/providers/available-apps'
import {Button} from '@/shadcn-components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/shadcn-components/ui/dialog'
import {AppState, installedStates} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

import {UMBREL_APP_STORE_ID} from './constants'

export function InstallTheseFirstDialog({
	open,
	onOpenChange,
	appId,
	registryId = UMBREL_APP_STORE_ID,
	dependencies,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	appId: string
	registryId?: string
	dependencies: string[]
}) {
	const availableApps = useAllAvailableApps()
	const userApps = useApps()
	const app = availableApps.appsKeyed?.[appId]

	if (userApps.isLoading) return null
	if (availableApps.isLoading) return null
	if (!app) throw new Error('App not found')

	const appName = app?.name
	const allDepApps = dependencies.map((id) => availableApps.appsKeyed?.[id])

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t('install-first.title', {app: appName})}</DialogTitle>
				</DialogHeader>
				<div className='space-y-3'>
					{allDepApps.map((app) => (
						<AppWithName
							key={app.id}
							icon={app.icon}
							appName={app.name}
							childrenRight={
								<AppStateText
									appId={app.id}
									appState={userApps.userAppsKeyed?.[app.id]?.state ?? 'not-installed'}
									onClick={() => onOpenChange(false)}
								/>
							}
						/>
					))}
				</div>
				<DialogDescription>
					{t('install-first.description', {app: appName, count: allDepApps.length})}
				</DialogDescription>
				<DialogFooter>
					<Close asChild>
						<Button variant='primary' size='dialog'>
							{t('ok')}
						</Button>
					</Close>
				</DialogFooter>
				{/* <JSONTree data={{toInstallApps: allDepApps, deps}} /> */}
			</DialogContent>
		</Dialog>
	)
}

function AppStateText({appId, appState, onClick}: {appId: string; appState: AppState; onClick?: () => void}) {
	if (arrayIncludes(installedStates, appState)) {
		return <TbCircleCheckFilled className='h-[18px] w-[18px] text-success-light' />
	}

	switch (appState) {
		case 'not-installed':
			return (
				// TODO: link to community app store if needed using `getAppStoreAppFromInstalledApp`
				<Link to={`/app-store/${appId}`} className='font-medium text-brand-lighter' onClick={onClick}>
					{t('app.install')}
				</Link>
			)
		default:
			return <div className='opacity-50'>{appStateToString(appState) + '...'}</div>
	}
}
