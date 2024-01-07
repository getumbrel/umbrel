import {indexBy} from 'remeda'
import {Widget} from './schema.js'

export const categories = [
	'files',
	'bitcoin',
	'media',
	'networking',
	'social',
	'automation',
	'finance',
	'ai',
	'developer',
] as const

// ------------------------------

export const demoWidgetConfigs = [
	{
		appId: 'bitcoin',
		widgets: [
			{
				type: 'stat-with-progress',
				endpoint: '/widgets/bitcoin/sync.json',
			},
			{
				type: 'four-up',
				endpoint: '/widgets/bitcoin/stats.json',
			},
		],
	},
	{
		appId: 'lightning',
		widgets: [
			{
				type: 'stat-with-buttons',
				endpoint: '/widgets/lightning/balance-and-transact.json',
			},
			{
				type: 'four-up',
				endpoint: '/widgets/lightning/connections.json',
			},
		],
	},
	{
		appId: 'nostr-relay',
		widgets: [
			{
				type: 'actions',
				endpoint: '/widgets/nostr-relay/actions.json',
			},
			{
				type: 'notifications',
				endpoint: '/widgets/nostr-relay/notifications.json',
			},
		],
	},
] satisfies {
	appId: string
	widgets: Widget[]
}[]

export const demoWidgetConfigsKeyed = indexBy(demoWidgetConfigs, (widget) => widget.appId)
