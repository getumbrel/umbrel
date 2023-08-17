import {TRPCError} from '@trpc/server'

import {type Context} from './context.js'

type IsAuthenticatedOptions = {
	ctx: Context
	next: () => Promise<any>
}

export const isAuthenticated = async ({ctx, next}: IsAuthenticatedOptions) => {
	if (ctx.dangerouslyBypassAuthentication === true) {
		return next()
	}

	try {
		const token = ctx.request.headers.authorization?.split(' ')[1]
		if (token === undefined) throw new Error('Missing token')
		await ctx.server.verifyToken(token)
	} catch (error) {
		ctx.logger.error((error as Error).message)
		throw new TRPCError({code: 'UNAUTHORIZED', message: 'Invalid token'})
	}

	return next()
}
