import z from 'zod'

import {router, privateProcedure} from '../trpc.js'

const widgets = [
	{
		id: 'umbrel:storage',
		type: 'stat-with-progress',
		refresh: 1000 * 60 * 5,
		example: {
			title: 'Storage',
			value: '256 GB',
			progressLabel: '1.75 TB left',
			progress: 0.25,
		},
	},
	{
		id: 'umbrel:memory',
		type: 'stat-with-progress',
		refresh: 1000 * 10,
		example: {
			title: 'Memory',
			value: '5.8 GB',
			subValue: '/16GB',
			progressLabel: '11.4 GB left',
			progress: 0.36,
		},
	},
]

export default router({
	// List all possible widgets that can be activated
	listAll: privateProcedure.query(async ({ctx}) => {
		// TODO: Iterate over installed apps and show all possible widgets.

		return widgets
	}),

	// List enabled widgets
	enabled: privateProcedure.query(async ({ctx}) => {
		const widgetIds = (await ctx.umbreld.store.get('widgets')) || []
		return widgets.filter((widget) => widgetIds.includes(widget.id))
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
			// TODO: Return live data for a given widget

			return {
				id: 'umbrel:storage',
				type: 'stat-with-progress',
				refresh: 1000 * 60 * 5,
				data: {
					title: 'Storage',
					value: '256 GB',
					progressLabel: '1.75 TB left',
					progress: 0.25,
				},
			}
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
