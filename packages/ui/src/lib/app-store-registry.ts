import {UMBREL_APP_STORE_ID} from '@/constants/app-store'
import type {RegistryApp} from '@/trpc/trpc'

type AppRegistry = {
	meta: {id: string}
	apps: readonly RegistryApp[]
}

export type RegistryAppIndex = {
	appsKeyed: Record<string, RegistryApp>
	ambiguousAppIds: ReadonlySet<string>
}

/**
 * The backend mutates apps by bare ID, so an ID found in more than one loaded
 * registry is unsafe to act on. Quarantine collisions instead of picking a
 * winner or throwing from the provider that wraps the authenticated shell.
 */
export function indexRegistryApps(registries: readonly (AppRegistry | null)[]): RegistryAppIndex {
	const candidates = new Map<string, RegistryApp[]>()

	for (const registry of registries) {
		if (!registry) continue
		for (const app of registry.apps) {
			const apps = candidates.get(app.id) ?? []
			apps.push(app)
			candidates.set(app.id, apps)
		}
	}

	const appsKeyed: Record<string, RegistryApp> = {}
	const ambiguousAppIds = new Set<string>()
	for (const [appId, apps] of candidates) {
		if (apps.length === 1) appsKeyed[appId] = apps[0]
		else ambiguousAppIds.add(appId)
	}

	return {appsKeyed, ambiguousAppIds}
}

/** First-repository-wins lookup, matching umbreld's install/update resolution. */
export function resolveRegistryAppsFirstWins(registries: readonly (AppRegistry | null)[]): Record<string, RegistryApp> {
	const appsKeyed: Record<string, RegistryApp> = {}

	for (const registry of registries) {
		if (!registry) continue
		for (const app of registry.apps) {
			if (!appsKeyed[app.id]) appsKeyed[app.id] = app
		}
	}

	return appsKeyed
}

/** Resolve a dependency only when exactly one loaded registry provides it. */
export function resolveDependencyRegistryApp({
	dependencyId,
	registryId,
	repoAppsKeyed,
	ambiguousAppIds,
}: {
	dependencyId: string
	registryId: string
	repoAppsKeyed: Record<string, Record<string, RegistryApp> | undefined>
	ambiguousAppIds?: ReadonlySet<string>
}) {
	if (ambiguousAppIds?.has(dependencyId)) return undefined
	const matchingRegistries = Object.values(repoAppsKeyed).filter((appsKeyed) => appsKeyed?.[dependencyId])
	if (matchingRegistries.length !== 1) return undefined

	const currentRegistryApp = repoAppsKeyed[registryId]?.[dependencyId]
	if (currentRegistryApp) return currentRegistryApp

	const officialRegistryApp = repoAppsKeyed[UMBREL_APP_STORE_ID]?.[dependencyId]
	if (officialRegistryApp) return officialRegistryApp

	return matchingRegistries[0]?.[dependencyId]
}
