import { Widget, WidgetConfig } from '@/trpc/trpc'

import { useApps } from '@/hooks/use-apps'
import { portToUrl } from '@/utils/misc'
import urlJoin from 'url-join'
import { ActionsWidget } from './actions-widget'
import { FourUpWidget } from './four-up-widget'
import { NotificationsWidget } from './notifications-widget'
import { ProgressWidget } from './progress-widget'
import { WidgetContainer } from './shared/shared'
import { useWidgetEndpoint } from './shared/use-widget-endpoint'
import { StatWithButtonsWidget } from './stat-with-buttons-widget'
import { ThreeUpWidget } from './three-up-widget'

export function Widget({appId, config}:{appId: string, config: Widget}) {
	const {widget, error, isLoading} = useWidgetEndpoint(config.endpoint, config.type)
	const {userAppsKeyed} = useApps()

	const userApp = userAppsKeyed?.[appId]

	if (error) return <WidgetContainer className="text-destructive2-lightest p-5 text-12">Error: {error.message}</WidgetContainer>
	if (isLoading) return <WidgetContainer />

	const appUrl = (link: string) => userApp ? urlJoin(portToUrl(userApp.port), link ?? '') : link

	switch (config.type) {
		case 'stat-with-buttons': {
			const w = widget as WidgetConfig<'stat-with-buttons'>;
			return <StatWithButtonsWidget {...{...w, appUrl: userApp ? portToUrl(userApp.port) : '/settings'}} />
		}
		case 'stat-with-progress': {
			const w = widget as WidgetConfig<'stat-with-progress'>;
			const href = appUrl(w.link)
			return <ProgressWidget {...{...w, href}} />
		}
		case 'three-up': {
			const w = widget as WidgetConfig<'three-up'>;
			const href = appUrl(w.link)
			return <ThreeUpWidget {...{...w, href}} />
		}
		case 'four-up': {
			const w = widget as WidgetConfig<'four-up'>;
			const href = appUrl(w.link)
			return <FourUpWidget {...{...w, href}} />
		}
		case 'actions': {
			const w = widget as WidgetConfig<'actions'>;
			const href = appUrl(w.link)
			return <ActionsWidget {...{...w, href}} />
		}
		case 'notifications': {
			const w = widget as WidgetConfig<'notifications'>;
			const href = appUrl(w.link)
			return <NotificationsWidget {...{...w, href}} />
		}
	}
}
