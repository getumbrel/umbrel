import {TRPCError} from '@trpc/server'
import jwt from 'jsonwebtoken'
import fse from 'fs-extra'

import {type Context} from './context.js'

type IsAuthenticatedOptions = {
	ctx: Context
	next: () => Promise<any>
}

// TODO: Use the logger instead of console.log

export const isAuthenticated = async ({ctx, next}: IsAuthenticatedOptions) => {
	if (ctx.dangerouslyBypassAuthentication === true) {
		return next()
	}

	let secret
	try {
		secret = await fse.readFile(`${ctx.umbreld.dataDirectory}/jwt/jwt.key`)
	} catch (error) {
		console.log(error)
		throw new TRPCError({code: 'UNAUTHORIZED', message: 'No token secret'})
	}

	const token = ctx.request.headers.authorization?.split(' ')[1]
	if (token === undefined) {
		console.log('Missing token')
		throw new TRPCError({code: 'UNAUTHORIZED', message: 'Missing token'})
	}

	try {
		jwt.verify(token, secret, {algorithms: ['RS256']})
	} catch (error) {
		console.log(error)
		throw new TRPCError({code: 'UNAUTHORIZED', message: 'Invalid token'})
	}

	return next()
}
