import {TRPCError} from '@trpc/server'
import {z} from 'zod'
import bcrypt from 'bcryptjs'
import * as jwt from '../../jwt.js'

import {router, publicProcedure, privateProcedure} from '../trpc.js'

export default router({
	register: publicProcedure
		.input(
			z.object({
				username: z.string(),
				password: z.string().min(6, 'Password must be atleast 6 characters'),
			}),
		)
		.mutation(async ({ctx, input}) => {
			// Check the user hasn't already signed up
			const {name: existingUser} = await ctx.umbreld.store.get()
			if (existingUser !== undefined) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: 'Attempted to register when user is already registered'})
			}

			// Hash the password with the current recommended default
			// of 10 bcrypt rounds
			// https://security.stackexchange.com/a/83382
			const saltRounds = 10
			const hashedPassword = await bcrypt.hash(input.password, saltRounds)

			// Save the user
			await ctx.umbreld.store.set('name', input.username)
			await ctx.umbreld.store.set('password', hashedPassword)

			return true
		}),

	login: publicProcedure
		.input(
			z.object({
				password: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => {
			// Get hashed password
			const {password: hashedPassword} = await ctx.umbreld.store.get()

			// Validate credentials
			const validPassword = hashedPassword && (await bcrypt.compare(input.password, hashedPassword))
			if (!validPassword) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: 'Invalid login'})
			}

			// TODO: 2FA

			// Return token
			return ctx.server.signToken()
		}),

	renewToken: privateProcedure.mutation(async ({ctx}) => ctx.server.signToken()),
})
