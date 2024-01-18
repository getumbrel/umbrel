import { Widget, WidgetConfig } from '@/trpc/trpc'

import { useApps } from '@/hooks/use-apps'
import { useLaunchApp } from '@/hooks/use-launch-app'
import { useNavigate } from 'react-router-dom'
import { ActionsWidget } from './actions-widget'
import { FourUpWidget } from './four-up-widget'
import { NotificationsWidget } from './notifications-widget'
import { ProgressWidget } from './progress-widget'
import { WidgetContainer } from './shared/shared'
import { useWidgetEndpoint } from './shared/use-widget-endpoint'
import { StatWithButtonsWidget } from './stat-with-buttons-widget'
import { ThreeUpWidget } from './three-up-widget'
import { toast } from '@/components/ui/toast'

export function Widget({appId, config}:{appId: string, config: Widget}) {
	const {userAppsKeyed, systemAppsKeyed} = useApps()
	const {widget, error, isLoading} = useWidgetEndpoint(config.endpoint, config.type)
	
	const navigate = useNavigate()
	const launchApp = useLaunchApp()

	if (error) return <WidgetContainer className="text-destructive2-lightest p-5 text-12">Error: {error.message}</WidgetContainer>
	if (isLoading) return <WidgetContainer />

	const handleClick = (link?: string) => {
		if (appId === 'settings' && systemAppsKeyed.settings) {
			navigate('/settings?dialog=live-usage')
		} else if (userAppsKeyed?.[appId]) {
			// Launching directly because it's weird to have credentials show up
			// Users will likely open the app by clicking the icon before adding a widget associated with the app
			launchApp(appId, { path: link, direct: true})
		} else {
			toast.error(`App "${appId}" not found.`)
		}
	}

	switch (config.type) {
		case 'stat-with-buttons': {
			const w = widget as WidgetConfig<'stat-with-buttons'>;
			return <StatWithButtonsWidget {...w} onClick={link => handleClick(link)} />
		}
		case 'stat-with-progress': {
			const w = widget as WidgetConfig<'stat-with-progress'>;
			return <ProgressWidget {...w} onClick={() => handleClick()} />
		}
		case 'three-up': {
			const w = widget as WidgetConfig<'three-up'>;
			return <ThreeUpWidget {...w} onClick={() => handleClick()} />
		}
		case 'four-up': {
			const w = widget as WidgetConfig<'four-up'>;
			return <FourUpWidget {...w} onClick={() => handleClick()} />
		}
		case 'actions': {
			const w = widget as WidgetConfig<'actions'>;
			return <ActionsWidget {...w} onClick={() => handleClick()} />
		}
		case 'notifications': {
			const w = widget as WidgetConfig<'notifications'>;
			return <NotificationsWidget {...w} onClick={() => handleClick()} />
		}
	}
}
