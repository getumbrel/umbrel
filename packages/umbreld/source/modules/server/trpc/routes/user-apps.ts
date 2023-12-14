import {z} from 'zod'

import {privateProcedure, router} from '../trpc.js'
import {indexBy, pick} from 'remeda'
import {UserApp} from '../../../apps/schema.js'
import {appStatuses} from '../../../user-apps.js'

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
		const registryApps = registry.flatMap((el) => el?.apps)
		const registryAppsKeyed = indexBy(registryApps, (el) => el?.id)

		const yamlApps = await ctx.userApps.getApps()

		const apps = yamlApps.map((app) => {
			const userApp: UserApp = {
				...app,
				// TODO: don't assume registry never removes apps: `registryAppsKeyed[app.id]!`
				...pick(registryAppsKeyed[app.id]!, ['name', 'icon', 'port']),
				...appStatuses[app.id],
				credentials: {
					defaultUsername: '',
					defaultPassword: '',
				},
			}
			return userApp
		})

		return apps

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
				registryId: z.string().optional(),
			}),
		)
		.mutation(async ({ctx, input}) => {
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
})
