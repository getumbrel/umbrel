import {useCommandState} from 'cmdk'
import {ComponentPropsWithoutRef, createContext, SetStateAction, useContext, useRef, useState} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {useNavigate} from 'react-router-dom'
import {useKey} from 'react-use'
import {range} from 'remeda'

// Pluggable search providers rendered inside the command palette
// Currently only /features/files uses this
import {cmdkSearchProviders} from '@/components/cmdk-providers'
import {ErrorBoundaryCardFallback} from '@/components/ui/error-boundary-card-fallback'
import {LOADING_DASH} from '@/constants'
import {
	APPS_PATH as FILES_APPS_PATH,
	RECENTS_PATH as FILES_RECENTS_PATH,
	TRASH_PATH as FILES_TRASH_PATH,
} from '@/features/files/constants'
import {useDebugInstallRandomApps} from '@/hooks/use-debug-install-random-apps'
import {useIsMobile} from '@/hooks/use-is-mobile'
import {useLaunchApp} from '@/hooks/use-launch-app'
import {useQueryParams} from '@/hooks/use-query-params'
import {systemAppsKeyed, useApps} from '@/providers/apps'
import {useAvailableApps} from '@/providers/available-apps'
import {CommandDialog, CommandEmpty, CommandInput, CommandItem, CommandList} from '@/shadcn-components/ui/command'
import {Separator} from '@/shadcn-components/ui/separator'
import {cn} from '@/shadcn-lib/utils'
import {AppState, trpcReact} from '@/trpc/trpc'
import {t} from '@/utils/i18n'

import {AppIcon} from './app-icon'
import {FadeScroller} from './fade-scroller'
import {DebugOnlyBare} from './ui/debug-only'

const CmdkOpenContext = createContext<{
	open: boolean
	setOpen: (value: SetStateAction<boolean>) => void
} | null>(null)

export function useCmdkOpen() {
	const ctx = useContext(CmdkOpenContext)

	if (!ctx) throw new Error('useCmdkOpen must be used within a CommandRoot')

	useKey(
		(e) => e.key === 'k' && (e.metaKey || e.ctrlKey),
		(e) => {
			// Prevent default behavior (in Windows Chrome where it opens the search bar)
			e.preventDefault()
			ctx.setOpen((open) => !open)
		},
	)

	return ctx
}

export function CmdkProvider({children}: {children: React.ReactNode}) {
	const [open, setOpen] = useState(false)

	return <CmdkOpenContext.Provider value={{open, setOpen}}>{children}</CmdkOpenContext.Provider>
}

export function CmdkMenu() {
	const {open, setOpen} = useCmdkOpen()

	return (
		<CommandDialog open={open} onOpenChange={setOpen}>
			<CommandInput placeholder={t('cmdk.input-placeholder')} />
			<Separator />
			<ErrorBoundary FallbackComponent={ErrorBoundaryCardFallback}>
				<CmdkContent />
			</ErrorBoundary>
		</CommandDialog>
	)
}

function CmdkContent() {
	const {setOpen} = useCmdkOpen()
	const navigate = useNavigate()
	const {addLinkSearchParams} = useQueryParams()
	const userApps = useApps()
	const scrollRef = useRef<HTMLDivElement>(null)

	// The current search query from the command input. We pass this down to all
	// external search providers so they can surface their own results.
	const searchQuery = useCommandState((state) => state.search)
	const userQ = trpcReact.user.get.useQuery()
	const launchApp = useLaunchApp()
	const debugInstallRandomApps = useDebugInstallRandomApps()
	// We only show installed community apps here, effectively limiting available
	// apps to those present in the official app store
	const availableApps = useAvailableApps()

	const isLoading = userQ.isLoading || availableApps.isLoading || userApps.isLoading

	if (availableApps.isLoading) return null
	if (isLoading) return null
	if (userQ.isLoading) return null
	if (!userApps.userApps || !userApps.userAppsKeyed) return null

	const readyApps = userApps.userApps.filter((app) => app.state === 'ready')
	const unreadyApps = userApps.userApps.filter((app) => app.state !== 'ready')
	// Apps not installed yet
	const installableApps = availableApps.apps.filter((app) => !userApps.userAppsKeyed?.[app.id])

	return (
		<CommandList ref={scrollRef}>
			<FrequentApps onLaunchApp={() => setOpen(false)} />
			<CommandEmpty>{t('no-results-found')}</CommandEmpty>
			<CommandItem
				icon={systemAppsKeyed['UMBREL_settings'].icon}
				onSelect={() => {
					navigate({pathname: '/settings', search: addLinkSearchParams({dialog: 'restart'})})
					setOpen(false)
				}}
			>
				{t('cmdk.restart-umbrel')}
			</CommandItem>
			<CommandItem
				icon={systemAppsKeyed['UMBREL_app-store'].icon}
				onSelect={() => {
					navigate('/app-store?dialog=updates')
					setOpen(false)
				}}
			>
				{t('cmdk.update-all-apps')}
			</CommandItem>
			<CommandItem
				icon={systemAppsKeyed['UMBREL_settings'].icon}
				onSelect={() => {
					navigate('/settings/wallpaper')
					setOpen(false)
				}}
			>
				{t('cmdk.change-wallpaper')}
			</CommandItem>
			<CommandItem
				icon={systemAppsKeyed['UMBREL_live-usage'].icon}
				onSelect={() => {
					navigate(systemAppsKeyed['UMBREL_live-usage'].systemAppTo)
					setOpen(false)
				}}
			>
				{t('cmdk.live-usage')}
			</CommandItem>
			<CommandItem
				icon={systemAppsKeyed['UMBREL_widgets'].icon}
				onSelect={() => {
					navigate('/edit-widgets')
					setOpen(false)
				}}
			>
				{t('cmdk.widgets')}
			</CommandItem>
			<SearchItem
				icon={systemAppsKeyed['UMBREL_home'].icon}
				value={systemAppsKeyed['UMBREL_home'].name}
				onSelect={() => {
					navigate(systemAppsKeyed['UMBREL_home'].systemAppTo)
					setOpen(false)
				}}
			>
				{systemAppsKeyed['UMBREL_home'].name}
			</SearchItem>
			<SearchItem
				icon={systemAppsKeyed['UMBREL_app-store'].icon}
				value={systemAppsKeyed['UMBREL_app-store'].name}
				onSelect={() => {
					navigate(systemAppsKeyed['UMBREL_app-store'].systemAppTo)
					setOpen(false)
				}}
			>
				{systemAppsKeyed['UMBREL_app-store'].name}
			</SearchItem>
			<SearchItem
				icon={systemAppsKeyed['UMBREL_files'].icon}
				value={systemAppsKeyed['UMBREL_files'].name}
				onSelect={() => {
					// TODO: THIS IS A HACK
					// We need a better approach to track the last visited path (possibly scroll position too?)
					// inside every page. We do this right now for the File app because it's has the most
					// UX-advantage (eg. user accidentally clicking close while they're in a deeply nested path)
					const lastFilesPath = sessionStorage.getItem('lastFilesPath')

					navigate(lastFilesPath || systemAppsKeyed['UMBREL_files'].systemAppTo)
					setOpen(false)
				}}
			>
				{systemAppsKeyed['UMBREL_files'].name}
			</SearchItem>
			<SearchItem
				icon={systemAppsKeyed['UMBREL_files'].icon}
				value={t('files-sidebar.recents')}
				onSelect={() => {
					navigate(`/files${FILES_RECENTS_PATH}`)
					setOpen(false)
				}}
			>
				{t('files-sidebar.recents')}
			</SearchItem>
			<SearchItem
				icon={systemAppsKeyed['UMBREL_files'].icon}
				value={t('files-sidebar.apps')}
				onSelect={() => {
					navigate(`/files${FILES_APPS_PATH}`)
					setOpen(false)
				}}
			>
				{t('files-sidebar.apps')}
			</SearchItem>
			<SearchItem
				icon={systemAppsKeyed['UMBREL_files'].icon}
				value={t('files-sidebar.trash')}
				onSelect={() => {
					navigate(`/files${FILES_TRASH_PATH}`)
					setOpen(false)
				}}
			>
				{t('files-sidebar.trash')}
			</SearchItem>
			<SettingsSearchItem
				value={systemAppsKeyed['UMBREL_settings'].name}
				onSelect={() => navigate(systemAppsKeyed['UMBREL_settings'].systemAppTo)}
			/>
			<SettingsSearchItem
				value={t('logout')}
				onSelect={() => navigate({search: addLinkSearchParams({dialog: 'logout'})})}
			/>
			<SettingsSearchItem
				value={t('cmdk.shutdown-umbrel')}
				onSelect={() => navigate({pathname: 'settings', search: addLinkSearchParams({dialog: 'shutdown'})})}
			/>
			{/* ---- */}
			{/* List rows */}
			<SettingsSearchItem value={t('change-name')} onSelect={() => navigate('settings/account/change-name')} />
			<SettingsSearchItem value={t('change-password')} onSelect={() => navigate('settings/account/change-password')} />
			<SettingsSearchItem value={'wifi'} onSelect={() => navigate('/settings/wifi')}>
				{t('wifi')}
			</SettingsSearchItem>
			<SettingsSearchItem value={'2fa'} onSelect={() => navigate('/settings/2fa')}>
				{t('2fa')}
			</SettingsSearchItem>
			<SettingsSearchItem value={t('remote-tor-access')} onSelect={() => navigate('/settings/advanced/tor')} />
			<SettingsSearchItem value={t('migration-assistant')} onSelect={() => navigate('/settings/migration-assistant')} />
			<SettingsSearchItem value={t('language')} onSelect={() => navigate('/settings/language')} />
			<SettingsSearchItem value={t('troubleshoot')} onSelect={() => navigate('/settings/troubleshoot')} />
			<SettingsSearchItem value={t('terminal')} onSelect={() => navigate('/settings/terminal')} />
			<SettingsSearchItem value={t('device-info')} onSelect={() => navigate('/settings/device-info')} />
			<SettingsSearchItem value={t('software-update.title')} onSelect={() => navigate('/settings/software-update')} />
			<SettingsSearchItem value={t('factory-reset')} onSelect={() => navigate('/factory-reset')} />
			<SettingsSearchItem value={t('advanced-settings')} onSelect={() => navigate('/settings/advanced')} />
			<SettingsSearchItem value={t('beta-program')} onSelect={() => navigate('/settings/advanced/beta-program')} />
			<SettingsSearchItem value={t('external-dns')} onSelect={() => navigate('/settings/advanced/external-dns')} />
			{readyApps.map((app) => (
				<SearchItem
					value={app.name}
					icon={app.icon}
					key={app.id}
					onSelect={() => {
						launchApp(app.id)
						setOpen(false)
					}}
				>
					{app.name}
				</SearchItem>
			))}
			{unreadyApps.map((app) => (
				<SearchItem
					disabled
					value={app.name}
					icon={app.icon}
					key={app.id}
					onSelect={() => {
						navigate(`/app-store/${app.id}`)
						setOpen(false)
					}}
				>
					<span>
						{app.name} <span className='opacity-50'> – {appStateToString(app.state)}</span>
					</span>
				</SearchItem>
			))}
			{installableApps.map((app) => (
				<SearchItem
					value={app.name}
					icon={app.icon}
					key={app.id}
					onSelect={() => {
						navigate(`/app-store/${app.id}`)
						setOpen(false)
					}}
				>
					<span>
						{app.name} <span className='opacity-50'>{t('generic-in')} App Store</span>
					</span>
				</SearchItem>
			))}

			{/* Pluggable search providers */}
			{cmdkSearchProviders.map((Provider, idx) => (
				<Provider key={idx} query={searchQuery} close={() => setOpen(false)} />
			))}
			<DebugOnlyBare>
				<SearchItem value='Install a bunch of random apps' onSelect={debugInstallRandomApps}>
					Install a bunch of random apps
				</SearchItem>
				<SearchItem value='Stories' onSelect={() => navigate('/stories')}>
					Stories
				</SearchItem>
			</DebugOnlyBare>
		</CommandList>
	)
}

function FrequentApps({onLaunchApp}: {onLaunchApp: () => void}) {
	const lastAppsQ = trpcReact.apps.recentlyOpened.useQuery(undefined, {
		retry: false,
	})
	const lastApps = lastAppsQ.data ?? []
	const {userAppsKeyed} = useApps()

	const search = useCommandState((state) => state.search)

	// If there's a search query, don't show frequent apps
	if (search) return null
	if (!userAppsKeyed) return null
	if (!lastApps) return null
	if (lastApps.length === 0) return null

	return (
		<div className='mb-3 flex flex-col gap-3 md:mb-5 md:gap-5'>
			<div>
				<h3 className='mb-5 ml-2 hidden text-15 font-semibold leading-tight -tracking-2 md:block'>
					{t('cmdk.frequent-apps')}
				</h3>
				<FadeScroller direction='x' className='umbrel-hide-scrollbar w-full overflow-x-auto whitespace-nowrap'>
					{/* Show skeleton by default to prevent layout shift */}
					{lastAppsQ.isLoading &&
						range(0, 3).map((i) => <FrequentApp key={i} appId={''} icon='' name={LOADING_DASH} />)}
					{appsByFrequency(lastApps, 6).map((appId) => (
						<FrequentApp
							key={appId}
							appId={appId}
							icon={userAppsKeyed[appId]?.icon}
							name={userAppsKeyed[appId]?.name}
							onLaunch={onLaunchApp}
						/>
					))}
				</FadeScroller>
			</div>

			<Separator />
		</div>
	)
}

function appsByFrequency(lastOpenedApps: string[], count: number) {
	const openCounts = new Map<string, number>()

	lastOpenedApps.map((appId) => {
		if (!openCounts.has(appId)) {
			openCounts.set(appId, 1)
		} else {
			openCounts.set(appId, openCounts.get(appId)! + 1)
		}
	})

	const sortedAppIds = [...openCounts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, count)
		.map((a) => a[0])

	return sortedAppIds
}

function FrequentApp({
	appId,
	icon,
	name,
	onLaunch,
}: {
	appId: string
	icon: string
	name: string
	onLaunch?: () => void
}) {
	const launchApp = useLaunchApp()
	const isMobile = useIsMobile()
	return (
		<button
			className='inline-flex w-[75px] flex-col items-center gap-2 overflow-hidden rounded-8 border border-transparent p-1.5 outline-none transition-all hover:border-white/10 hover:bg-white/4 focus-visible:border-white/10 focus-visible:bg-white/4 active:border-white/20 md:w-[100px] md:p-2'
			onClick={() => {
				onLaunch?.()
				launchApp(appId)
			}}
			onKeyDown={(e) => {
				if (e.key === 'Enter') {
					// Prevent triggering first selected cmdk item
					e.preventDefault()
					launchApp(appId)
				}
			}}
		>
			<AppIcon src={icon} size={isMobile ? 48 : 64} className='rounded-10 lg:rounded-15' />
			<div className='w-full truncate text-[10px] -tracking-2 text-white/75 md:text-13'>{name ?? appId}</div>
		</button>
	)
}

const SettingsSearchItem = ({
	onSelect,
	value,
	children,
}: {
	onSelect: () => void
	value: string
	children?: React.ReactNode
}) => {
	const {setOpen} = useCmdkOpen()
	return (
		<SearchItem
			value={value}
			icon={systemAppsKeyed['UMBREL_settings'].icon}
			onSelect={() => {
				onSelect()
				setOpen(false)
			}}
		>
			{children ?? value}
		</SearchItem>
	)
}

const SearchItem = (props: ComponentPropsWithoutRef<typeof CommandItem>) => {
	const search = useCommandState((state) => state.search)
	if (!search) return null

	return (
		<CommandItem
			{...props}
			className={cn(props.className, props.disabled && 'opacity-50')}
			onSelect={(value) => {
				props.onSelect?.(value)
			}}
		/>
	)
}

export function appStateToString(appState: AppState) {
	return {
		'not-installed': t('app.install'),
		installing: t('app.installing'),
		ready: t('app.open'),
		running: t('app.open'),
		starting: t('app.restarting'),
		restarting: t('app.starting'),
		stopping: t('app.stopping'),
		updating: t('app.updating'),
		uninstalling: t('app.uninstalling'),
		unknown: t('app.offline'),
		stopped: t('app.offline'),
		loading: t('loading'),
	}[appState]
}
