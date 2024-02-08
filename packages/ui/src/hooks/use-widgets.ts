import {useState} from 'react'

import {RegistryWidget} from '@/modules/widgets/constants'
import {systemAppsKeyed, useApps} from '@/providers/apps'
import {useAvailableApps} from '@/providers/available-apps'
import {trpcReact} from '@/trpc/trpc'

export const MAX_WIDGETS = 3

export const settingsWidgets: [
	RegistryWidget<'stat-with-progress'>,
	RegistryWidget<'stat-with-progress'>,
	RegistryWidget<'three-up'>,
] = [
	{
		id: 'umbrel:storage',
		type: 'stat-with-progress',
		endpoint: '/widgets/settings/storage-stat.json',
		example: {
			title: 'Storage',
			value: '256 GB',
			progressLabel: '1.75 TB left',
			progress: 0.25,
		},
	},
	{
		id: 'umbrel:memory',
		type: 'stat-with-progress',
		endpoint: '/widgets/settings/memory-stat.json',
		example: {
			title: 'Memory',
			value: '5.8 GB',
			valueSub: '/16GB',
			progressLabel: '11.4 GB left',
			progress: 0.36,
		},
	},
	{
		id: 'umbrel:system-stats',
		type: 'three-up',
		endpoint: '/widgets/settings/system-stats.json',
		example: {
			items: [
				{
					icon: 'system-widget-temperature',
					title: 'Optimal',
					value: '56℃',
				},
				{
					icon: 'system-widget-storage',
					title: 'Free',
					value: '1.75 TB',
				},
				{
					icon: 'system-widget-memory',
					title: 'Memory',
					value: '5.8 GB',
				},
			],
		},
	},
]

export function useWidgets() {
	// Consider having `selectedTooMany` outside this hook
	const [selectedTooMany, setSelectedTooMany] = useState(false)
	const availableApps = useAvailableApps()
	const apps = useApps()

	const {selected, enable, disable, isLoading: isSelectedLoading} = useEnableWidgets()
	const isLoading = availableApps.isLoading || apps.isLoading || isSelectedLoading

	const availableUserAppWidgets =
		availableApps.appsKeyed && apps.userApps
			? apps.userApps.map((app) => ({
					appId: app.id,
					icon: app.icon,
					name: app.name,
					widgets: availableApps.appsKeyed[app.id]?.widgets as RegistryWidget[] | undefined,
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
	const toggleSelected = (widget: RegistryWidget, checked: boolean) => {
		if (selected.length >= MAX_WIDGETS && checked) {
			setSelectedTooMany(true)
			setTimeout(() => setSelectedTooMany(false), 500)
			return
		}
		setSelectedTooMany(false)
		if (selected.map((w) => w.endpoint).includes(widget.endpoint)) {
			disable(widget.id)
		} else {
			enable(widget.id)
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

	return {
		availableWidgets,
		selected: selectedWithAppInfo,
		toggleSelected,
		selectedTooMany,
		isLoading,
		appFromEndpoint,
	}
}

function useEnableWidgets() {
	const ctx = trpcReact.useContext()
	const widgetQ = trpcReact.widget.enabled.useQuery()

	const enableMut = trpcReact.widget.enable.useMutation({
		onSuccess: () => {
			ctx.user.invalidate()
		},
	})

	const disableMut = trpcReact.widget.disable.useMutation({
		onSuccess: () => {
			ctx.user.invalidate()
		},
	})

	const selected = (widgetQ.data ?? []) as RegistryWidget[]
	// const setSelected = (widgets: WidgetT[]) => enableMut.mutate({widgets})

	const isLoading = widgetQ.isLoading || enableMut.isLoading

	return {
		isLoading,
		selected,
		enable: (widgetId: string) => enableMut.mutate({widgetId}),
		disable: (widgetId: string) => disableMut.mutate({widgetId}),
	}
}
