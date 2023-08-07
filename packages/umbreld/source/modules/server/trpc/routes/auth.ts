import {TRPCError} from '@trpc/server'
import {z} from 'zod'
import bcrypt from 'bcryptjs'

import {router, publicProcedure, privateProcedure} from '../trpc.js'
import * as totp from '../../../utilities/totp.js'

export default router({
	// Registers a new user
	register: publicProcedure
		.input(
			z.object({
				name: z.string(),
				password: z.string().min(6, 'Password must be atleast 6 characters'),
			}),
		)
		.mutation(async ({ctx, input}) => {
			// Check the user hasn't already signed up
			const existingUser = await ctx.umbreld.store.get('user')
			if (existingUser !== undefined) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: 'Attempted to register when user is already registered'})
			}

			// Hash the password with the current recommended default
			// of 10 bcrypt rounds
			// https://security.stackexchange.com/a/83382
			const saltRounds = 10
			const hashedPassword = await bcrypt.hash(input.password, saltRounds)

			// Save the user
			await ctx.umbreld.store.set('user', {
				name: input.name,
				hashedPassword,
			})

			return true
		}),

	// Given valid credentials returns a token for a user
	login: publicProcedure
		.input(
			z.object({
				password: z.string(),
				totpToken: z.string().optional(),
			}),
		)
		.mutation(async ({ctx, input}) => {
			// Get hashed password
			const hashedPassword = await ctx.umbreld.store.get('user.hashedPassword')

			// Validate credentials
			const validPassword = hashedPassword && (await bcrypt.compare(input.password, hashedPassword))
			if (!validPassword) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: 'Invalid login'})
			}

			// 2FA
			const totpUri = await ctx.umbreld.store.get('user.totpUri')
			if (totpUri) {
				// Check we have a token
				if (!input.totpToken) {
					throw new TRPCError({code: 'UNAUTHORIZED', message: 'Missing 2FA token'})
				}

				// Verify the token
				if (!totp.verify(totpUri, input.totpToken)) {
					throw new TRPCError({code: 'UNAUTHORIZED', message: 'Invalid 2FA token'})
				}
			}

			// Return token
			return ctx.server.signToken()
		}),

	// Returns a new token for a user
	renewToken: privateProcedure.mutation(async ({ctx}) => ctx.server.signToken()),

	// Generates a new random 2FA TOTP URI
	generateTotpUri: privateProcedure.query(async () => totp.generateUri('Umbrel', 'getumbrel.com')),

	// Enables 2FA
	enable2fa: privateProcedure
		.input(
			z.object({
				totpUri: z.string(),
				totpToken: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => {
			// Check if 2FA is already enabled
			const totpUri = await ctx.umbreld.store.get('user.totpUri')
			if (totpUri) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: '2FA is already enabled'})
			}

			// Verify the token
			if (!totp.verify(input.totpUri, input.totpToken)) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: 'Invalid 2FA token'})
			}

			// Save the URI
			await ctx.umbreld.store.set('user.totpUri', input.totpUri)

			return true
		}),

	// Disables 2FA
	disable2fa: privateProcedure
		.input(
			z.object({
				totpToken: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => {
			// Check if 2FA is already enabled
			const totpUri = await ctx.umbreld.store.get('user.totpUri')
			if (!totpUri) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: '2FA is not enabled'})
			}

			// Verify the token
			if (!totp.verify(totpUri, input.totpToken)) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: 'Invalid 2FA token'})
			}

			// Delete the URI
			await ctx.umbreld.store.delete('user.totpUri')

			return true
		}),
})
