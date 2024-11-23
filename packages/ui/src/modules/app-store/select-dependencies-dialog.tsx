import {Close} from '@radix-ui/react-dialog'
import {SetStateAction, useEffect, useState} from 'react'
import {arrayIncludes} from 'ts-extras'

import {ChevronDown} from '@/assets/chevron-down'
import {AppIcon} from '@/components/app-icon'
import {appStateToString} from '@/components/cmdk'
import {ButtonLink} from '@/components/ui/button-link'
import {useApps} from '@/providers/apps'
import {useAllAvailableApps} from '@/providers/available-apps'
import {Button} from '@/shadcn-components/ui/button'
import {Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle} from '@/shadcn-components/ui/dialog'
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from '@/shadcn-components/ui/dropdown-menu'
import {ScrollArea} from '@/shadcn-components/ui/scroll-area'
import {cn} from '@/shadcn-lib/utils'
import {AppState, installedStates, RegistryApp} from '@/trpc/trpc'
import {t} from '@/utils/i18n'
import {tw} from '@/utils/tw'

export function SelectDependenciesDialog({
	open,
	onOpenChange,
	appId,
	dependencies,
	onNext,
	highlightDependency,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	appId: string
	dependencies: {dependencyId: string; appId: string}[][]
	onNext: (selectedDeps: Record<string, string>) => void
	highlightDependency?: string
}) {
	const availableApps = useAllAvailableApps()
	const {isLoading, userApps, userAppsKeyed} = useApps()
	const [selectedDependencies, setSelectedDependencies] = useState<Record<string, string>>({})

	// Try user app first in case the app was installed at some point but is not
	// present in an app store anymore, for example because a community app store
	// has been removed. UserApp and RegistryApp share the necessary properties.
	const registryApp = availableApps.appsKeyed?.[appId]
	const userApp = userAppsKeyed?.[appId]
	const app = userApp ?? registryApp
	if (!app) throw new Error('App not found')

	if (isLoading || !userApps || !userAppsKeyed || availableApps.isLoading) return null

	const appName = app?.name

	const areAllDependenciesInstalled = dependencies.every((alternatives) =>
		alternatives.some((alternative) =>
			Object.values(userAppsKeyed).some(
				(installedApp) =>
					installedApp.id === selectedDependencies[alternative.dependencyId] &&
					arrayIncludes(installedStates, installedApp.state),
			),
		),
	)

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				onOpenAutoFocus={(e) => {
					// `preventDefault` to prevent focus on first input
					e.preventDefault()
				}}
			>
				<DialogHeader>
					<DialogTitle>{t('install-first.title', {app: appName})}</DialogTitle>
				</DialogHeader>
				<SelectDependencies
					dependencies={dependencies}
					selectedDependencies={selectedDependencies}
					setSelectedDependencies={setSelectedDependencies}
					onInstallClick={() => onOpenChange(false)}
					highlightDependency={highlightDependency}
				/>
				<DialogFooter>
					<DialogFooter>
						<Close asChild>
							<Button
								variant='primary'
								size='dialog'
								disabled={!areAllDependenciesInstalled}
								onClick={() => onNext(selectedDependencies)}
							>
								{t('install-first.install-app', {app: appName})}
							</Button>
						</Close>
						<Close asChild>
							<Button size='dialog'>{t('cancel')}</Button>
						</Close>
					</DialogFooter>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

// Reusable dependencies selection
export function SelectDependencies({
	dependencies,
	selectedDependencies,
	setSelectedDependencies,
	onInstallClick,
	highlightDependency,
}: {
	dependencies: {dependencyId: string; appId: string}[][]
	selectedDependencies: Record<string, string>
	setSelectedDependencies: (selectedDependencies: Record<string, string>) => void
	onInstallClick: () => void
	highlightDependency?: string
}) {
	const {apps, appsKeyed} = useAllAvailableApps()
	const {isLoading, userApps, userAppsKeyed} = useApps()
	const [openDropdowns, setOpenDropdowns] = useState<Record<string, boolean>>({})

	if (isLoading || !userApps || !userAppsKeyed || !apps || !appsKeyed) return null

	const reifiedDependencies = dependencies.map((alternatives) =>
		alternatives.map(({dependencyId, appId}) => ({
			dependencyId,
			app: appsKeyed[appId],
		})),
	)

	// Pre-select installed apps or main alternatives
	useEffect(() => {
		const newSelectedDependencies: Record<string, string> = {
			...selectedDependencies,
		}
		reifiedDependencies.forEach((alternatives) => {
			const dependencyId = alternatives[0].dependencyId
			if (newSelectedDependencies[dependencyId]) return
			const installedOrInstallingApp = alternatives.find(({app}) => {
				const userApp = userAppsKeyed?.[app.id]
				return userApp && (arrayIncludes(installedStates, userApp.state) || userApp.state === 'installing')
			})
			newSelectedDependencies[dependencyId] = installedOrInstallingApp
				? installedOrInstallingApp.app.id
				: alternatives[0].app.id
		})
		setSelectedDependencies(newSelectedDependencies)
	}, [dependencies])

	const selectDependency = (dependencyId: string, appId: string) => {
		const newSelectedDependencies = {
			...selectedDependencies,
			[dependencyId]: appId,
		}
		setSelectedDependencies(newSelectedDependencies)
	}

	return (
		<div className={listClass}>
			{reifiedDependencies.map((alternatives) => {
				const {dependencyId, app} = alternatives[0]
				const hasAlternatives = alternatives.length > 1

				if (!hasAlternatives) {
					// If no alternatives, just show the app name and state
					return (
						<div key={dependencyId} className={listItemClass}>
							<span className='flex flex-1 flex-row items-center gap-2 pl-4'>
								{app.icon && <AppIcon size={26} src={app.icon} className='rounded-6' />}
								{app.name}
							</span>
							<DependencyStateText
								appId={app.id}
								appState={userAppsKeyed?.[app.id]?.state ?? 'not-installed'}
								onClick={onInstallClick}
							/>
						</div>
					)
				}

				// If has alternatives, show dropdown
				return (
					<div key={dependencyId} className={listItemClassWithDropdown}>
						<DependencyDropdown
							dependencyId={dependencyId}
							selectedApp={appsKeyed[selectedDependencies[dependencyId]]}
							alternatives={alternatives}
							openDropdowns={openDropdowns}
							setOpenDropdowns={setOpenDropdowns}
							onSelectDependency={selectDependency}
							highlightDependency={highlightDependency}
						/>
						<DependencyStateText
							appId={selectedDependencies[dependencyId]}
							appState={userAppsKeyed?.[selectedDependencies[dependencyId]]?.state ?? 'not-installed'}
							onClick={onInstallClick}
						/>
					</div>
				)
			})}
		</div>
	)
}

const listClass = tw`divide-y divide-white/6 overflow-hidden rounded-12 bg-white/6`
const listItemClass = tw`flex items-center pl-3 pr-4 h-[50px] text-[14px] font-medium -tracking-3 justify-between`
const listItemClassWithDropdown = tw`flex items-center pl-3 pr-4 h-[60px] text-[14px] font-medium -tracking-3 justify-between`

function DependencyStateText({appId, appState, onClick}: {appId: string; appState: AppState; onClick?: () => void}) {
	const buttonClass = 'w-[70px]' // Fixed width for both buttons

	if (arrayIncludes(installedStates, appState)) {
		return (
			<Button disabled={true} variant='default' size='sm' className={`opacity-50 ${buttonClass}`}>
				{t('app.installed')}
			</Button>
		)
	}

	if (appState === 'not-installed') {
		return (
			// TODO: link to community app store if needed using `getAppStoreAppFromInstalledApp`
			<ButtonLink to={`/app-store/${appId}`} onClick={onClick} variant='primary' size='sm' className={buttonClass}>
				{t('app.install')}
			</ButtonLink>
		)
	}

	return <span className='text-sm opacity-50'>{appStateToString(appState) + '...'}</span>
}

function DependencyDropdown({
	dependencyId,
	selectedApp,
	alternatives,
	openDropdowns,
	setOpenDropdowns,
	onSelectDependency,
	highlightDependency,
}: {
	dependencyId: string
	selectedApp?: RegistryApp
	alternatives: {dependencyId: string; app: RegistryApp}[]
	openDropdowns: Record<string, boolean>
	setOpenDropdowns: (value: SetStateAction<Record<string, boolean>>) => void
	onSelectDependency: (dependencyId: string, appId: string) => void
	highlightDependency?: string
}) {
	const onOpenChange = (open: boolean) => setOpenDropdowns((prev) => ({...prev, [dependencyId]: open}))
	return (
		<DropdownMenu open={openDropdowns[dependencyId] ?? false} onOpenChange={onOpenChange}>
			<DropdownMenuTrigger asChild className={cn(highlightDependency === dependencyId && 'umbrel-pulse-a-few-times')}>
				<Button className='h-[40px] w-[256px] max-w-[calc(100%-90px)] px-4'>
					<div className='flex min-w-0 flex-1 items-center gap-2 text-left'>
						{selectedApp ? (
							<>
								{selectedApp.icon && <AppIcon size={26} src={selectedApp.icon} className='shrink-0 rounded-6' />}
								<div className='min-w-0 flex-1'>
									<span className='block truncate text-[14px]'>{selectedApp.name}</span>
								</div>
							</>
						) : (
							<div className='min-w-0 flex-1'>
								<span className='block truncate text-[14px]'>{t('app-picker.select-app')}</span>
							</div>
						)}
					</div>
					<ChevronDown />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className='flex max-h-72 w-[256px] flex-col gap-3' align='start'>
				<ScrollArea className='relative -mx-2.5 flex h-full flex-col px-2.5'>
					{alternatives.map(({app}) => (
						<DropdownMenuCheckboxItem
							key={app.id}
							checked={app.id === selectedApp?.id}
							onSelect={() => {
								onSelectDependency(dependencyId, app.id)
								onOpenChange(false)
							}}
							className='flex gap-2'
						>
							<AppIcon size={20} src={app.icon} className='rounded-4' />
							{app.name}
						</DropdownMenuCheckboxItem>
					))}
				</ScrollArea>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}
