import z from 'zod'

import {router, privateProcedure} from '../trpc.js'

const widgets = [
	{
		id: 'umbrel:storage',
		type: 'stat-with-progress',
		data: {
			title: 'Storage',
			value: '256 GB',
			progressLabel: '1.75 TB left',
			progress: 0.25,
		},
	},
	{
		id: 'umbrel:memory',
		type: 'stat-with-progress',
		data: {
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
		data: {
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
	{
		id: 'bitcoin:stats',
		type: 'four-up',
		data: {
			link: '?page=stats',
			items: [
				{title: 'Connections', value: '11', valueSub: 'peers'},
				{title: 'Mempool', value: '36', valueSub: 'MB'},
				{title: 'Hashrate', value: '366', valueSub: 'EH/s'},
				{title: 'Blockchain size', value: '563', valueSub: 'GB'},
			],
		},
	},
	{
		id: 'bitcoin:sync',
		type: 'stat-with-progress',
		data: {
			link: '/',
			title: 'Blockchain sync',
			value: '86.92%',
			progressLabel: 'In progress',
			progress: 0.8692,
		},
	},
	{
		id: 'lightning:balance-and-transact',
		type: 'stat-with-buttons',
		data: {
			title: 'Lightning Wallet',
			value: '762,248',
			valueSub: 'sats',
			buttons: [
				{
					title: 'Deposit',
					icon: 'arrow-up-right',
					link: '?action=deposit',
				},
				{
					title: 'Withdraw',
					icon: 'arrow-down-right',
					link: '?action=withdraw',
				},
			],
		},
	},
	{
		id: 'lightning:connections',
		type: 'four-up',
		data: {
			link: '?page=stats',
			items: [
				{title: 'Connections', value: '11', valueSub: 'peers'},
				{title: 'Active channels', value: '1', valueSub: 'channel'},
				{title: 'Max send', value: '366', valueSub: 'sats'},
				{title: 'Max receive', value: '563', valueSub: 'sats'},
			],
		},
	},
	{
		id: 'nostr-relay:stats',
		type: 'actions',
		data: {
			count: 128,
			actions: [
				{
					emoji: '🔒',
					title: 'Change password',
				},
				{
					emoji: '🔒',
					title: 'Change password',
				},
				{
					emoji: '🔒',
					title: 'Change password',
				},
				{
					emoji: '🔒',
					title: 'Change password',
				},
			],
		},
	},
	{
		id: 'nostr-relay:notifications',
		type: 'notifications',
		data: {
			link: '/foobar',
			notifications: [
				{
					timestamp: 1704418307143,
					description:
						'✨ Introducing a new feature in our Nostr Relay app for Umbrel. Now you can sync your private relay on Umbrel with public relays, and back up past & future Nostr activity, even if the connection between your client & your private relay goes down',
				},
				{
					timestamp: 1702100000000,
					description: 'Just a test 2',
				},
				{
					timestamp: 1700000000000,
					description: 'Just a test 1',
				},
			],
		},
	},
	{
		id: 'settings:system-stats',
		type: 'two-up-stat-with-progress',
		data: {
			items: [
				{
					title: 'Memory',
					value: '12.3',
					valueSub: 'GB',
					progress: 0.5,
				},
				{
					title: 'CPU',
					value: '12.3',
					valueSub: '%',
					progress: 0.5,
				},
			],
		},
	},
	{
		id: 'transmission:status',
		type: 'stat-with-progress',
		data: {
			link: '?bla=1',
			title: 'Transmitting',
			value: '12.92%',
			progressLabel: 'In progress',
			progress: 0.1292,
		},
	},
] as const

export default router({
	// List enabled widgets
	enabled: privateProcedure.query(async ({ctx}) => {
		const widgetIds = (await ctx.umbreld.store.get('widgets')) || []
		return widgetIds
	}),

	// Enable widget
	enable: privateProcedure
		.input(
			z.object({
				widgetId: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => {
			// TODO: Validate widgetId

			// Save widget ID
			await ctx.umbreld.store.getWriteLock(async ({get, set}) => {
				const widgets = (await get('widgets')) || []

				// TODO: Check if widget is already active

				// TODO: Check we don't have more than 3 widgets enabled

				widgets.push(input.widgetId)
				await set('widgets', widgets)
			})

			return true
		}),

	// Disable widget
	disable: privateProcedure
		.input(
			z.object({
				widgetId: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => {
			// Remove widget ID
			await ctx.umbreld.store.getWriteLock(async ({get, set}) => {
				const widgets = await get('widgets')

				// Check if widget is currently enabled
				if (!widgets.includes(input.widgetId)) {
					throw new Error(`Widget ${input.widgetId} is not enabled`)
				}

				// Remove widget
				const updatedWidgets = widgets.filter((widget) => widget !== input.widgetId)
				await set('widgets', updatedWidgets)
			})

			return true
		}),

	// Get live data for a widget
	data: privateProcedure
		.input(
			z.object({
				widgetId: z.string(),
			}),
		)
		.query(async ({ctx, input}) => {
			return widgets.find((w) => w.id === input.widgetId)?.data
			// TODO: Return live data for a given widget
		}),
})

// Saving Mark's previous types for later use

type FourUpItem = {
	title: string
	value: string
	valueSub: string
}
export type FourUpWidget = {
	type: 'four-up'
	link: string
	items: [FourUpItem, FourUpItem, FourUpItem, FourUpItem]
}

type ThreeUpItem = {
	icon: string
	title: string
	value: string
}
export type ThreeUpWidget = {
	type: 'three-up'
	link: string
	items: [ThreeUpItem, ThreeUpItem, ThreeUpItem]
}

export type StatWithProgressWidget = {
	type: 'stat-with-progress'
	link: string
	title: string
	value: string
	progressLabel: string
	progress: number
}

export type StatWithButtonsWidget = {
	type: 'stat-with-buttons'
	title: string
	value: string
	valueSub: string
	buttons: {
		title: string
		icon: string
		link: string
	}[]
}

export type NotificationsWidget = {
	type: 'notifications'
	link: string
	notifications: {
		timestamp: number
		description: string
	}[]
}

export type ActionsWidget = {
	type: 'actions'
	link: string
	count: number
	actions: {
		emoji: string
		title: string
	}[]
}

export type AnyWidgetConfig =
	| FourUpWidget
	| ThreeUpWidget
	| StatWithProgressWidget
	| StatWithButtonsWidget
	| NotificationsWidget
	| ActionsWidget
