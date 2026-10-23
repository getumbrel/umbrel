import {initTRPC} from '@trpc/server'
import {ZodError} from 'zod'

import {type Context} from './context.ts'
import {
	isAuthenticated,
	isAuthenticatedIfUserExists,
	isAuthenticatedIfUserExistsAllowingMembers,
	isOwner,
} from './is-authenticated.ts'
import {websocketLogger} from './websocket-logger.ts'

export const t = initTRPC.context<Context>().create({
	// TODO: Add more context on why this is needed
	// https://trpc.io/docs/server/error-formatting#adding-custom-formatting
	errorFormatter(options) {
		const {shape, error} = options
		return {
			...shape,
			data: {
				...shape.data,
				zodError: error.code === 'BAD_REQUEST' && error.cause instanceof ZodError ? error.cause.flatten() : null,
			},
		}
	},
})
export const router = t.router
const baseProcedure = t.procedure.use(websocketLogger)
export const publicProcedure = baseProcedure
export const accountProcedure = baseProcedure.use(isAuthenticated)
export const ownerProcedure = baseProcedure.use(isOwner)
// Existing authenticated procedures remain owner-only. Member-capable routes
// opt in explicitly so the account-access surface remains easy to audit.
export const privateProcedure = ownerProcedure
export const privateProcedureWithMembers = accountProcedure
// Use this procedure type sparingly, it's for exposing endpoints that usually need authentication but
// may need to be used before a user is registered when a token can't exist. We shouldn't use it for
// everything because there could be edgecases where it gets applied like if the user file is corrupted.
export const publicProcedureWhenNoUserExists = baseProcedure.use(isAuthenticatedIfUserExists)
export const publicProcedureWhenNoUserExistsWithMembers = baseProcedure.use(isAuthenticatedIfUserExistsAllowingMembers)
