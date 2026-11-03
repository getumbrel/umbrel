import {TRPCError} from '@trpc/server'

import {OWNER_ACCOUNT_ID, type Principal} from '../../auth/auth.ts'
import {browserSessionTokenFromRequest} from '../../auth/browser-session-cookie.ts'
import {type Context} from './context.ts'

type MiddlewareOptions = {
	ctx: Context
	next: (options?: {ctx: {principal: Principal}}) => Promise<any>
}

const authenticate = async (ctx: Context) => {
	try {
		const [scheme, token] = ctx.request?.headers.authorization?.split(' ') ?? []
		if (scheme?.toLowerCase() !== 'bearer' || !token || !ctx.request) throw new Error('Missing token')
		return await ctx.umbreld.auth.authenticateApiCredentials(token, browserSessionTokenFromRequest(ctx.request))
	} catch (error) {
		ctx.logger.error('Failed to verify token', error)
		throw new TRPCError({code: 'UNAUTHORIZED', message: 'Invalid token'})
	}
}

// Any authenticated account (the owner or a member). This is the explicit
// opt-in for endpoints members may use.
export const isAuthenticated = async ({ctx, next}: MiddlewareOptions) => {
	if (ctx.dangerouslyBypassAuthentication === true) {
		return next({ctx: {principal: {sessionId: 'system', accountId: OWNER_ACCOUNT_ID, actor: 'system'}}})
	}

	if (ctx.transport === 'ws') {
		if (!ctx.principal) throw new TRPCError({code: 'UNAUTHORIZED', message: 'Invalid token'})
		await ctx.umbreld.auth.validatePrincipal(ctx.principal).catch(() => {
			throw new TRPCError({code: 'UNAUTHORIZED', message: 'Invalid token'})
		})
		return next({ctx: {principal: ctx.principal}})
	}

	return next({ctx: {principal: await authenticate(ctx)}})
}

// Device-management procedures are owner-only by default.
export const isOwner = async ({ctx, next}: MiddlewareOptions) => {
	let principal: Principal
	if (ctx.dangerouslyBypassAuthentication === true) {
		principal = {sessionId: 'system', accountId: OWNER_ACCOUNT_ID, actor: 'system'}
	} else if (ctx.transport === 'ws') {
		if (!ctx.principal) throw new TRPCError({code: 'UNAUTHORIZED', message: 'Invalid token'})
		await ctx.umbreld.auth.validatePrincipal(ctx.principal).catch(() => {
			throw new TRPCError({code: 'UNAUTHORIZED', message: 'Invalid token'})
		})
		principal = ctx.principal
	} else {
		principal = await authenticate(ctx)
	}

	if (principal.accountId !== OWNER_ACCOUNT_ID) {
		throw new TRPCError({code: 'FORBIDDEN', message: 'This action can only be performed by the owner'})
	}
	return next({ctx: {principal}})
}

export const isAuthenticatedIfUserExists = async ({ctx, next}: MiddlewareOptions) => {
	if (!(await ctx.user.exists())) return next()
	return isOwner({ctx, next})
}

// Used by account-scoped file procedures that must also work before the owner
// exists, such as restore during onboarding.
export const isAuthenticatedIfUserExistsAllowingMembers = async ({ctx, next}: MiddlewareOptions) => {
	if (!(await ctx.user.exists())) return next()
	return isAuthenticated({ctx, next})
}
