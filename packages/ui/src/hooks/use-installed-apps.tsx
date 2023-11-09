import {createContext, useContext} from 'react'
import {LinkProps} from 'react-router-dom'

import {RegistryApp} from '@/trpc/trpc'
import {keyBy} from '@/utils/misc'

import {useAvailableApps} from './use-available-apps'

type AppT = {
	id: string
	name: string
	icon: string
	systemApp?: boolean
	systemAppTo?: LinkProps['to']
}

export const systemApps = [
	{
		id: 'home',
		name: 'Home',
		icon: '/dock/home.png',
		systemApp: true,
		systemAppTo: '/',
	},
	{
		id: 'app-store',
		name: 'App Store',
		icon: '/dock/shop.png',
		systemApp: true,
		systemAppTo: '/app-store',
	},
	{
		id: 'settings',
		name: 'Settings',
		icon: '/dock/settings.png',
		systemApp: true,
		systemAppTo: '/settings',
	},
	{
		id: 'exit',
		name: 'Logout',
		icon: '/dock/exit.png',
		systemApp: true,
		// Instead use search param: {dialog: 'logout'}
		systemAppTo: '',
	},
] as const satisfies readonly AppT[]

export const systemAppsKeyed = keyBy(systemApps, 'id')

type DemoAppsContextT = {
	installedApps?: RegistryApp[]
	installedAppsKeyed?: Record<string, RegistryApp>
	// needs to be explicitly readonly so typescript doesn't complain, though all other props are technically readonly too
	systemApps: readonly AppT[]
	systemAppsKeyed: typeof systemAppsKeyed
	allApps: AppT[]
	allAppsKeyed: Record<string, AppT>
	isLoading: boolean
}
const InstalledAppsContext = createContext<DemoAppsContextT | null>(null)

/** Simulate installed apps */
export function InstalledAppsProvider({children}: {children: React.ReactNode}) {
	const {isLoading, apps: installedApps, appsKeyed: installedAppsKeyed} = useAvailableApps()

	const allApps = [...(installedApps ?? []), ...systemApps]
	const allAppsKeyed = keyBy(allApps, 'id')

	return (
		<InstalledAppsContext.Provider
			value={{
				installedApps,
				installedAppsKeyed,
				systemApps,
				systemAppsKeyed,
				allApps,
				allAppsKeyed,
				isLoading,
			}}
		>
			{children}
		</InstalledAppsContext.Provider>
	)
}

/** Simulate installed apps */
export function useInstalledApps() {
	const ctx = useContext(InstalledAppsContext)
	if (!ctx) throw new Error('useInstalledApps must be used within InstalledAppsProvider')

	return ctx
}
