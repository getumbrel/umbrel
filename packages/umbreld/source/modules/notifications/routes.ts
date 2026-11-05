import {z} from 'zod'

import {privateProcedureWithMembers, router} from '../server/trpc/trpc.ts'
import {OWNER_USER_ID} from '../user/constants.ts'

export default router({
	// Gets all notifications
	get: privateProcedureWithMembers.query(async ({ctx}) =>
		ctx.umbreld.notifications.getForAccount(ctx.principal?.accountId ?? OWNER_USER_ID),
	),

	// Removes a notification
	clear: privateProcedureWithMembers
		.input(z.string())
		.mutation(async ({ctx, input}) =>
			ctx.umbreld.notifications.clearVisibleForAccount(ctx.principal?.accountId ?? OWNER_USER_ID, input),
		),
})
