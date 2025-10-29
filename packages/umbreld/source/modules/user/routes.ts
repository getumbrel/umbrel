import {TRPCError} from '@trpc/server'
import {z} from 'zod'

import {router, publicProcedure, privateProcedure} from '../server/trpc/trpc.js'
import * as totp from '../utilities/totp.js'

const ONE_SECOND = 1000
const ONE_MINUTE = 60 * ONE_SECOND
const ONE_HOUR = 60 * ONE_MINUTE
const ONE_DAY = 24 * ONE_HOUR
const ONE_WEEK = 7 * ONE_DAY

const DEFAULT_WALLPAPER = '18'

export default router({
	// Registers a new user
	register: publicProcedure
		.input(
			z.object({
				name: z.string(),
				password: z.string().min(6, 'Password must be at least 6 characters'),
				language: z.string().optional().default('en'),
			}),
		)
		.mutation(async ({ctx, input}) => {
			// Check the user hasn't already signed up
			if (await ctx.user.exists()) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: 'Attempted to register when user is already registered'})
			}

			// Register new user
			return ctx.user.register(input.name, input.password, input.language)
		}),

	// Public method to check if a user exists
	exists: publicProcedure.query(async ({ctx}) => ctx.user.exists()),

	// Given valid credentials returns a token for a user
	login: publicProcedure
		.input(
			z.object({
				password: z.string(),
				totpToken: z.string().optional(),
			}),
		)
		.mutation(async ({ctx, input}) => {
			if (!(await ctx.user.validatePassword(input.password))) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: 'Incorrect password'})
			}

			// 2FA
			if (await ctx.user.is2faEnabled()) {
				// Check we have a token
				if (!input.totpToken) {
					throw new TRPCError({code: 'UNAUTHORIZED', message: 'Missing 2FA code'})
				}

				// Verify the token
				if (!(await ctx.user.validate2faToken(input.totpToken))) {
					throw new TRPCError({code: 'UNAUTHORIZED', message: 'Incorrect 2FA code'})
				}
			}

			// At this point we have a valid login

			// Set proxy token cookie
			const proxyToken = await ctx.server.signProxyToken()
			const expires = new Date(Date.now() + ONE_WEEK)
			ctx.response!.cookie('UMBREL_PROXY_TOKEN', proxyToken, {
				httpOnly: true,
				expires,
				sameSite: 'lax',
			})

			// Return API token
			return ctx.server.signToken()
		}),

	// Checks if the request has a valid token
	isLoggedIn: publicProcedure.query(async ({ctx}) => {
		try {
			const token = ctx.request!.headers.authorization?.split(' ')[1]
			await ctx.server.verifyToken(token!)
			return true
		} catch {
			return false
		}
	}),

	// Returns a new token for a user
	renewToken: privateProcedure.mutation(async ({ctx}) => {
		// Renew proxy token cookie
		const proxyToken = await ctx.server.signProxyToken()
		const expires = new Date(Date.now() + ONE_WEEK)
		ctx.response!.cookie('UMBREL_PROXY_TOKEN', proxyToken, {
			httpOnly: true,
			expires,
			sameSite: 'lax',
		})

		// Return API token
		return ctx.server.signToken()
	}),

	// Deletes the proxy token cookie
	// The JWT needs to be deleted from the client side
	logout: privateProcedure.mutation(async ({ctx}) => {
		ctx.response!.clearCookie('UMBREL_PROXY_TOKEN')

		// Return API token
		return true
	}),

	// Change the user's password
	changePassword: privateProcedure
		.input(
			z.object({
				oldPassword: z.string(),
				newPassword: z.string().min(6, 'Password must be at least 6 characters'),
			}),
		)
		.mutation(async ({ctx, input}) => {
			// Validate old password
			if (!(await ctx.user.validatePassword(input.oldPassword))) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: 'Incorrect password'})
			}
			return ctx.user.setPassword(input.newPassword)
		}),

	// Generates a new random 2FA TOTP URI
	generateTotpUri: privateProcedure.query(async () => totp.generateUri('Umbrel', 'umbrel.local')),

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
			if (await ctx.user.is2faEnabled()) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: '2FA is already enabled'})
			}

			// Verify the token
			if (!totp.verify(input.totpUri, input.totpToken)) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: 'Incorrect 2FA code'})
			}

			// Save URI
			return ctx.user.enable2fa(input.totpUri)
		}),

	is2faEnabled: publicProcedure.query(async ({ctx}) => ctx.user.is2faEnabled()),

	// Disables 2FA
	disable2fa: privateProcedure
		.input(
			z.object({
				totpToken: z.string(),
			}),
		)
		.mutation(async ({ctx, input}) => {
			// Check if 2FA is already enabled
			if (!(await ctx.user.is2faEnabled())) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: '2FA is not enabled'})
			}

			// Verify the token
			if (!(await ctx.user.validate2faToken(input.totpToken))) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: 'Incorrect 2FA code'})
			}

			// Delete the URI
			return ctx.user.disable2fa()
		}),

	// Returns the current user
	get: privateProcedure.query(async ({ctx}) => {
		const user = await ctx.user.get()

		if (user.wallpaper === undefined) {
			user.wallpaper = DEFAULT_WALLPAPER
		}

		// Only return non sensitive data
		return {
			name: user.name,
			wallpaper: user.wallpaper,
			language: user.language,
			temperatureUnit: user.temperatureUnit,
		}
	}),

	// Sets whitelisted properties on the user object
	set: privateProcedure
		.input(
			z
				.object({
					name: z.string().optional(),
					wallpaper: z.string().optional(),
					language: z.string().optional(),
					temperatureUnit: z.string().optional(),
				})
				.strict(),
		)
		.mutation(async ({ctx, input}) => {
			if (input.name) await ctx.user.setName(input.name)
			if (input.wallpaper) await ctx.user.setWallpaper(input.wallpaper)
			if (input.language) await ctx.user.setLanguage(input.language)
			if (input.temperatureUnit) await ctx.user.setTemperatureUnit(input.temperatureUnit)

			return true
		}),

	// Returns the users wallpaper
	// This endpoint is public so it can be shown on the login screen
	wallpaper: publicProcedure.query(async ({ctx}) => {
		const user = await ctx.user.get()
		return user?.wallpaper ?? DEFAULT_WALLPAPER
	}),

	// Returns the preferred language, if any
	// This endpoint is public so it can be used on the login screen
	language: publicProcedure.query(async ({ctx}) => {
		const user = await ctx.user.get()
		return user?.language ?? null
	}),
})
