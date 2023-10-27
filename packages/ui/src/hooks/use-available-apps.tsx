import {keyBy} from 'lodash-es'
import {createContext, useContext} from 'react'

import {RegistryApp, trpcReact} from '@/trpc/trpc'

type AppsContextT = {
	apps: RegistryApp[]
	appsKeyed: Record<string, RegistryApp>
	appsKeyedByCategory: Record<string, RegistryApp>
	isLoading: boolean
}
const AppsContext = createContext<AppsContextT | null>(null)

export function AvailableAppsProvider({children}: {children: React.ReactNode}) {
	const appsQ = trpcReact.appStore.registry.useQuery()
	const appsWithoutImages = appsQ.data?.find((repo) => repo?.meta.id === 'umbrel-app-store')?.apps

	const apps = appsWithoutImages?.map((app) => {
		const icon = `https://getumbrel.github.io/umbrel-apps-gallery/${app.id}/icon.svg`
		// FIXME: This is a hack to get the gallery images, but not all will have 5 images
		const gallery: RegistryApp['gallery'] = [1, 2, 3, 4, 5].map(
			(n) => `https://getumbrel.github.io/umbrel-apps-gallery/${app.id}/${n}.jpg`,
		)
		return {...app, icon, gallery}
	})

	const appsKeyed = keyBy(apps, 'id')
	const appsKeyedByCategory = keyBy(apps, 'category')

	return (
		<AppsContext.Provider value={{apps: apps || [], appsKeyedByCategory, appsKeyed, isLoading: appsQ.isLoading}}>
			{children}
		</AppsContext.Provider>
	)
}

export function useAvailableApps() {
	const ctx = useContext(AppsContext)
	if (!ctx) throw new Error('useApps must be used within AppsProvider')

	return ctx
}
