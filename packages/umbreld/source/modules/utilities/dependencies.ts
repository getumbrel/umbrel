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
