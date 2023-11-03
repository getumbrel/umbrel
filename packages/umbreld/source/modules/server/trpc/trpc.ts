import {ZodError} from 'zod'
import {initTRPC} from '@trpc/server'

import {type Context} from './context.js'
import {isAuthenticated} from './is-authenticated.js'

export const t = initTRPC.context<Context>().create({
	// https://trpc.io/docs/server/error-formatting#adding-custom-formatting
	errorFormatter(opts) {
		const {shape, error} = opts
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
export const publicProcedure = t.procedure
export const privateProcedure = t.procedure.use(isAuthenticated)
