import {keyBy} from 'lodash-es'
import {createContext, useContext, useEffect, useState} from 'react'

export interface AppT {
	id: string
	name: string
	category: string
	version: string
	tagline: string
	description: string
	developer: string
	website: string
	dependencies: DependencyT[]
	repo: string
	gallery: string[]
	releaseNotes: string
	icon: string
	submitter: string
	submission: string
}

export interface DependencyT {
	id: string
	name: string
	icon: string
}

type AppsContextT = {
	apps: AppT[]
	appsKeyed: Record<string, AppT>
	isLoading: boolean
}
const AppsContext = createContext<AppsContextT | null>(null)

export function AvailableAppsProvider({children}: {children: React.ReactNode}) {
	const [apps, setApps] = useState<AppT[]>([])
	const [isLoading, setIsLoading] = useState(true)

	useEffect(() => {
		fetch('https://apps.umbrel.com/api/v1/apps/tmp-dump')
			.then((res) => res.json())
			.then((data) => {
				setApps(data.data)
				setIsLoading(false)
			})
	}, [])

	const appsKeyed = keyBy(apps, 'id')

	return <AppsContext.Provider value={{apps, appsKeyed, isLoading}}>{children}</AppsContext.Provider>
}

export function useAvailableApps() {
	const ctx = useContext(AppsContext)
	if (!ctx) throw new Error('useApps must be used within AppsProvider')

	return ctx
}
