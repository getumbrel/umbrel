import z from 'zod'
import ms from 'ms'

import {router, privateProcedure} from '../server/trpc/trpc.js'
import {systemWidgets} from '../system/system-widgets.js'
import {filesWidgets} from '../files/widgets.js'

const MAX_ALLOWED_WIDGETS = 3

const umbrelWidgets = {...systemWidgets, ...filesWidgets}

// Splits a widgetId into appId and widgetName
// e.g., "transmission:status" => { appId: "transmission", widgetName: "status" }
function splitWidgetId(widgetId: string) {
	const [appId, widgetName] = widgetId.split(':')

	return {appId, widgetName}
}

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
			const {appId, widgetName} = splitWidgetId(input.widgetId)

			// Validate widget
			if (appId === 'umbrel') {
				// This is an Umbrel widget
				if (!(widgetName in umbrelWidgets)) throw new Error(`No widget named ${widgetName} found in Umbrel widgets`)
			} else {
				// This is an app widget
				// Throws an error if the widget doesn't exist
				await ctx.apps.getApp(appId).getWidgetMetadata(widgetName)
			}

			// Save widget ID
			await ctx.umbreld.store.getWriteLock(async ({get, set}) => {
				const widgets = (await get('widgets')) || []

				// Check if widget is already active
				if (widgets.includes(input.widgetId)) throw new Error(`Widget ${input.widgetId} is already enabled`)

				// Check we don't have more than 3 widgets enabled
				if (widgets.length >= MAX_ALLOWED_WIDGETS)
					throw new Error(`The maximum number of widgets (${MAX_ALLOWED_WIDGETS}) has already been enabled`)

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
				if (!widgets.includes(input.widgetId)) throw new Error(`Widget ${input.widgetId} is not enabled`)

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
			const {appId, widgetName} = splitWidgetId(input.widgetId)
			let widgetData: {[key: string]: any}

			if (appId === 'umbrel') {
				// This is an Umbrel widget
				if (!(widgetName in umbrelWidgets)) throw new Error(`No widget named ${widgetName} found in Umbrel widgets`)

				widgetData = await umbrelWidgets[widgetName as keyof typeof umbrelWidgets](ctx.umbreld)
			} else {
				// This is an app widget
				widgetData = await ctx.apps.getApp(appId).getWidgetData(widgetName)
			}

			// Parse refresh time from human-readable string to milliseconds
			widgetData.refresh = ms(widgetData.refresh)

			return widgetData
		}),
})
