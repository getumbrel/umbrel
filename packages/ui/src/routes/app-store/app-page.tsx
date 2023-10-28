import {useParams} from 'react-router-dom'

import {AppIcon} from '@/components/app-icon'
import {useAvailableApp} from '@/hooks/use-available-apps'

export function AppPage() {
	const {appId} = useParams()
	const {app, isLoading} = useAvailableApp(appId)

	if (isLoading) return <div>Loading...</div>
	if (!app) return <div>App not found</div>

	return (
		<div>
			<AppIcon src={app.icon} size={100} />
		</div>
	)
}
