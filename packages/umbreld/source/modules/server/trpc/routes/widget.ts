import z from 'zod'
// importing {execa} instead of {$} due to issues with template parsing for docker commands using $ syntax
import {execa} from 'execa'
import axios, {AxiosError} from 'axios'

import {router, privateProcedure} from '../trpc.js'

const MAX_ALLOWED_WIDGETS = 3

const systemWidgets = {
  storage: async function() {
    // const data = await getStorageData()
    // return data
		return {
			id: 'umbrel:storage',
			type: 'stat-with-progress',
			data: {
				title: 'Storage',
				value: '256 GB',
				progressLabel: '1.75 TB left',
				progress: 0.25,
			},
		}
  },
  memory: async function() {
    // const data = await getMemoryData()
    // return data
		return {
			id: 'umbrel:memory',
			type: 'stat-with-progress',
			data: {
				title: 'Memory',
				value: '5.8 GB',
				valueSub: '/16GB',
				progressLabel: '11.4 GB left',
				progress: 0.36,
			},
		}
  },
	'system-stats': async function() {
		// const data = await getSystemStats()
		// return data
		return {
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
		}
	}
}

// Splits a widgetId into appId and widgetName
// e.g., "transmission:status" => { appId: "transmission", widgetName: "status" }
function splitWidgetId(widgetId: string) {
	const [appId, widgetName] = widgetId.split(':')

	return {appId, widgetName}
}

export default router({
	// List all possible widgets that can be activated
	listAll: privateProcedure.query(async ({ctx}) => {
		// Iterate over installed apps and get their widgetIds
		const appWidgetIdPromises = ctx.apps.instances.map(async (app) => {
			const manifest = await app.readManifest()

			if (manifest.widgets) {
				return manifest.widgets.map((widget: {id: string}) => `${app.id}:${widget.id}`)
			}
			return []
		})

		const nestedAppWidgetIds = await Promise.all(appWidgetIdPromises)
		let appWidgetIds = nestedAppWidgetIds.flat()

		// Add system widgetIds
		const systemWidgetIds = Object.keys(systemWidgets).map(widget => `umbrel:${widget}`);
		const widgetIds = [...appWidgetIds, ...systemWidgetIds];

		return widgetIds
	}),

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
				// This is a system widget
				if (!(widgetName in systemWidgets)) throw new Error(`No widget named ${widgetName} found in Umbrel system widgets`)
			} else {
				// This is an app widget
				// Throws an error if the widget doesn't exist
				await ctx.apps.getApp(appId).getWidget(widgetName)
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

			if (appId === 'umbrel') {
				// This is a system widget
				if (!(widgetName in systemWidgets)) throw new Error(`No widget named ${widgetName} found in Umbrel system widgets`)
				const widgetData = await systemWidgets[widgetName as keyof typeof systemWidgets]()
				return widgetData
			} else {
				// This is an app widget
				// Get widget info from the app's manifest
				const widgetInfo = await ctx.apps.getApp(appId).getWidget(widgetName)
				const {container, port, endpoint} = widgetInfo
	
				// Get all running containers from docker
				// TODO: what should we do here for the case where an app is installed but not running?
				const {stdout: allContainers} = await execa('docker', ['container', 'ls', '--format', '{{.Names}}'])
	
				// Get the specific container name for the widget endpoint
				const containerName = allContainers.split('\n').find((name) => {
					// Using regex to match the container name across differnet Docker compose naming conventions (e.g., `app_container_1` and `app-container-1`)
					// and to precent partial matches with similar container names (e.g., `app_container_1` and `app_container-proxy_1`)
					const regex = new RegExp(`^${appId}[-_]${container}[-_][0-9]+$`)
					return regex.test(name)
				})
	
				if (!containerName) {
					throw new Error(`No container named ${container} found for app ${appId}`)
				}
	
				// Find container IP
				const {stdout: containerIp} = await execa('docker', [
					'inspect',
					'-f',
					'{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
					containerName,
				])
	
				const url = `http://${containerIp}:${port}/${endpoint}`
	
				try {
					const response = await axios.get(url)
					const widgetData = response.data
					return widgetData
				} catch (error) {
					if (error instanceof AxiosError) {
						throw new Error(`Failed to fetch data from ${url}: ${error.message}`)
					}
					throw error
				}
			}
		}),
})

// Saving Mark's types for later use

export type WidgetType =
	| 'stat-with-buttons'
	| 'stat-with-progress'
	| 'two-up-stat-with-progress'
	| 'three-up'
	| 'four-up'
	| 'list-emoji'
	| 'list'

// ------------------------------

/**
 * This link is relative to `RegistryApp['path']`
 * NOTE: type is created for this comment to appear in VSCode
 */
type Link = string

type FourUpItem = {
	title: string
	icon: string
	value: string
	valueSub: string
}
export type FourUpWidget = {
	type: 'four-up'
	link?: Link
	items: [FourUpItem, FourUpItem, FourUpItem, FourUpItem]
}

type ThreeUpItem = {
	icon: string
	title: string
	value: string
}
export type ThreeUpWidget = {
	type: 'three-up'
	link?: Link
	items: [ThreeUpItem, ThreeUpItem, ThreeUpItem]
}

// NOTE:
// The long name feels like it could be just be two-up, but this two-up widget is
// different from the others because it also has a progress. If we ever add one without a progress,
// that one would be two-up.
type TwoUpStatWithProgressItem = {
	title: string
	value: string
	valueSub: string
	/** Number from 0 to 1 */
	progress: number
}
export type TwoUpStatWithProgressWidget = {
	type: 'two-up-stat-with-progress'
	link?: Link
	items: [TwoUpStatWithProgressItem, TwoUpStatWithProgressItem]
}

export type StatWithProgressWidget = {
	type: 'stat-with-progress'
	link?: Link
	title: string
	value: string
	valueSub?: string
	progressLabel: string
	/** Number from 0 to 1 */
	progress: number
}

export type StatWithButtonsWidget = {
	type: 'stat-with-buttons'
	icon: string
	title: string
	value: string
	valueSub: string
	buttons: {
		text: string
		icon: string
		link: Link
	}[]
}

export type ListWidget = {
	type: 'list'
	link?: Link
	items: {
		text: string
		textSub: string
	}[]
}

export type ListEmojiWidget = {
	type: 'list-emoji'
	link?: Link
	count: number
	items: {
		emoji: string
		text: string
	}[]
}

type AnyWidgetConfig =
	| FourUpWidget
	| ThreeUpWidget
	| TwoUpStatWithProgressWidget
	| StatWithProgressWidget
	| StatWithButtonsWidget
	| ListWidget
	| ListEmojiWidget

// Choose the widget AnyWidgetConfig based on the type `T` passed in, othwerwise `never`
export type WidgetConfig<T extends WidgetType = WidgetType> = Extract<AnyWidgetConfig, {type: T}>

// ------------------------------

export type ExampleWidgetConfig<T extends WidgetType = WidgetType> = T extends 'stat-with-buttons'
	? // Omit the `type` (and `link` from buttons) by omitting `buttons` and then adding it without the `link`
	  Omit<StatWithButtonsWidget, 'type' | 'buttons'> & {buttons: Omit<StatWithButtonsWidget['buttons'], 'link'>}
	: // Otherwise, just omit the `type`
	  Omit<WidgetConfig<T>, 'type'>

// Adding `= WidgetType` to `T` makes it so that if `T` is not provided, it defaults to `WidgetType`. Prevents us from always having to write `RegistryWidget<WidgetType>` when referring to the type.
export type RegistryWidget<T extends WidgetType = WidgetType> = {
	id: string
	type: T
	refresh?: number
	// Examples aren't interactive so no need to include `link` in example
	example?: ExampleWidgetConfig<T>
}
