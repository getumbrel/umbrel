import {useNavigate} from 'react-router-dom'

import {toast} from '@/components/ui/toast'
import {useLaunchApp} from '@/hooks/use-launch-app'
import {ExampleWidgetConfig, RegistryWidget, WidgetConfig, WidgetType} from '@/modules/widgets/constants'
import {useApps} from '@/providers/apps'

import {ActionsWidget} from './actions-widget'
import {FourUpWidget} from './four-up-widget'
import {NotificationsWidget} from './notifications-widget'
import {ProgressWidget} from './progress-widget'
import {WidgetContainer} from './shared/shared'
import {useWidgetEndpoint} from './shared/use-widget-endpoint'
import {StatWithButtonsWidget} from './stat-with-buttons-widget'
import {ThreeUpWidget} from './three-up-widget'
import {TwoUpWidget} from './two-up-widget'

export function Widget({appId, config}: {appId: string; config: RegistryWidget}) {
	const {userAppsKeyed, systemAppsKeyed} = useApps()
	const {widget, error, isLoading} = useWidgetEndpoint(config.endpoint, config.type)

	const navigate = useNavigate()
	const launchApp = useLaunchApp()

	if (error)
		return <WidgetContainer className='p-5 text-12 text-destructive2-lightest'>Error: {error.message}</WidgetContainer>
	if (isLoading) return <WidgetContainer />

	const handleClick = (link?: string) => {
		if (appId === 'settings' && systemAppsKeyed.settings) {
			navigate('/settings?dialog=live-usage')
		} else if (userAppsKeyed?.[appId]) {
			// Launching directly because it's weird to have credentials show up
			// Users will likely open the app by clicking the icon before adding a widget associated with the app
			launchApp(appId, {path: link, direct: true})
		} else {
			toast.error(`App "${appId}" not found.`)
		}
	}

	switch (config.type) {
		case 'stat-with-buttons': {
			const w = widget as WidgetConfig<'stat-with-buttons'>
			return <StatWithButtonsWidget {...w} onClick={(link) => handleClick(link)} />
		}
		case 'stat-with-progress': {
			const w = widget as WidgetConfig<'stat-with-progress'>
			return <ProgressWidget {...w} onClick={() => handleClick()} />
		}
		case 'two-up-stat-with-progress': {
			const w = widget as WidgetConfig<'two-up-stat-with-progress'>
			return <TwoUpWidget {...w} onClick={() => handleClick()} />
		}
		case 'three-up': {
			const w = widget as WidgetConfig<'three-up'>
			return <ThreeUpWidget {...w} onClick={() => handleClick()} />
		}
		case 'four-up': {
			const w = widget as WidgetConfig<'four-up'>
			return <FourUpWidget {...w} onClick={() => handleClick()} />
		}
		case 'actions': {
			const w = widget as WidgetConfig<'actions'>
			return <ActionsWidget {...w} onClick={() => handleClick()} />
		}
		case 'notifications': {
			const w = widget as WidgetConfig<'notifications'>
			return <NotificationsWidget {...w} onClick={() => handleClick()} />
		}
	}
}

export function ExampleWidget<T extends WidgetType = WidgetType>({
	type,
	example,
}: {
	type: T
	example?: ExampleWidgetConfig<T>
}) {
	switch (type) {
		case 'stat-with-buttons': {
			const w = example as WidgetConfig<'stat-with-buttons'>
			const widgetWithButtonLinks = {
				...w,
				// Link to nowhere
				buttons: w.buttons.map((button) => ({...button, link: ''})),
			}
			return <StatWithButtonsWidget {...widgetWithButtonLinks} />
		}
		case 'stat-with-progress': {
			const w = example as WidgetConfig<'stat-with-progress'>
			return <ProgressWidget {...w} />
		}
		case 'two-up-stat-with-progress': {
			const w = example as WidgetConfig<'two-up-stat-with-progress'>
			return <TwoUpWidget {...w} />
		}
		case 'three-up': {
			const w = example as WidgetConfig<'three-up'>
			return <ThreeUpWidget {...w} />
		}
		case 'four-up': {
			const w = example as WidgetConfig<'four-up'>
			return <FourUpWidget {...w} />
		}
		case 'actions': {
			const w = example as WidgetConfig<'actions'>
			return <ActionsWidget {...w} />
		}
		case 'notifications': {
			const w = example as WidgetConfig<'notifications'>
			return <NotificationsWidget {...w} />
		}
	}
}
