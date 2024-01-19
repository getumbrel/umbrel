import {useState} from 'react'
import {uniq} from 'remeda'

import {trpcReact, Widget} from '@/trpc/trpc'

import {systemAppsKeyed, useApps} from './use-apps'
import {useAvailableApps} from './use-available-apps'

export const MAX_WIDGETS = 3

// TODO: add previews of widgets here
export const settingsWidgets: Widget[] = [
	{
		type: 'stat-with-progress',
		endpoint: '/widgets/settings/storage-stat.json',
	},
	{
		type: 'stat-with-progress',
		endpoint: '/widgets/settings/memory-stat.json',
	},
	{
		type: 'three-up',
		endpoint: '/widgets/settings/system-stats.json',
	},
]

export function useWidgets() {
	// Consider having `selectedTooMany` outside this hook
	const [selectedTooMany, setSelectedTooMany] = useState(false)
	const availableApps = useAvailableApps()
	const apps = useApps()

	const {selected, setSelected, isLoading: isSelectedLoading} = useSelectedWidgets()
	const isLoading = availableApps.isLoading || apps.isLoading || isSelectedLoading

	const availableUserAppWidgets =
		availableApps.appsKeyed && apps.userApps
			? apps.userApps.map((app) => ({
					appId: app.id,
					icon: app.icon,
					name: app.name,
					widgets: availableApps.appsKeyed[app.id]?.widgets,
			  }))
			: []

	const availableWidgets =
		availableApps.appsKeyed && apps.userApps
			? [
					{
						appId: 'settings',
						icon: systemAppsKeyed['settings'].icon,
						name: systemAppsKeyed['settings'].name,
						widgets: settingsWidgets,
					},
					...availableUserAppWidgets,
			  ].filter(({widgets}) => widgets?.length)
			: []

	// No need to specify app id because widget endpoints are unique
	const toggleSelected = (widget: Widget, checked: boolean) => {
		if (selected.length >= MAX_WIDGETS && checked) {
			setSelectedTooMany(true)
			setTimeout(() => setSelectedTooMany(false), 500)
			return
		}
		setSelectedTooMany(false)
		if (selected.map((w) => w.endpoint).includes(widget.endpoint)) {
			setSelected?.(selected.filter((w) => w.endpoint !== widget.endpoint))
		} else {
			setSelected?.(uniq([...selected, widget]))
		}
		console.log(widget.endpoint)
	}

	const appFromEndpoint = (endpoint: string) => {
		return availableWidgets.find((app) => app.widgets?.find((widget) => widget.endpoint === endpoint))
	}

	const selectedWithAppInfo = selected
		.filter((w) => {
			const app = appFromEndpoint(w.endpoint)
			return !!app
		})
		.map((widget) => {
			// Expect app to be found because we filtered out widgets without apps
			const app = appFromEndpoint(widget.endpoint)!

			return {
				...widget,
				app: {
					id: app.appId,
					icon: app.icon,
					name: app.name,
				},
			}
		})

	// TODO: return app information like icon, name, and appId with widgets
	return {
		availableWidgets,
		selected: selectedWithAppInfo,
		toggleSelected,
		selectedTooMany,
		isLoading,
		appFromEndpoint,
	}
}

function useSelectedWidgets() {
	const ctx = trpcReact.useContext()
	const userQ = trpcReact.user.get.useQuery()
	const userMut = trpcReact.user.set.useMutation({
		onSuccess: () => {
			ctx.user.invalidate()
		},
	})

	const selected = userQ.data?.widgets ?? []
	const setSelected = (widgets: Widget[]) => userMut.mutate({widgets})

	const isLoading = userQ.isLoading || userMut.isLoading

	return {
		isLoading,
		selected,
		setSelected,
	}
}
