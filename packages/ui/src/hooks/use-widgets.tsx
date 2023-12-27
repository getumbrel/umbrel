import {useState} from 'react'
import {uniq} from 'remeda'

import {trpcReact, Widget} from '@/trpc/trpc'

import {useAvailableApps} from './use-available-apps'
import {systemAppsKeyed, useUserApps} from './use-user-apps'

export const MAX_WIDGETS = 3

const settingsWidgets: Widget[] = [
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
	const userApps = useUserApps()

	const {selected, setSelected, isLoading: isSelectedLoading} = useSelectedWidgets()
	const isLoading = availableApps.isLoading || userApps.isLoading || isSelectedLoading

	const availableUserAppWidgets =
		availableApps.appsKeyed && userApps.userApps
			? userApps.userApps.map((app) => ({
					appId: app.id,
					icon: app.icon,
					name: app.name,
					widgets: availableApps.appsKeyed[app.id]?.widgets,
			  }))
			: []

	const availableWidgets =
		availableApps.appsKeyed && userApps.userApps
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

	return {
		availableWidgets,
		selected,
		toggleSelected,
		selectedTooMany,
		isLoading,
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
