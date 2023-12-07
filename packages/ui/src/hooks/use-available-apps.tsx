import {createContext, useContext} from 'react'
import {groupBy} from 'remeda'

import {UMBREL_APP_STORE_ID} from '@/modules/app-store/constants'
import {Category, RegistryApp, trpcReact} from '@/trpc/trpc'
import {keyBy} from '@/utils/misc'

type AppsContextT =
	| {
			apps: undefined
			appsKeyed: undefined
			appsGroupedByCategory: undefined
			isLoading: true
	  }
	| {
			apps: RegistryApp[]
			appsKeyed: Record<string, RegistryApp>
			appsGroupedByCategory: Record<Category, RegistryApp[]>
			isLoading: false
	  }

const AppsContext = createContext<AppsContextT | null>(null)

// TODO: put all of this in a hook because trpc won't make multiple calls to the same query
export function AvailableAppsProvider({children}: {children: React.ReactNode}) {
	const appsQ = trpcReact.appStore.registry.useQuery()
	const apps = appsQ.data?.find((repo) => repo?.meta.id === UMBREL_APP_STORE_ID)?.apps

	if (appsQ.isLoading) return null

	if (appsQ.isError || !appsQ.data || !apps) {
		throw new Error('Failed to fetch apps.')
	}

	const appsKeyed = keyBy(apps, 'id')
	const appsGroupedByCategory = groupBy(apps, (a) => a.category)

	const providerProps: AppsContextT = appsQ.isLoading
		? {apps: undefined, appsKeyed: undefined, appsGroupedByCategory: undefined, isLoading: true}
		: {apps, appsKeyed, appsGroupedByCategory, isLoading: false}

	return <AppsContext.Provider value={providerProps}>{children}</AppsContext.Provider>
}

export function useAvailableApps() {
	const ctx = useContext(AppsContext)
	if (!ctx) throw new Error('useAvailableApps must be used within AvailableAppsProvider')

	return ctx
}

export function useAvailableApp(id?: string | null) {
	const ctx = useContext(AppsContext)
	if (!ctx) throw new Error('useAvailableApp must be used within AvailableAppsProvider')

	if (!id) return {isLoading: false, app: undefined}
	if (ctx.isLoading) return {isLoading: true}

	return {
		isLoading: false,
		app: ctx.appsKeyed[id],
	}
}
