import {createContext, useContext} from 'react'
import {groupBy, indexBy, mapValues} from 'remeda'

import {UMBREL_APP_STORE_ID} from '@/constants/app-store'
import {indexRegistryApps, resolveRegistryAppsFirstWins} from '@/lib/app-store-registry'
import {RegistryApp, RouterOutput, trpcReact} from '@/trpc/trpc'

type AppsContextT =
	| {
			isLoading: true
	  }
	| {
			isLoading: false
			repos: RouterOutput['appStore']['registry']
			apps: RegistryApp[]
			appsKeyed: Record<string, RegistryApp>
			resolvedAppsKeyed: Record<string, RegistryApp>
			ambiguousAppIds: ReadonlySet<string>
			repoAppsKeyed: Record<string, Record<string, RegistryApp>>
			// Keyed by plain strings: manifests may declare categories umbrelOS
			// doesn't know about yet
			repoAppsGroupedByCategory: Record<string, Record<string, RegistryApp[]>>
	  }

const AppsContext = createContext<AppsContextT | null>(null)

// TODO: put all of this in a hook because trpc won't make multiple calls to the same query
export function AvailableAppsProvider({children}: {children: React.ReactNode}) {
	const appsQ = trpcReact.appStore.registry.useQuery(undefined, {
		staleTime: 3 * 60 * 1000, // 3 minutes
	})
	const repos = appsQ.data ?? []

	if (appsQ.isLoading) return null

	if (appsQ.isError || !appsQ.data) {
		throw new Error('Failed to fetch apps.')
	}

	const reposKeyed = indexBy(repos, (repo) => repo?.meta.id)
	const {appsKeyed, ambiguousAppIds} = indexRegistryApps(repos)
	const resolvedAppsKeyed = resolveRegistryAppsFirstWins(repos)
	const apps = repos.flatMap((repo) => repo?.apps ?? []).filter((app) => !ambiguousAppIds.has(app.id))
	const repoAppsKeyed = mapValues(reposKeyed, (repo) => indexBy(repo?.apps ?? [], (app) => app.id))
	const repoAppsGroupedByCategory = mapValues(reposKeyed, (repo) => groupBy(repo?.apps ?? [], (app) => app.category))

	const providerProps: AppsContextT = appsQ.isLoading
		? {isLoading: true}
		: {repos, apps, appsKeyed, resolvedAppsKeyed, ambiguousAppIds, repoAppsKeyed, repoAppsGroupedByCategory, isLoading: false}

	return <AppsContext value={providerProps}>{children}</AppsContext>
}

export function useAvailableApps(registryId: string = UMBREL_APP_STORE_ID) {
	const ctx = useContext(AppsContext)
	if (!ctx) throw new Error('useAvailableApps must be used within AvailableAppsProvider')

	if (ctx.isLoading) return {isLoading: true} as const

	const appsKeyed = ctx.repoAppsKeyed[registryId]
	const apps = ctx.repos.find((repo) => repo?.meta.id === registryId)?.apps ?? []
	const appsGroupedByCategory = ctx.repoAppsGroupedByCategory[registryId]

	return {
		isLoading: false,
		apps,
		appsKeyed,
		appsGroupedByCategory,
	} as const
}

export function useAllAvailableApps() {
	const ctx = useContext(AppsContext)
	if (!ctx) throw new Error('useAllAvailableApps must be used within AvailableAppsProvider')

	if (ctx.isLoading) return {isLoading: true} as const

	return {
		isLoading: false,
		apps: ctx.apps,
		appsKeyed: ctx.appsKeyed,
		resolvedAppsKeyed: ctx.resolvedAppsKeyed,
		ambiguousAppIds: ctx.ambiguousAppIds,
		repoAppsKeyed: ctx.repoAppsKeyed,
	} as const
}

// Allow querying for nullish app to allow the `id` to be dynamic
export function useAvailableApp(id?: string | null, registryId: string = UMBREL_APP_STORE_ID) {
	const {appsKeyed, isLoading} = useAvailableApps(registryId)

	if (!id) return {isLoading: false, app: undefined} as const
	if (isLoading) return {isLoading: true} as const
	if (!appsKeyed) return {isLoading: false, app: undefined} as const

	return {
		isLoading: false,
		app: appsKeyed[id],
	} as const
}
