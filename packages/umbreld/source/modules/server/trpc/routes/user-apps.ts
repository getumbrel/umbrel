import {z} from 'zod'
import {indexBy, pick} from 'remeda'

import {privateProcedure, router} from '../trpc.js'
import {appStatuses, userAppsDemoStore} from '../../../user-apps.js'
import type {UserApp} from '../../../apps/schema.js'

export default router({
	install: privateProcedure
		.input(
			z.object({
				appId: z.string(),
				registryId: z.string().optional(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.userApps.installApp(input.appId, input.registryId)),

	getInstallStatus: privateProcedure
		.input(
			z.object({
				appId: z.string(),
			}),
		)
		.query(async ({ctx, input}) => ctx.userApps.getInstallStatus(input.appId)),

	// Returns the current user
	getAll: privateProcedure.query(async ({ctx}): Promise<UserApp[]> => {
		const registry = await ctx.appStore.registry()
		const registryApps = registry.flatMap((element) => element?.apps)
		const registryAppsKeyed = indexBy(registryApps, (element) => element?.id)

		const yamlApps = await ctx.userApps.getApps()

		const apps = yamlApps.map((app) => {
			// Assume demo store apps are always installed
			const demoStoreApp = userAppsDemoStore.find((a) => a?.id === app.id)!
			const userApp: UserApp = {
				...app,
				// TODO: don't assume registry never removes apps: `registryAppsKeyed[app.id]!`
				...pick(registryAppsKeyed[app.id]!, ['name', 'icon', 'port', 'version']),
				version: '0.1',
				...appStatuses[app.id],
				...pick(demoStoreApp, ['showNotifications', 'autoUpdate', 'showCredentialsBeforeOpen']),
				credentials: {
					defaultUsername: 'sdfsdf',
					defaultPassword: 'sdfsdf',
				},
			}
			return userApp
		})

		return apps

		// TODO: remove this
		// return [
		// 	...apps,
		// 	{
		// 		...pick(registryAppsKeyed['bitcoin'] ?? ({} as any), ['id', 'name', 'icon', 'port']),
		// 		registryId: 'umbrel-app-store',
		// 		showNotifications: true,
		// 		autoUpdate: true,
		// 		//
		// 		state: 'installed',
		// 		showCredentialsBeforeOpen: true,
		// 		credentials: {
		// 			defaultUsername: '',
		// 			defaultPassword: '',
		// 		},
		// 	},
		// 	{
		// 		...pick(registryAppsKeyed['lightning'] ?? ({} as any), ['id', 'name', 'icon', 'port']),
		// 		registryId: 'umbrel-app-store',
		// 		showNotifications: true,
		// 		autoUpdate: true,
		// 		//
		// 		state: 'installed',
		// 		showCredentialsBeforeOpen: true,
		// 		credentials: {
		// 			defaultUsername: '',
		// 			defaultPassword: '',
		// 		},
		// 	},
		// 	{
		// 		...pick(registryAppsKeyed['nostr-relay'] ?? ({} as any), ['id', 'name', 'icon', 'port']),
		// 		registryId: 'umbrel-app-store',
		// 		showNotifications: true,
		// 		autoUpdate: true,
		// 		//
		// 		state: 'installed',
		// 		showCredentialsBeforeOpen: true,
		// 		credentials: {
		// 			defaultUsername: '',
		// 			defaultPassword: '',
		// 		},
		// 	},
		// ]
	}),

	uninstall: privateProcedure
		.input(
			z.object({
				appId: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => {
			const registry = await ctx.appStore.registry()

			// Find widget endpoints
			const allApps = registry.flatMap((element) => element?.apps)
			// TODO: what if multiple apps have the same id but different `registryId`?
			const app = allApps?.find((app) => app?.id === input.appId)
			const widgetEndpoints = (app?.widgets ?? []).map((widget) => widget.endpoint)
			console.log({widgetEndpoints})

			// Remove widgets
			const widgets = (await ctx.user.get()).widgets ?? []
			const newWidgets = widgets.filter((widget) => !widgetEndpoints.includes(widget.endpoint))
			console.log({newWidgets})
			await ctx.user.setWidgets(newWidgets)

			await ctx.userApps.uninstallApp(input.appId)
			return true
		}),

	uninstallAll: privateProcedure.mutation(async ({ctx}) => {
		ctx.userApps.uninstallAll()
	}),

	getUninstallStatus: privateProcedure
		.input(
			z.object({
				appId: z.string(),
			}),
		)
		.query(async ({ctx, input}) => ctx.userApps.getInstallStatus(input.appId)),

	restart: privateProcedure
		.input(
			z.object({
				appId: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => {
			await ctx.userApps.restart(input.appId)
			return true
		}),

	update: privateProcedure
		.input(
			z.object({
				appId: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => {
			await ctx.userApps.update(input.appId)
			return true
		}),

	updateAll: privateProcedure.mutation(async ({ctx}) => {
		await ctx.userApps.updateAll()
		return true
	}),

	trackAppOpen: privateProcedure
		.input(
			z
				.object({
					appId: z.string(),
				})
				.strict(),
		)
		.mutation(async ({ctx, input}) => {
			await ctx.userApps.trackAppOpen(input.appId)

			return true
		}),

	set: privateProcedure
		.input(
			z
				.object({
					appId: z.string(),
					showCredentialsBeforeOpen: z.boolean().optional(),
					autoUpdate: z.boolean().optional(),
					showNotifications: z.boolean().optional(),
				})
				.strict(),
		)
		.mutation(async ({ctx, input}) => {
			const demoStoreApp = userAppsDemoStore.find((a) => a?.id === input.appId)!
			if (input.showCredentialsBeforeOpen !== undefined) {
				demoStoreApp.showCredentialsBeforeOpen = input.showCredentialsBeforeOpen
			}

			if (input.autoUpdate !== undefined) {
				demoStoreApp.autoUpdate = input.autoUpdate
			}

			if (input.showNotifications !== undefined) {
				demoStoreApp.showNotifications = input.showNotifications
			}

			return true
		}),
})
