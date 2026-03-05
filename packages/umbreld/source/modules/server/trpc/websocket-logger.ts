import {TRPCError} from '@trpc/server'

import {type Context} from './context.js'

type MiddlewareOptions = {
	ctx: Context
	path: string
	next: () => Promise<any>
}

export const websocketLogger = async ({ctx, path, next}: MiddlewareOptions) => {
	// Skip this middleware for non-websocket requests
	if (ctx.transport !== 'ws') return next()

	// Log the RPC call
	ctx.logger.verbose(`WS rpc ${path}`)

	return next()
}
