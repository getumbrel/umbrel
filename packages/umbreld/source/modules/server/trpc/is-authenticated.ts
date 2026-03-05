import {TRPCError} from '@trpc/server'

import {type Context} from './context.js'

type MiddlewareOptions = {
	ctx: Context
	next: () => Promise<any>
}

export const isAuthenticated = async ({ctx, next}: MiddlewareOptions) => {
	if (ctx.dangerouslyBypassAuthentication === true) return next()

	// Bypass authentication for websocket requests since auth is handled
	// on connection by express.
	if (ctx.transport === 'ws') return next()

	try {
		const token = ctx.request?.headers.authorization?.split(' ')[1]
		if (token === undefined) throw new Error('Missing token')
		await ctx.server.verifyToken(token)
	} catch (error) {
		ctx.logger.error('Failed to verify token', error)
		throw new TRPCError({code: 'UNAUTHORIZED', message: 'Invalid token'})
	}

	return next()
}

export const isAuthenticatedIfUserExists = async ({ctx, next}: MiddlewareOptions) => {
	// Allow request through if user has not yet been registered
	const userExists = await ctx.user.exists()
	if (!userExists) {
		return next()
	}

	// If a user exists, follow usual authentication flow
	return isAuthenticated({ctx, next})
}
