import {createContext, useContext} from 'react'
import {filter} from 'remeda'

import {trpcReact, UserApp} from '@/trpc/trpc'
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
		icon: '/figma-exports/umbrel-app.svg',
		systemApp: true,
		systemAppTo: '/',
	},
	// For the dock...
	{
		id: 'UMBREL_home',
		name: 'Home',
		icon: '/figma-exports/dock-home.png',
		systemApp: true,
		systemAppTo: '/',
	},
	{
		id: 'UMBREL_app-store',
		name: 'App Store',
		icon: '/figma-exports/dock-app-store.png',
		systemApp: true,
		systemAppTo: '/app-store',
	},
	{
		id: 'UMBREL_files',
		name: 'Files',
		icon: '/figma-exports/dock-files.png',
		systemApp: true,
		systemAppTo: '/files/Home',
	},
	{
		id: 'UMBREL_settings',
		name: 'Settings',
		icon: '/figma-exports/dock-settings.png',
		systemApp: true,
		systemAppTo: '/settings',
	},
	{
		id: 'UMBREL_live-usage',
		name: 'Live Usage',
		icon: '/figma-exports/dock-live-usage.png',
		systemApp: true,
		// NOTE: using this will clear existing search params
		// In practice, this means cmdk will clear params and clicking dock icon will not
		systemAppTo: '?dialog=live-usage',
	},
	{
		id: 'UMBREL_widgets',
		name: 'Widgets',
		icon: '/figma-exports/dock-widgets.png',
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

	// Remove apps that have an error
	// TODO: consider passing these down in some places (like the desktop)
	const userApps = filter(appsQ.data ?? [], (app): app is UserApp => !('error' in app))
	const userAppsKeyed = keyBy(userApps, 'id')

	const allApps = [...userApps, ...systemApps]
	const allAppsKeyed = keyBy(allApps, 'id')

	return (
		<AppsContext.Provider
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
		</AppsContext.Provider>
	)
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
