import {useState} from 'react'
import {useNavigate} from 'react-router-dom'

import {useApps} from '@/providers/apps'
import {afterDelayedClose} from '@/utils/dialog'

import {WidgetSelector} from './widget-selector'

export default function EditWidgetsPage() {
	const navigate = useNavigate()
	const [open, setOpen] = useState(true)

	const {userApps, isLoading: isUserAppsLoading} = useApps()
	const hasInstalledApps = !isUserAppsLoading && (userApps ?? []).length > 0

	return (
		<WidgetSelector
			open={open}
			onOpenChange={(open) => {
				setOpen(open)
				afterDelayedClose(() => navigate('/'))(open)
			}}
			disabled={!hasInstalledApps}
		/>
	)
}
