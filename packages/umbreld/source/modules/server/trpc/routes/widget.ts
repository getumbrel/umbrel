import z from 'zod'
import {$} from 'execa'
import fetch from 'node-fetch'
import prettyBytes from 'pretty-bytes'
import ms from 'ms'

import {router, privateProcedure} from '../trpc.js'
import type Umbreld from '../../../../index.js'
import { getDiskUsage, getMemoryUsage, getCpuUsage } from '../../../system.js'

const MAX_ALLOWED_WIDGETS = 3

async function getStorageData(umbreld: Umbreld) {
	const {size, totalUsed} = await getDiskUsage(umbreld)

	return {
		type: 'stat-with-progress',
		link: '?dialog=live-usage',
		refresh: '30s',
		title: 'Storage',
		value: prettyBytes(totalUsed),
		progressLabel: `${prettyBytes(size - totalUsed)} left`,
		progress: ( totalUsed / size ).toFixed(2),
	}
}

async function getMemoryData(umbreld: Umbreld) {
	const {size, totalUsed} = await getMemoryUsage(umbreld)

	return {
		type: 'stat-with-progress',
		link: '?dialog=live-usage',
		refresh: '10s',
		title: 'Memory',
		value: prettyBytes(totalUsed),
		valueSub: prettyBytes(size),
		progressLabel: `${prettyBytes(size - totalUsed)} left`,
		progress: ( totalUsed / size ).toFixed(2),
	}
}

async function getSystemStats(umbreld: Umbreld) {
	const [cpuUsage, diskUsage, memoryUsage] = await Promise.all([
		getCpuUsage(umbreld),
		getDiskUsage(umbreld),
		getMemoryUsage(umbreld)
	]);

	const { totalUsed: cpuTotalUsed } = cpuUsage;
	const {size: diskSize, totalUsed: diskTotalUsed} = diskUsage;
	const {size: memorySize, totalUsed: memoryTotalUsed} = memoryUsage;

	return {
		type: 'three-up',
		link: '?dialog=live-usage',
		refresh: '10s',
		items: [
			{
				icon: 'system-widget-cpu',
				title: 'CPU',
				value: `${cpuTotalUsed.toPrecision(2)}%`,
			},
			{
				icon: 'system-widget-storage',
				title: 'Free',
				value: `${prettyBytes(diskSize - diskTotalUsed)}`,
			},
			{
				icon: 'system-widget-memory',
				title: 'Memory',
				value: `${prettyBytes(memorySize - memoryTotalUsed)}`,
			}
		]
	}
}

const systemWidgets = {
  storage: async function(umbreld: Umbreld) {
    const data = await getStorageData(umbreld)
    return data
  },
  memory: async function(umbreld: Umbreld) {
    const data = await getMemoryData(umbreld)
    return data
  },
	'system-stats': async function(umbreld: Umbreld) {
		const data = await getSystemStats(umbreld)
		return data
	}
}

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
			let widgetData: { [key: string]: any }

			if (appId === 'umbrel') {
				// This is a system widget
				if (!(widgetName in systemWidgets)) throw new Error(`No widget named ${widgetName} found in Umbrel system widgets`)
				widgetData = await systemWidgets[widgetName as keyof typeof systemWidgets](ctx.umbreld)
			} else {
				// This is an app widget
				// Get widget info from the app's manifest
				const widgetInfo = await ctx.apps.getApp(appId).getWidget(widgetName)
				
				// endpoint format: <service>:<port>/<api-endpoint>
				const {endpoint} = widgetInfo
				const [service, portAndEndpoint] = endpoint.split(':')

				// Retrieve the container name from the compose file
				// This works because we have a temporary patch to force all container names to the old Compose scheme to maintain compatibility between Compose v1 and v2
				const compose = await ctx.apps.getApp(appId).readCompose()
				const containerName = compose.services![service].container_name

				if (!containerName) throw new Error(`No container_name found for service ${service} in app ${appId}`)

				const {stdout: containerIp} = await $`docker inspect -f {{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}} ${containerName}`

				const url = `http://${containerIp}:${portAndEndpoint}`
	
				try {
					const response = await fetch(url)
					if (!response.ok) throw new Error(`Failed to fetch data from ${url}: ${response.statusText}`)
					widgetData = await response.json() as { [key: string]: any }
				} catch (error) {
					if (error instanceof Error) {
						throw new Error(`Failed to fetch data from ${url}: ${error.message}`)
					} else {
						throw new Error(`An unexpected error occured while fetching data from ${url}: ${error}`)
					}
				}
			}

			// Parse refresh time from human-readable string to milliseconds
			widgetData.refresh = ms(widgetData.refresh)

			return widgetData
		}),
})
