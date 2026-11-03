/**
 * Ensure selected dependencies are filled in when given the app's dependencies
 * (where undefined = none) and a user's selection (where undefined = default).
 */
export const fillSelectedDependencies = (dependencies?: string[], selectedDependencies?: Record<string, string>) =>
	dependencies?.reduce(
		(accumulator, dependencyId) => {
			accumulator[dependencyId] = selectedDependencies?.[dependencyId] ?? dependencyId
			return accumulator
		},
		{} as Record<string, string>,
	) ?? {}

type DependencyProvider = {
	id: string
	state: string
	readManifest(): Promise<{implements?: string[]}>
}

/**
 * Resolve a dependency selection and validate it before it is persisted. Every
 * selected dependency must be declared by the app, and every changed selection
 * must name an installed app that implements it. Selections are later used as
 * app-data directory names whose exports are sourced on the host, so nothing
 * but a validated provider id may be stored. Unchanged selections are skipped so
 * stale choices that outlived their provider remain repairable.
 */
export async function resolveSelectedDependencies({
	appId,
	dependencies,
	selectedDependencies,
	previousSelections,
	providers,
}: {
	appId: string
	dependencies: string[] | undefined
	selectedDependencies: Record<string, string> | undefined
	previousSelections: Record<string, string>
	providers: readonly DependencyProvider[]
}) {
	const declaredDependencies = new Set(dependencies ?? [])
	for (const dependencyId of Object.keys(selectedDependencies ?? {})) {
		if (!declaredDependencies.has(dependencyId)) {
			throw new Error(`[apps-settings-dependency-unsupported] App '${appId}' does not declare '${dependencyId}'`)
		}
	}
	const resolvedDependencies = fillSelectedDependencies(dependencies, selectedDependencies)
	for (const [dependencyId, providerId] of Object.entries(resolvedDependencies)) {
		if (providerId === previousSelections[dependencyId]) continue
		const provider = providers.find((candidate) => candidate.id === providerId)
		if (!provider || provider.state === 'installing' || provider.state === 'uninstalling') {
			throw new Error(`[apps-settings-dependency-not-installed] Dependency provider '${providerId}' is not installed`)
		}
		if (providerId !== dependencyId && !(await provider.readManifest()).implements?.includes(dependencyId)) {
			throw new Error(
				`[apps-settings-dependency-incompatible] App '${providerId}' does not implement '${dependencyId}'`,
			)
		}
	}
	return resolvedDependencies
}
