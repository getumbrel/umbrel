import z from 'zod'

import {router, privateProcedure} from '../trpc.js'

import {type AppState} from '../../../apps/schema.js'

export default router({
	// List all apps
	list: privateProcedure.query(async ({ctx}) => {
		const apps = await ctx.apps.getApps()

		// TODO: Handle errors so one bad app doesn't break the whole response
		const appData = await Promise.all(
			apps.map(async (app) => {
				const {name, icon, port} = await app.readManifest()
				return {
					id: app.id,
					name,
					icon,
					port,
					state: 'ready' as AppState,
					credentials: {
						defaultUsername: '',
						defaultPassword: '',
					},
					hiddenService: 'blah.onion',
				}
			}),
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

	// Get state
	// Temporarily used for polling the state of app mutations until we implement subscriptions
	state: privateProcedure
		.input(
			z.object({
				appId: z.string(),
			}),
		)
		.query(() => ({
			state: 'installing' as AppState,
			progress: 0.5,
		})),

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

	recentlyOpened: privateProcedure.query(() => []),

	setTorEnabled: privateProcedure.input(z.boolean()).mutation(({ctx, input}) => ctx.apps.setTorEnabled(input)),
	getTorEnabled: privateProcedure.query(({ctx}) => ctx.apps.getTorEnabled()),
})
