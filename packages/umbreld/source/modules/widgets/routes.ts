import z from 'zod'
import ms from 'ms'

import type Umbreld from '../../index.ts'
import {router, privateProcedureWithMembers} from '../server/trpc/trpc.ts'
import {OWNER_USER_ID} from '../user/constants.ts'
import {DEFAULT_WIDGETS} from '../user/user.ts'
import {systemWidgets} from '../system/system-widgets.ts'
import {filesWidgets} from '../files/widgets.ts'

const MAX_ALLOWED_WIDGETS = 3

const umbrelWidgets = {...systemWidgets, ...filesWidgets}

// Splits a widgetId into appId and widgetName
// e.g., "transmission:status" => { appId: "transmission", widgetName: "status" }
function splitWidgetId(widgetId: string) {
	const [appId, widgetName] = widgetId.split(':')

	return {appId, widgetName}
}

// Build a predicate for which widgets an account may use. Umbrel widgets are
// open to everyone, app widgets only to the owner and members the app is
// shared with. The share lookup happens once here so the predicate can run
// synchronously inside the store write lock.
async function widgetFilterFor(umbreld: Umbreld, accountId: string): Promise<(widgetId: string) => boolean> {
	if (accountId === OWNER_USER_ID) return () => true
	const sharedAppIds = new Set(await umbreld.apps.sharedAppIdsForUser(accountId))
	return (widgetId) => {
		const {appId} = splitWidgetId(widgetId)
		return appId === 'umbrel' || sharedAppIds.has(appId)
	}
}

// Resolve an account's enabled widgets from its stored value. An account
// that has never changed its widgets gets the defaults, and members lose
// widgets for apps no longer shared with them, without persisting either.
// Stored state only changes when the account explicitly enables or disables
// a widget.
function resolveWidgets(stored: string[] | undefined, isAllowed: (widgetId: string) => boolean) {
	return (stored ?? DEFAULT_WIDGETS).filter(isAllowed)
}

export default router({
	// List enabled widgets for the current account
	enabled: privateProcedureWithMembers.query(async ({ctx}) => {
		const accountId = ctx.principal!.accountId
		const isAllowed = await widgetFilterFor(ctx.umbreld, accountId)
		return resolveWidgets(await ctx.umbreld.user.getAccountWidgets(accountId), isAllowed)
	}),

	// Enable widget
	enable: privateProcedureWithMembers
		.input(
			z.object({
				widgetId: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => {
			const accountId = ctx.principal!.accountId
			const {appId, widgetName} = splitWidgetId(input.widgetId)
			const isAllowed = await widgetFilterFor(ctx.umbreld, accountId)

			// Validate widget
			if (appId === 'umbrel') {
				// This is an Umbrel widget
				if (!(widgetName in umbrelWidgets)) throw new Error(`No widget named ${widgetName} found in Umbrel widgets`)
			} else {
				// This is an app widget, members can only enable widgets of apps shared with them
				if (!isAllowed(input.widgetId)) throw new Error('[widget-not-found]')
				// Throws an error if the widget doesn't exist
				await ctx.apps.getApp(appId).getWidgetMetadata(widgetName)
			}

			// Save widget ID
			await ctx.umbreld.user.updateAccountWidgets(accountId, (stored) => {
				const current = resolveWidgets(stored, isAllowed)

				// Check if widget is already active
				if (current.includes(input.widgetId)) throw new Error(`Widget ${input.widgetId} is already enabled`)

				// Check we don't have more than 3 widgets enabled
				if (current.length >= MAX_ALLOWED_WIDGETS)
					throw new Error(`The maximum number of widgets (${MAX_ALLOWED_WIDGETS}) has already been enabled`)

				return [...current, input.widgetId]
			})

			return true
		}),

	// Disable widget
	disable: privateProcedureWithMembers
		.input(
			z.object({
				widgetId: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => {
			const accountId = ctx.principal!.accountId
			const isAllowed = await widgetFilterFor(ctx.umbreld, accountId)

			// Remove widget ID
			await ctx.umbreld.user.updateAccountWidgets(accountId, (stored) => {
				const current = resolveWidgets(stored, isAllowed)

				// Check if widget is currently enabled
				if (!current.includes(input.widgetId)) throw new Error(`Widget ${input.widgetId} is not enabled`)

				// Remove widget
				return current.filter((widget) => widget !== input.widgetId)
			})

			return true
		}),

	// Get live data for a widget
	data: privateProcedureWithMembers
		.input(
			z.object({
				widgetId: z.string(),
			}),
		)
		.query(async ({ctx, input}) => {
			const {appId, widgetName} = splitWidgetId(input.widgetId)
			const accountId = ctx.principal!.accountId
			let widgetData: {[key: string]: any}

			if (appId === 'umbrel') {
				// This is an Umbrel widget
				if (!(widgetName in umbrelWidgets)) throw new Error(`No widget named ${widgetName} found in Umbrel widgets`)

				if (widgetName in filesWidgets) {
					widgetData = await filesWidgets[widgetName as keyof typeof filesWidgets](ctx.umbreld, accountId)
				} else {
					widgetData = await systemWidgets[widgetName as keyof typeof systemWidgets](ctx.umbreld)
				}
			} else {
				// This is an app widget
				if (accountId !== OWNER_USER_ID && !(await ctx.umbreld.apps.sharedAppIdsForUser(accountId)).includes(appId)) {
					throw new Error('[widget-not-found]')
				}
				widgetData = await ctx.apps.getApp(appId).getWidgetData(widgetName)
			}

			// Parse refresh time from human-readable string to milliseconds
			widgetData.refresh = ms(widgetData.refresh)

			return widgetData
		}),
})
