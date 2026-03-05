import {z} from 'zod'

import {router, privateProcedure} from '../server/trpc/trpc.js'

export default router({
	// Gets all notifications
	get: privateProcedure.query(async ({ctx}) => ctx.umbreld.notifications.get()),

	// Removes a notification
	clear: privateProcedure.input(z.string()).mutation(async ({ctx, input}) => ctx.umbreld.notifications.clear(input)),
})
