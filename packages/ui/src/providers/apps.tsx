import {createContext, useContext, useEffect} from 'react'
import {filter} from 'remeda'
import {arrayIncludes} from 'ts-extras'

import {pollStates} from '@/hooks/use-app-install'
import {RouterOutput, trpcReact, UserApp} from '@/trpc/trpc'
import {keyBy} from '@/utils/misc'

export type AppT = {
	id: string
	name: string
	icon: string
	systemApp?: boolean
	systemAppTo?: string
}

// `UMBREL_` prefix to make extra clear the distinction between system app IDs and user installable ids.
// In `umbreld`, system app widgets are prefixed with `umbrel:`.
export const systemApps = [
	{
		id: 'UMBREL_system',
		name: 'System',
		icon: '/assets/umbrel-app.svg',
		systemApp: true,
		systemAppTo: '/',
	},
	{
		id: 'UMBREL_app-store',
		name: 'App Store',
		icon: '/assets/dock/dock-app-store.webp',
		systemApp: true,
		systemAppTo: '/app-store',
	},
	{
		id: 'UMBREL_files',
		name: 'Files',
		icon: '/assets/dock/dock-files.webp',
		systemApp: true,
		systemAppTo: '/files',
	},
	{
		id: 'UMBREL_photos',
		name: 'Photos',
		icon: '/assets/dock/dock-photos.webp',
		systemApp: true,
		systemAppTo: '/photos',
	},
	{
		id: 'UMBREL_settings',
		name: 'Settings',
		icon: '/assets/dock/dock-settings.webp',
		systemApp: true,
		systemAppTo: '/settings',
	},
	{
		id: 'UMBREL_machines',
		name: 'Machines',
		icon: '/assets/dock/dock-machines.webp',
		systemApp: true,
		systemAppTo: '/machines',
	},
	{
		id: 'UMBREL_live-usage',
		name: 'Live Usage',
		icon: '/assets/dock/dock-live-usage.webp',
		systemApp: true,
		// NOTE: using this will clear existing search params
		// In practice, this means cmdk will clear params and clicking dock icon will not
		systemAppTo: '?dialog=live-usage',
	},
	{
		id: 'UMBREL_widgets',
		name: 'Widgets',
		icon: '/assets/dock/dock-widgets.png',
		systemApp: true,
		systemAppTo: '/edit-widgets',
	},
] as const satisfies readonly AppT[]

export const systemAppsKeyed = keyBy(systemApps, 'id')

type AppsContextT = {
	userApps?: UserApp[]
	userAppsKeyed?: Record<string, UserApp>
	// needs to be explicitly readonly so typescript doesn't complain, though all other props are technically readonly too
	systemApps: readonly AppT[]
	systemAppsKeyed: typeof systemAppsKeyed
	allApps: AppT[]
	allAppsKeyed: Record<string, AppT>
	isLoading: boolean
}
const AppsContext = createContext<AppsContextT | null>(null)

export function AppsProvider({children}: {children: React.ReactNode}) {
	const appsQ = trpcReact.apps.list.useQuery()
	const utils = trpcReact.useUtils()

	// Refetch apps when storage mounts so tiles recover on their own, e.g. an app
	// marked "Storage unavailable" clears once its NAS comes back and the backend
	// auto-restarts it, without waiting for a manual refresh. Storage events are
	// owner-only, members are rejected by the event bus.
	const userQ = trpcReact.user.get.useQuery()
	const invalidateApps = {
		enabled: userQ.data?.role === 'owner',
		onData: () => utils.apps.list.invalidate(),
		onError: (error: unknown) => console.error('eventBus.listen storage change subscription error', error),
	}
	trpcReact.eventBus.listen.useSubscription({event: 'files:external-storage:change'}, invalidateApps)
	trpcReact.eventBus.listen.useSubscription({event: 'files:network-storage:change'}, invalidateApps)
	trpcReact.eventBus.listen.useSubscription(
		{event: 'apps:settings:change'},
		{
			enabled: userQ.data?.role === 'owner',
			onData(data) {
				const {appId} = data as {appId: string}
				utils.apps.state.invalidate({appId})
				utils.apps.list.invalidate()
			},
			onError: (error) => console.error('eventBus.listen(apps:settings:change) subscription error', error),
		},
	)

	// Refresh the apps a member can see the moment the owner shares or unshares
	// an app with them (the server only streams changes affecting this account).
	// The owner's own UI already refreshes via its mutations' onSuccess.
	trpcReact.eventBus.listen.useSubscription(
		{event: 'apps:member-shares:change'},
		{
			enabled: userQ.data?.role === 'member',
			onData() {
				utils.apps.list.invalidate()
				utils.appStore.registry.invalidate()
			},
			onError(err) {
				console.error('eventBus.listen(apps:member-shares:change) subscription error', err)
			},
		},
	)

	// Refresh the owner's app queries on every server-side state transition so
	// installs, uninstalls and lifecycle changes made by other actors (e.g. MCP
	// agents) appear without a manual refresh. Once a transition is visible the
	// existing poll-states UI takes over. Owner-only event; members get the
	// scoped shares event above.
	trpcReact.eventBus.listen.useSubscription(
		{event: 'apps:state:change'},
		{
			enabled: userQ.data?.role === 'owner',
			onData() {
				utils.apps.state.invalidate()
				utils.apps.list.invalidate()
			},
			onError(err) {
				console.error('eventBus.listen(apps:state:change) subscription error', err)
			},
		},
	)

	// Push install/update progress straight into the per-app state cache so
	// progress bars move as soon as umbreld reports it. The transition poll
	// still runs alongside as a fallback in case an event is missed, but an
	// in-flight poll is older than the event so it mustn't land on top of it.
	trpcReact.eventBus.listen.useSubscription(
		{event: 'apps:progress'},
		{
			enabled: userQ.data?.role === 'owner',
			onData(data) {
				const {appId, ...status} = data as {appId: string} & RouterOutput['apps']['state']
				utils.apps.state.cancel({appId})
				utils.apps.state.setData({appId}, status)
			},
			onError(err) {
				console.error('eventBus.listen(apps:progress) subscription error', err)
			},
		},
	)

	// Remove apps that have an error
	// TODO: consider passing these down in some places (like the desktop)
	const userApps = filter(appsQ.data ?? [], (app): app is UserApp => !('error' in app))
	const userAppsKeyed = keyBy(userApps, 'id')

	const allApps = [...userApps, ...systemApps]
	const allAppsKeyed = keyBy(allApps, 'id')

	return (
		<AppsContext
			value={{
				userApps,
				userAppsKeyed,
				systemApps,
				systemAppsKeyed,
				allApps,
				allAppsKeyed,
				isLoading: appsQ.isLoading,
			}}
		>
			{children}
		</AppsContext>
	)
}

// Poll app state that is expected to settle on its own. Storage checks share
// this loop so a slow drive/share check can replace its temporary "checking"
// result without waiting for an unrelated UI refresh.
export function AppStatePolling() {
	const {userApps} = useApps()
	const utils = trpcReact.useUtils()
	const pollingAppIds = (userApps ?? [])
		.filter((app) => arrayIncludes(pollStates, app.state) || app.storage?.dataRoot?.status === 'checking')
		.map((app) => app.id)
	const pollingAppIdsKey = pollingAppIds.sort().join('\n')

	useEffect(() => {
		if (pollingAppIds.length === 0) return
		// Desktop tiles read per-app apps.state queries, so invalidating them
		// teaches each tile its state changed; useAppInstall's own poll loop
		// then keeps that tile live until the state settles again.
		const invalidate = () => {
			for (const appId of pollingAppIds) utils.apps.state.invalidate({appId})
			utils.apps.list.invalidate()
		}
		invalidate()
		const interval = setInterval(invalidate, 2000)
		return () => clearInterval(interval)
	}, [pollingAppIdsKey])

	return null
}

export function useApps() {
	const ctx = useContext(AppsContext)
	if (!ctx) throw new Error('useApps must be used within AppsProvider')

	return ctx
}

export function useUserApp(id?: string | null) {
	const ctx = useContext(AppsContext)
	if (!ctx) throw new Error('useUserApp must be used within AppsProvider')

	if (!id) return {isLoading: false, app: undefined} as const
	if (ctx.isLoading) return {isLoading: true} as const

	return {
		isLoading: false,
		app: ctx.userAppsKeyed?.[id],
	} as const
}
