// TODO: move to widgets module
import {useState} from 'react'

import {RegistryWidget} from '@/modules/widgets/shared/constants'
import {systemAppsKeyed, useApps} from '@/providers/apps'
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
		example: {
			items: [
				{
					icon: 'system-widget-temperature',
					title: 'Normal',
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
	const apps = useApps()

	const {selected, enable, disable, isLoading: isSelectedLoading} = useEnableWidgets()
	const isLoading = apps.isLoading || isSelectedLoading

	const availableUserAppWidgets = apps.userApps
		? apps.userApps.map((app) => ({
				appId: app.id,
				icon: app.icon,
				name: app.name,
				widgets: app.widgets ?? [],
		  }))
		: []

	const availableWidgets = apps.userApps
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
		if (selected.includes(widget.id)) {
			disable(widget.id)
		} else {
			enable(widget.id)
		}
		console.log(widget.id)
	}

	const appFromWidgetId = (id: string) => {
		return availableWidgets.find((app) => app.widgets?.find((widget) => widget.id === id))
	}

	const selectedWithAppInfo = selected
		.filter((id) => {
			const app = appFromWidgetId(id)
			return !!app
		})
		.map((id) => {
			// Expect app to be found because we filtered out widgets without apps
			const app = appFromWidgetId(id)!

			// Assume we'll always find a widget
			const widget = app.widgets.find((w) => w.id === id)!

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
	}
}

function useEnableWidgets() {
	const ctx = trpcReact.useContext()
	const widgetQ = trpcReact.widget.enabled.useQuery()

	const enableMut = trpcReact.widget.enable.useMutation({
		onSuccess: () => {
			ctx.user.invalidate()
			ctx.widget.enabled.invalidate()
		},
	})

	const disableMut = trpcReact.widget.disable.useMutation({
		onSuccess: () => {
			ctx.user.invalidate()
			ctx.widget.enabled.invalidate()
		},
	})

	const selected = widgetQ.data ?? []
	// const setSelected = (widgets: WidgetT[]) => enableMut.mutate({widgets})

	const isLoading = widgetQ.isLoading || enableMut.isLoading

	return {
		isLoading,
		selected,
		enable: (widgetId: string) => enableMut.mutate({widgetId}),
		disable: (widgetId: string) => disableMut.mutate({widgetId}),
	}
}
