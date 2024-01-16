import z from 'zod'

import {router, privateProcedure} from '../trpc.js'

export default router({
	// Add a repository to the app store
	install: privateProcedure
		.input(
			z.object({
				appId: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.apps.install(input.appId)),
})
