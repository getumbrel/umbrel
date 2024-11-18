import z from 'zod'

import {router, privateProcedure} from '../trpc.js'

export default router({
	// List all apps
	list: privateProcedure.query(async ({ctx}) => {
		const apps = ctx.apps.instances
		const torEnabled = await ctx.umbreld.store.get('torEnabled')

		const appData = await Promise.all(
			apps.map(async (app) => {
				try {
					let [
						{
							name,
							version,
							icon,
							port,
							path,
							widgets,
							defaultUsername,
							defaultPassword,
							deterministicPassword,
							dependencies,
							implements: implements_,
							torOnly,
						},
						selectedDependencies,
					] = await Promise.all([app.readManifest(), app.getSelectedDependencies()])

					const hiddenService = torEnabled ? await app.readHiddenService() : ''
					if (deterministicPassword) {
						defaultPassword = await app.deriveDeterministicPassword()
					}
					const hasCredentials = !!defaultUsername || !!defaultPassword
					const showCredentialsBeforeOpen = hasCredentials && !(await app.store.get('hideCredentialsBeforeOpen'))
					return {
						id: app.id,
						name,
						version,
						icon: icon ?? `https://getumbrel.github.io/umbrel-apps-gallery/${app.id}/icon.svg`,
						port,
						path,
						state: app.state,
						credentials: {
							defaultUsername,
							defaultPassword,
							showBeforeOpen: showCredentialsBeforeOpen,
						},
						hiddenService,
						widgets,
						dependencies,
						selectedDependencies,
						implements: implements_,
						torOnly,
					}
				} catch (error) {
					ctx.apps.logger.error(`Failed to read manifest for app ${app.id}: ${(error as Error).message}`)
					return {id: app.id, error: (error as Error).message}
				}
			}),
		)

		const appDataSortedByNames = appData.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))

		return appDataSortedByNames
	}),

	// Install an app
	install: privateProcedure
		.input(
			z.object({
				appId: z.string(),
				alternatives: z.record(z.string()).optional(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.apps.install(input.appId, input.alternatives)),

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

	// Start an app
	start: privateProcedure
		.input(
			z.object({
				appId: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.apps.getApp(input.appId).start()),

	// Stop an app
	stop: privateProcedure
		.input(
			z.object({
				appId: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.apps.getApp(input.appId).stop()),

	// Update an app
	update: privateProcedure
		.input(
			z.object({
				appId: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.apps.update(input.appId)),

	// Update an app
	logs: privateProcedure
		.input(
			z.object({
				appId: z.string(),
			}),
		)
		.query(async ({ctx, input}) => ctx.apps.getApp(input.appId).getLogs()),

	trackOpen: privateProcedure
		.input(
			z.object({
				appId: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.apps.trackOpen(input.appId)),

	recentlyOpened: privateProcedure.query(({ctx}) => ctx.apps.recentlyOpened()),

	setTorEnabled: privateProcedure.input(z.boolean()).mutation(({ctx, input}) => ctx.apps.setTorEnabled(input)),
	getTorEnabled: privateProcedure.query(({ctx}) => ctx.apps.getTorEnabled()),

	setSelectedDependencies: privateProcedure
		.input(
			z.object({
				appId: z.string(),
				dependencies: z.record(z.string()),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.apps.setSelectedDependencies(input.appId, input.dependencies)),

	dependents: privateProcedure.input(z.string()).query(async ({ctx, input}) => ctx.apps.getDependents(input)),

	hideCredentialsBeforeOpen: privateProcedure
		.input(
			z.object({
				appId: z.string(),
				value: z.boolean(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.apps.setHideCredentialsBeforeOpen(input.appId, input.value)),
})
