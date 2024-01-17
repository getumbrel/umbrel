import z from 'zod'

import {router, privateProcedure} from '../trpc.js'

export default router({
	// List all apps
	list: privateProcedure.query(async ({ctx}) => {
		const apps = await ctx.apps.getApps()

		// TODO: Handle errors so one bad app doesn't break the whole response
		const appData = await Promise.all(
			apps.map(async (app) => ({
				id: app.id,
				manifest: await app.readManifest(),
				status: {
					state: 'running',
					progress: 1,
				},
				lastOpened: 1_705_477_545_462,
			})),
		)

		return appData
	}),

	// Install an app
	install: privateProcedure
		.input(
			z.object({
				appId: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.apps.install(input.appId)),

	// Uninstall an app
	uninstall: privateProcedure
		.input(
			z.object({
				appId: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.apps.uninstall(input.appId)),

	// Restart an app
	restart: privateProcedure
		.input(
			z.object({
				appId: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.apps.restart(input.appId)),

	// Update an app
	update: privateProcedure
		.input(
			z.object({
				appId: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.apps.update(input.appId)),

	trackOpen: privateProcedure
		.input(
			z.object({
				appId: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.apps.trackOpen(input.appId)),
})
