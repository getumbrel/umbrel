import {Widget} from '@/trpc/trpc'

import {ActionsWidget} from './actions-widget'
import {FourUpWidget} from './four-up-widget'
import {NotificationsWidget} from './notifications-widget'
import {ConnectedProgressWidget} from './progress-widget'
import {ConnectedStatWithButtonsWidget} from './stat-with-buttons-widget'
import {ThreeUpWidget} from './three-up-widget'

export function widgetConfigToWidget(widgetConfig: Widget) {
	switch (widgetConfig.type) {
		case 'stat-with-progress':
			return <ConnectedProgressWidget endpoint={widgetConfig.endpoint} />
		case 'stat-with-buttons':
			return <ConnectedStatWithButtonsWidget endpoint={widgetConfig.endpoint} />
		case 'three-up':
			return <ThreeUpWidget />
		case 'four-up':
			return <FourUpWidget />
		case 'actions':
			return <ActionsWidget />
		case 'notifications':
			return <NotificationsWidget />
	}
}
