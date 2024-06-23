// TODO: move to widgets module
import {useState} from 'react'

import {MAX_WIDGETS} from '@/modules/widgets/shared/constants'
import {systemAppsKeyed, useApps} from '@/providers/apps'
import {AppState, trpcReact} from '@/trpc/trpc'

import {liveUsageWidgets} from './../modules/widgets/shared/constants'

export function useWidgets() {
	// Consider having `selectedTooMany` outside this hook
	const [selectedTooMany, setSelectedTooMany] = useState(false)
	const apps = useApps()

	const {selected, enable, disable, isLoading: isSelectedLoading} = useEnableWidgets()
	const isLoading = apps.isLoading || isSelectedLoading

	const availableUserAppWidgets = apps.userApps
		? apps.userApps
				// Don't want to allow users to select widgets while installing
				// But after done installing, the app might not be reachable, but we still want to
				// show its widgets.
				.filter((app) => app.state !== 'installing')
				.map((app) => ({
					appId: app.id,
					icon: app.icon,
					name: app.name,
					state: app.state,
					widgets: app.widgets?.map((w) => ({...w, id: app.id + ':' + w.id})) ?? [],
				}))
		: []

	// NOTE: the backend Umbrel system widgets always have an `umbrel:` prefix. For now this is good
	// because it means we can associate them with any system app. It used to be that some system widgets
	// were in the `settings` app. But they were moved to a new `live-usage` app.
	const availableSystemWidgets = [
		{
			appId: 'live-usage',
			icon: systemAppsKeyed['UMBREL_live-usage'].icon,
			name: systemAppsKeyed['UMBREL_live-usage'].name,
			state: 'ready' as const satisfies AppState,
			widgets: liveUsageWidgets,
		},
		// Add others here
	]

	const availableWidgets = apps.userApps
		? [...availableSystemWidgets, ...availableUserAppWidgets].filter(({widgets}) => widgets?.length)
		: []

	// No need to specify app id because widget endpoints are unique
	// TODO: don't call it `toggle` because it's not a toggle
	const toggleSelected = (widgetId: string, checked: boolean) => {
		if (selected.length >= MAX_WIDGETS && checked) {
			setSelectedTooMany(true)
			setTimeout(() => setSelectedTooMany(false), 500)
			return
		}
		setSelectedTooMany(false)
		if (selected.includes(widgetId)) {
			disable(widgetId)
		} else {
			enable(widgetId)
		}
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
					state: app.state,
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
