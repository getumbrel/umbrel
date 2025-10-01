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
			bookmarks: user.bookmarks || [],
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

	// Get user bookmarks
	bookmarks: privateProcedure.query(async ({ctx}) => {
		return ctx.user.getBookmarks()
	}),

	// Add a bookmark
	addBookmark: privateProcedure
		.input(
			z.object({
				id: z.string(),
				name: z.string(),
				url: z.string().url(),
				openInNewTab: z.boolean(),
				icon: z.string().optional(),
			}),
		)
		.mutation(async ({ctx, input}) => {
			const bookmarks = await ctx.user.getBookmarks()
			bookmarks.push(input)
			await ctx.user.setBookmarks(bookmarks)
			return true
		}),

	// Update a bookmark
	updateBookmark: privateProcedure
		.input(
			z.object({
				id: z.string(),
				name: z.string(),
				url: z.string().url(),
				openInNewTab: z.boolean(),
				icon: z.string().optional(),
			}),
		)
		.mutation(async ({ctx, input}) => {
			const bookmarks = await ctx.user.getBookmarks()
			const index = bookmarks.findIndex((b: any) => b.id === input.id)
			if (index === -1) {
				throw new TRPCError({code: 'NOT_FOUND', message: 'Bookmark not found'})
			}
			bookmarks[index] = input
			await ctx.user.setBookmarks(bookmarks)
			return true
		}),

	// Delete a bookmark
	deleteBookmark: privateProcedure.input(z.object({id: z.string()})).mutation(async ({ctx, input}) => {
		const bookmarks = await ctx.user.getBookmarks()
		const filtered = bookmarks.filter((b: any) => b.id !== input.id)
		await ctx.user.setBookmarks(filtered)
		return true
	}),

	// Proxy favicon request to avoid CORS issues
	getFavicon: privateProcedure.input(z.object({domain: z.string()})).query(async ({input}) => {
		try {
			const url = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(input.domain)}&sz=128`
			const response = await fetch(url)
			const buffer = await response.arrayBuffer()
			const base64 = Buffer.from(buffer).toString('base64')
			const contentType = response.headers.get('content-type') || 'image/png'
			return `data:${contentType};base64,${base64}`
		} catch (error) {
			throw new TRPCError({code: 'INTERNAL_SERVER_ERROR', message: 'Failed to fetch favicon'})
		}
	}),

	// Fetch page title from URL
	getPageTitle: privateProcedure.input(z.object({url: z.string().url()})).query(async ({input}) => {
		try {
			const url = new URL(input.url)
			
			// Prevent fetching local/internal URLs
			const hostname = url.hostname.toLowerCase()
			if (
				hostname === 'localhost' ||
				hostname === '127.0.0.1' ||
				hostname === '::1' ||
				hostname.endsWith('.local') ||
				hostname.startsWith('192.168.') ||
				hostname.startsWith('10.') ||
				hostname.startsWith('172.16.') ||
				hostname.startsWith('172.17.') ||
				hostname.startsWith('172.18.') ||
				hostname.startsWith('172.19.') ||
				hostname.startsWith('172.20.') ||
				hostname.startsWith('172.21.') ||
				hostname.startsWith('172.22.') ||
				hostname.startsWith('172.23.') ||
				hostname.startsWith('172.24.') ||
				hostname.startsWith('172.25.') ||
				hostname.startsWith('172.26.') ||
				hostname.startsWith('172.27.') ||
				hostname.startsWith('172.28.') ||
				hostname.startsWith('172.29.') ||
				hostname.startsWith('172.30.') ||
				hostname.startsWith('172.31.')
			) {
				return null
			}

			const response = await fetch(input.url, {
				method: 'GET',
				redirect: 'follow',
				headers: {
					'User-Agent': 'Mozilla/5.0 (compatible; UmbrelOS/1.0)',
				},
			})
			const html = await response.text()
			
			// Extract title from HTML using regex
			const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
			if (titleMatch && titleMatch[1]) {
				// Decode HTML entities and trim
				return titleMatch[1].trim()
			}
			
			return null
		} catch (error) {
			// Return null instead of throwing to handle errors gracefully
			return null
		}
	}),
})
