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
					icon: 'system-widget-cpu',
					title: 'CPU',
					value: '11%',
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
		id: 'umbrel:system-stats',
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
					text: 'Deposit',
					icon: 'arrow-up-right',
					link: '?action=deposit',
				},
				{
					text: 'Withdraw',
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
		type: 'list-emoji',
		data: {
			count: 128,
			items: [
				{
					emoji: '🔒',
					text: 'Change password',
				},
				{
					emoji: '🔒',
					text: 'Change password',
				},
				{
					emoji: '🔒',
					text: 'Change password',
				},
				{
					emoji: '🔒',
					text: 'Change password',
				},
			],
		},
	},
	{
		id: 'nostr-relay:notifications',
		type: 'list',
		data: {
			link: '/foobar',
			items: [
				{
					textSub: 'Jan 1 • 1:12 PM',
					text: '✨ Introducing a new feature in our Nostr Relay app for Umbrel. Now you can sync your private relay on Umbrel with public relays, and back up past & future Nostr activity, even if the connection between your client & your private relay goes down',
				},
				{
					textSub: 'Jan 2 • 1:12 PM',
					text: 'Just a test 2',
				},
				{
					textSub: 'Jan 3 • 1:12 PM',
					text: 'Just a test 1',
				},
			],
		},
	},
	{
		id: 'transmission:status',
		type: 'stat-with-progress',
		data: {
			link: '/transmission/web/?bla=1',
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
