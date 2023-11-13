import {sample} from 'remeda'

import {RegistryApp} from '@/trpc/trpc'

export function getRecommendationsFor(apps: RegistryApp[], appId: string) {
	const {category} = apps.find((app) => app.id === appId)!

	// Filter apps by the same category, excluding the current app
	const categoryApps = apps.filter((app) => app.category === category && app.id !== appId)

	// Sample 6 apps from the same category
	return sample(categoryApps, 6)
}
