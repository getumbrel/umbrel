import {Close, DialogDescription} from '@radix-ui/react-dialog'
import {useMemo, useState} from 'react'
import {arrayIncludes} from 'ts-extras'

import {AppIcon} from '@/components/app-icon'
import {appStateToString} from '@/components/cmdk'
import {useQueryParams} from '@/hooks/use-query-params'
import {useApps, useUserApp} from '@/providers/apps'
import {useAllAvailableApps} from '@/providers/available-apps'
import {Button} from '@/shadcn-components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogPortal,
	DialogTitle,
} from '@/shadcn-components/ui/dialog'
import {installedStates, progressStates, RegistryApp, trpcReact, UserApp} from '@/trpc/trpc'
import {useDialogOpenProps} from '@/utils/dialog'
import {t} from '@/utils/i18n'

import {SelectDependencies} from '../select-dependencies-dialog'

export function AppSettingsDialog() {
	const {params} = useQueryParams()
	const appId = params.get('app-settings-for')
	const dependencyId = params.get('app-settings-dependency') ?? undefined

	const {isLoading, app} = useUserApp(appId)
	const {userApps, userAppsKeyed} = useApps()
	const {apps: availableApps} = useAllAvailableApps()

	if (isLoading || !app || !userApps || !userAppsKeyed || !availableApps) {
		return null
	}

	return (
		<AppSettingsDialogForApp
			app={app}
			userApps={userApps}
			userAppsKeyed={userAppsKeyed}
			availableApps={availableApps}
			openDependency={dependencyId}
		/>
	)
}

function areSelectionsEqual(a?: Record<string, string>, b?: Record<string, string>) {
	if (a === b) return true
	const keys1 = Object.keys((a ||= {}))
	const keys2 = Object.keys((b ||= {}))
	if (keys1.length !== keys2.length) return false
	for (const key of keys1) {
		if (b[key] !== a[key]) return false
	}
	return true
}

function AppSettingsDialogForApp({
	app,
	userApps,
	userAppsKeyed,
	availableApps,
	openDependency,
}: {
	app: UserApp
	userApps: UserApp[]
	userAppsKeyed: Record<string, UserApp>
	availableApps: RegistryApp[]
	openDependency?: string
}) {
	const dialogProps = useDialogOpenProps('app-settings')
	const [selectedDependencies, setSelectedDependencies] = useState(app.selectedDependencies)
	const [hadChanges, setHadChanges] = useState(false)
	const utils = trpcReact.useUtils()
	const setSelectedDependenciesMut = trpcReact.apps.setSelectedDependencies.useMutation({
		onSuccess() {
			// Invalidate this app's state
			utils.apps.state.invalidate({appId: app.id})
			// Invalidate list of apps on desktop
			utils.apps.list.invalidate()
		},
	})

	const getAppsImplementing = (dependencyId: string) =>
		availableApps
			// Filter out community apps that aren't installed
			.filter((registryApp) => {
				const isCommunityApp = registryApp.appStoreId !== 'umbrel-app-store'
				return !isCommunityApp || userAppsKeyed[registryApp.id]
			})
			// Prefer installed app over registry app
			.map((registryApp) => userAppsKeyed?.[registryApp.id] ?? registryApp)
			.filter((applicableApp) => applicableApp.implements?.includes(dependencyId))
			.map((implementingApp) => implementingApp.id)

	const dependencies = useMemo(
		() =>
			(app.dependencies ?? []).map((dependencyId) =>
				[dependencyId, ...getAppsImplementing(dependencyId)].map((appId) => ({
					dependencyId,
					appId,
				})),
			),
		[app.dependencies],
	)

	const areAllDependenciesInstalled = dependencies.every((alternatives) =>
		alternatives.some((alternative) =>
			userApps.some(
				(installedApp) =>
					installedApp.id === selectedDependencies[alternative.dependencyId] &&
					arrayIncludes(installedStates, installedApp.state),
			),
		),
	)

	function onSelectionChange(selectedDependencies: Record<string, string>) {
		setSelectedDependencies(selectedDependencies)
		if (!areSelectionsEqual(app.selectedDependencies, selectedDependencies)) {
			setHadChanges(true)
		}
	}

	function onSubmit() {
		if (areAllDependenciesInstalled) {
			setSelectedDependenciesMut.mutate({
				appId: app.id,
				dependencies: selectedDependencies,
			})
		}
	}

	const inProgress = arrayIncludes(progressStates, app.state)
	const hasChanges = !areSelectionsEqual(app.selectedDependencies, selectedDependencies)

	return (
		<Dialog {...dialogProps}>
			<DialogPortal>
				<DialogContent
					onOpenAutoFocus={(e) => {
						// `preventDefault` to prevent focus on first input
						e.preventDefault()
					}}
				>
					<DialogHeader>
						<DialogTitle className='flex items-center gap-2'>
							<AppIcon src={app.icon} size={24} className='rounded-6' />
							{t('app-settings.title')}
						</DialogTitle>
					</DialogHeader>
					<DialogDescription className='-mb-3 text-13 opacity-50'>
						{t('app-settings.connected-to', {appName: app.name})}
					</DialogDescription>
					{dependencies.length ? (
						<SelectDependencies
							dependencies={dependencies}
							selectedDependencies={selectedDependencies}
							setSelectedDependencies={onSelectionChange}
							onInstallClick={() => dialogProps.onOpenChange(false)}
							highlightDependency={openDependency}
						/>
					) : null}
					{hadChanges && (
						<DialogFooter>
							<Close asChild>
								<Button
									variant='primary'
									size='dialog'
									disabled={!areAllDependenciesInstalled || dependencies.length === 0 || inProgress || !hasChanges}
									onClick={() => onSubmit()}
								>
									{inProgress ? appStateToString(app.state) + '...' : t('app-settings.save-changes')}
								</Button>
							</Close>
							<Close asChild>
								<Button size='dialog'>{t('cancel')}</Button>
							</Close>
						</DialogFooter>
					)}
				</DialogContent>
			</DialogPortal>
		</Dialog>
	)
}
