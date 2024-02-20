import z from 'zod'

import {router, privateProcedure} from '../trpc.js'

export default router({
	// List all apps
	list: privateProcedure.query(async ({ctx}) => {
		const apps = ctx.apps.instances

		const appData = await Promise.all(
			apps.map(async (app) => {
				try {
					const {name, version, icon, port, path, widgets} = await app.readManifest()
					return {
						id: app.id,
						name,
						version,
						icon: icon ?? `https://getumbrel.github.io/umbrel-apps-gallery/${app.id}/icon.svg`,
						port,
						path,
						state: app.state,
						credentials: {
							defaultUsername: '',
							defaultPassword: '',
						},
						hiddenService: 'blah.onion', // TODO: Get hidden service
						widgets,
					}
				} catch (error) {
					ctx.apps.logger.error(`Failed to read manifest for app ${app.id}: ${(error as Error).message}`)
					return {id: app.id, error: (error as Error).message}
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
		.query(async ({ctx, input}) => {
			if (!(await ctx.apps.isInstalled(input.appId))) {
				return {
					state: 'not-installed' as const,
					progress: 0,
				}
			}

			const app = ctx.apps.getApp(input.appId)

			return {
				state: app.state,
				progress: app.stateProgress,
			} as const
		}),

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
