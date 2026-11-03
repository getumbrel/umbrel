import {TRPCError} from '@trpc/server'
import {z} from 'zod'

import {appGatewayTokenFromRequest, clearAppGatewayCookies, setAppGatewayCookie} from '../auth/app-gateway-cookie.ts'
import {
	BrowserSessionRequiredError,
	InvalidNativeDeviceCredentialError,
	OWNER_ACCOUNT_ID,
	SessionIssuanceInvalidatedError,
} from '../auth/auth.ts'
import {
	browserSessionTokenFromRequest,
	clearBrowserSessionCookies,
	setBrowserSessionCookie,
} from '../auth/browser-session-cookie.ts'
import {nativeClientSchema} from '../auth/native-client.ts'
import * as totp from '../utilities/totp.ts'
import type {Context} from '../server/trpc/context.ts'
import {privateProcedure, privateProcedureWithMembers, publicProcedure, router} from '../server/trpc/trpc.ts'
import {accountAvatarUrl, serializeAccountAvatar} from './avatar-api.ts'
import {OWNER_USER_ID} from './constants.ts'
import type {AccountLoginValidation} from './user.ts'
import {isWallpaperId, resolveWallpaperAppearance} from './wallpapers.ts'

const loginErrorMessage = (reason: Extract<AccountLoginValidation, {valid: false}>['reason']) => {
	if (reason === 'missing-totp') return 'Missing 2FA code'
	if (reason === 'incorrect-totp') return 'Incorrect 2FA code'
	return 'Incorrect password'
}

// Public cosmetic endpoints are used both before login and from authenticated
// settings screens. Resolve a valid account when credentials are available,
// otherwise fall back to the owner. This must never be used for authorization.
async function resolveOptionalAccountId(ctx: Context): Promise<string> {
	try {
		if (ctx.transport === 'ws' && ctx.principal) {
			await ctx.umbreld.auth.validatePrincipal(ctx.principal)
			return ctx.principal.accountId
		}

		if (ctx.request) {
			const [scheme, token] = ctx.request.headers.authorization?.split(' ') ?? []
			if (scheme?.toLowerCase() === 'bearer' && token) {
				const principal = await ctx.umbreld.auth.authenticateApiCredentials(
					token,
					browserSessionTokenFromRequest(ctx.request),
				)
				return principal.accountId
			}
		}
	} catch {}

	return OWNER_ACCOUNT_ID
}

export default router({
	register: publicProcedure
		.input(
			z.object({
				name: z.string(),
				password: z.string().min(6, 'Password must be at least 6 characters'),
				language: z.string().optional().default('en'),
				// Currently unused
				raidDevices: z.array(z.string()).optional(),
				raidType: z.enum(['storage', 'failsafe']).optional(),
				acceleratorDevices: z.array(z.string()).optional(),
			}),
		)
		.mutation(async ({ctx, input}) => {
			if (await ctx.user.exists()) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: 'Attempted to register when user is already registered'})
			}

			const isUmbrelPro = await ctx.umbreld.hardware.umbrelPro.isUmbrelPro()
			const hasRaidDetails = input.raidType && input.raidDevices && input.raidDevices.length > 0
			if (isUmbrelPro && !hasRaidDetails) {
				throw new TRPCError({code: 'BAD_REQUEST', message: 'RAID devices are required for Umbrel Pro'})
			}
			if (hasRaidDetails) {
				await ctx.umbreld.hardware.raid.triggerInitialRaidSetupBootFlow(
					input.raidDevices!,
					input.raidType!,
					input.acceleratorDevices,
					{name: input.name, password: input.password, language: input.language},
				)
				return true
			}

			return ctx.user.register(input.name, input.password, input.language)
		}),

	exists: publicProcedure.query(async ({ctx}) => ctx.user.exists()),

	// Public so the login and app-auth account pickers can render before auth.
	listAccounts: publicProcedure.query(async ({ctx}) => {
		if (!(await ctx.user.exists())) return []
		return (await ctx.user.listAccounts()).map((account) => ({
			...serializeAccountAvatar(account),
			wallpaper: resolveWallpaperAppearance(account.wallpaper),
		}))
	}),

	login: publicProcedure
		.input(
			z.object({
				userId: z.string().default(OWNER_USER_ID),
				password: z.string(),
				totpToken: z.string().optional(),
			}),
		)
		.mutation(async ({ctx, input}) => {
			if (!ctx.request || !ctx.response) {
				throw new TRPCError({code: 'METHOD_NOT_SUPPORTED', message: 'HTTP transport required'})
			}
			const validation = await ctx.user.validateAccountLogin(input.userId, input.password, input.totpToken)
			if (!validation.valid) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: loginErrorMessage(validation.reason)})
			}

			const session = await ctx.umbreld.auth
				.createSession({
					accountId: input.userId,
					userAgent: ctx.request!.get('user-agent'),
					expectedSessionIssuanceRevision: validation.sessionIssuanceRevision,
				})
				.catch((error) => {
					if (error instanceof SessionIssuanceInvalidatedError) {
						throw new TRPCError({code: 'UNAUTHORIZED', message: error.message})
					}
					throw error
				})
			setAppGatewayCookie(ctx.response!, ctx.request!, session.appGatewayToken, new Date(session.expiresAt))
			setBrowserSessionCookie(ctx.response!, ctx.request!, session.browserSessionToken, new Date(session.expiresAt))
			return session.dashboardToken
		}),

	loginNative: publicProcedure
		.input(
			z.object({
				userId: z.string().default(OWNER_USER_ID),
				password: z.string(),
				totpToken: z.string().optional(),
				client: nativeClientSchema,
			}),
		)
		.mutation(async ({ctx, input}) => {
			if (!ctx.request || !ctx.response) {
				throw new TRPCError({code: 'METHOD_NOT_SUPPORTED', message: 'HTTP transport required'})
			}
			const validation = await ctx.user.validateAccountLogin(input.userId, input.password, input.totpToken)
			if (!validation.valid) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: loginErrorMessage(validation.reason)})
			}

			const session = await ctx.umbreld.auth
				.createNativeSession({
					accountId: input.userId,
					nativeClient: input.client,
					userAgent: ctx.request!.get('user-agent'),
					expectedSessionIssuanceRevision: validation.sessionIssuanceRevision,
				})
				.catch((error) => {
					if (error instanceof SessionIssuanceInvalidatedError) {
						throw new TRPCError({code: 'UNAUTHORIZED', message: error.message})
					}
					throw error
				})
			ctx.response!.set('Cache-Control', 'no-store')
			return {
				// Native clients persist this server-authenticated account id with the
				// session. Device-local state must never be shared merely because two
				// accounts connect to the same physical Umbrel.
				accountId: session.principal.accountId,
				accessToken: session.accessToken,
				accessExpiresAt: session.accessExpiresAt,
				deviceToken: session.deviceToken,
			}
		}),

	// The device credential is accepted only by this exchange. It remains stable so
	// a lost response can be retried without destroying the native session.
	refreshNativeAccess: publicProcedure
		.input(z.object({deviceToken: z.string(), client: nativeClientSchema}))
		.mutation(async ({ctx, input}) => {
			if (!ctx.request || !ctx.response) {
				throw new TRPCError({code: 'METHOD_NOT_SUPPORTED', message: 'HTTP transport required'})
			}
			const session = await ctx.umbreld.auth.refreshNativeAccess(input.deviceToken, input.client).catch((error) => {
				if (error instanceof InvalidNativeDeviceCredentialError) {
					throw new TRPCError({code: 'UNAUTHORIZED', message: 'Invalid native session'})
				}
				throw error
			})
			ctx.response!.set('Cache-Control', 'no-store')
			return {
				accessToken: session.accessToken,
				accessExpiresAt: session.accessExpiresAt,
			}
		}),

	createUser: privateProcedure
		.input(
			z.object({
				name: z.string().min(1),
				password: z.string().min(6, 'Password must be at least 6 characters'),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.user.createUser(input.name, input.password)),

	deleteUser: privateProcedure
		.input(z.object({userId: z.string()}))
		.mutation(async ({ctx, input}) => ctx.user.deleteUser(input.userId)),

	isLoggedIn: publicProcedure.query(async ({ctx}) => {
		try {
			const token = ctx.request!.headers.authorization?.split(' ')[1]
			await ctx.umbreld.auth.authenticateApiCredentials(token!, browserSessionTokenFromRequest(ctx.request!))
			return true
		} catch {
			return false
		}
	}),

	// Extends the current account session without rotating its credentials.
	renewToken: privateProcedureWithMembers.mutation(async ({ctx}) => {
		const token = ctx.request!.headers.authorization?.split(' ')[1]
		if (!token) throw new TRPCError({code: 'UNAUTHORIZED', message: 'Invalid token'})
		const session = await ctx.umbreld.auth.renewSession(ctx.principal!).catch((error) => {
			if (error instanceof BrowserSessionRequiredError) {
				throw new TRPCError({code: 'FORBIDDEN', message: error.message})
			}
			throw error
		})

		const appGatewayToken = appGatewayTokenFromRequest(ctx.request!)
		if (appGatewayToken) {
			const appPrincipal = await ctx.umbreld.auth.authenticate(appGatewayToken, 'app-gateway').catch(() => null)
			if (appPrincipal?.sessionId === session.principal.sessionId) {
				setAppGatewayCookie(ctx.response!, ctx.request!, appGatewayToken, new Date(session.expiresAt))
			}
		}

		const browserSessionToken = browserSessionTokenFromRequest(ctx.request!)
		if (!browserSessionToken) throw new TRPCError({code: 'UNAUTHORIZED', message: 'Invalid token'})
		setBrowserSessionCookie(ctx.response!, ctx.request!, browserSessionToken, new Date(session.expiresAt))
		return token
	}),

	createWebSocketTicket: privateProcedureWithMembers
		.input(z.object({target: z.enum(['trpc', 'terminal', 'machines'])}))
		.mutation(async ({ctx, input}) => {
			if (input.target !== 'trpc' && ctx.principal!.accountId !== OWNER_ACCOUNT_ID) {
				throw new TRPCError({code: 'FORBIDDEN', message: 'This action can only be performed by the owner'})
			}
			try {
				return ctx.umbreld.auth.issueWebSocketTicket(ctx.principal!, input.target)
			} catch (error) {
				if (error instanceof BrowserSessionRequiredError) {
					throw new TRPCError({code: 'FORBIDDEN', message: error.message})
				}
				throw error
			}
		}),

	getHttpApiToken: privateProcedureWithMembers.query(async ({ctx}) => {
		if (!ctx.request || !ctx.response) {
			throw new TRPCError({code: 'METHOD_NOT_SUPPORTED', message: 'HTTP transport required'})
		}
		const token = await ctx.umbreld.auth.getHttpApiToken(ctx.principal!).catch((error) => {
			if (error instanceof BrowserSessionRequiredError) {
				throw new TRPCError({code: 'FORBIDDEN', message: error.message})
			}
			throw error
		})
		ctx.response.set('Cache-Control', 'no-store')
		return token
	}),

	listSessions: privateProcedureWithMembers.query(async ({ctx}) => ctx.umbreld.auth.listSessions(ctx.principal!)),

	listAccountSessions: privateProcedure
		.input(z.object({userId: z.string()}))
		.query(async ({ctx, input}) => ctx.umbreld.auth.listSessionsForOwner(ctx.principal!, input.userId)),

	revokeSession: privateProcedureWithMembers
		.input(z.object({sessionId: z.string().regex(/^[0-9a-f]{32}$/)}))
		.mutation(async ({ctx, input}) => {
			const result = await ctx.umbreld.auth.revokeSessionForAccount(ctx.principal!, input.sessionId)
			if (result.revokedCurrent) {
				clearAppGatewayCookies(ctx.response!)
				clearBrowserSessionCookies(ctx.response!)
			}
			return result
		}),

	revokeOtherSessions: privateProcedureWithMembers.mutation(async ({ctx}) => ({
		revokedCount: await ctx.umbreld.auth.revokeOtherSessionsForAccount(ctx.principal!),
	})),

	revokeAccountSession: privateProcedure
		.input(
			z.object({
				userId: z.string(),
				sessionId: z.string().regex(/^[0-9a-f]{32}$/),
			}),
		)
		.mutation(async ({ctx, input}) => {
			const result = await ctx.umbreld.auth.revokeSessionForOwner(ctx.principal!, input.userId, input.sessionId)
			if (result.revokedCurrent) {
				clearAppGatewayCookies(ctx.response!)
				clearBrowserSessionCookies(ctx.response!)
			}
			return result
		}),

	revokeAllAccountSessions: privateProcedure.input(z.object({userId: z.string()})).mutation(async ({ctx, input}) => {
		const result = await ctx.umbreld.auth.revokeAllSessionsForOwner(ctx.principal!, input.userId)
		if (result.revokedCurrent) {
			clearAppGatewayCookies(ctx.response!)
			clearBrowserSessionCookies(ctx.response!)
		}
		return result
	}),

	logout: privateProcedureWithMembers.mutation(async ({ctx}) => {
		await ctx.umbreld.auth.revokeSession(ctx.principal!.sessionId)
		clearAppGatewayCookies(ctx.response!)
		clearBrowserSessionCookies(ctx.response!)
		return true
	}),

	verifyPassword: privateProcedureWithMembers.input(z.object({password: z.string()})).mutation(async ({ctx, input}) => {
		if (!(await ctx.user.validateAccountPassword(ctx.principal!.accountId, input.password))) {
			throw new TRPCError({code: 'UNAUTHORIZED', message: 'Incorrect password'})
		}
		return true
	}),

	changePassword: privateProcedureWithMembers
		.input(
			z.object({
				oldPassword: z.string(),
				newPassword: z.string().min(6, 'Password must be at least 6 characters'),
			}),
		)
		.mutation(async ({ctx, input}) => {
			const accountId = ctx.principal!.accountId
			if (!(await ctx.user.validateAccountPassword(accountId, input.oldPassword))) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: 'Incorrect password'})
			}
			return ctx.user.setAccountPassword(accountId, input.newPassword)
		}),

	resetUserPassword: privateProcedure
		.input(
			z.object({
				userId: z.string(),
				password: z.string().min(6, 'Password must be at least 6 characters'),
			}),
		)
		.mutation(async ({ctx, input}) => ctx.user.resetMemberPassword(input.userId, input.password)),

	generateTotpUri: privateProcedureWithMembers.query(async () => totp.generateUri('Umbrel', 'umbrel.local')),

	enable2fa: privateProcedureWithMembers
		.input(z.object({totpUri: z.string(), totpToken: z.string()}))
		.mutation(async ({ctx, input}) => {
			const accountId = ctx.principal!.accountId
			if (await ctx.user.is2faEnabledForAccount(accountId)) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: '2FA is already enabled'})
			}
			if (!totp.verify(input.totpUri, input.totpToken)) {
				throw new TRPCError({code: 'UNAUTHORIZED', message: 'Incorrect 2FA code'})
			}
			return ctx.user.enable2faForAccount(accountId, input.totpUri)
		}),

	is2faEnabled: publicProcedure.query(async ({ctx}) =>
		ctx.user.is2faEnabledForAccount(await resolveOptionalAccountId(ctx)),
	),

	disable2fa: privateProcedureWithMembers.input(z.object({totpToken: z.string()})).mutation(async ({ctx, input}) => {
		const accountId = ctx.principal!.accountId
		if (!(await ctx.user.is2faEnabledForAccount(accountId))) {
			throw new TRPCError({code: 'UNAUTHORIZED', message: '2FA is not enabled'})
		}
		if (!(await ctx.user.validate2faTokenForAccount(accountId, input.totpToken))) {
			throw new TRPCError({code: 'UNAUTHORIZED', message: 'Incorrect 2FA code'})
		}
		return ctx.user.disable2faForAccount(accountId)
	}),

	get: privateProcedureWithMembers.query(async ({ctx}) => {
		const accountId = ctx.principal!.accountId
		if (accountId !== OWNER_USER_ID) {
			const member = await ctx.user.getMember(accountId)
			if (!member) throw new TRPCError({code: 'UNAUTHORIZED', message: 'Invalid token'})
			return {
				userId: accountId,
				name: member.name,
				...(member.avatarHash ? {avatarUrl: accountAvatarUrl(accountId, member.avatarHash)} : {}),
				role: 'member' as const,
				homePath: `/Users/${accountId}`,
				sambaEnabled: Boolean(member.sambaPassword),
				sambaUsername: ctx.umbreld.files.samba.getShareUsername(accountId),
				wallpaper: resolveWallpaperAppearance(member.wallpaper),
				language: member.language,
				temperatureUnit: member.temperatureUnit,
			}
		}

		const user = await ctx.user.get()
		return {
			userId: accountId,
			name: user.name,
			...(user.avatarHash ? {avatarUrl: accountAvatarUrl(accountId, user.avatarHash)} : {}),
			role: 'owner' as const,
			homePath: '/Home',
			sambaEnabled: true,
			sambaUsername: ctx.umbreld.files.samba.getShareUsername(accountId),
			wallpaper: resolveWallpaperAppearance(user.wallpaper),
			language: user.language ?? 'en',
			temperatureUnit: user.temperatureUnit,
		}
	}),

	set: privateProcedureWithMembers
		.input(
			z
				.object({
					name: z.string().optional(),
					wallpaper: z.string().refine(isWallpaperId, 'Unknown wallpaper').optional(),
					language: z.string().optional(),
					temperatureUnit: z.string().optional(),
				})
				.strict(),
		)
		.mutation(async ({ctx, input}) => {
			const accountId = ctx.principal!.accountId
			if (input.name) await ctx.user.setAccountName(accountId, input.name)
			if (input.wallpaper) await ctx.user.setAccountWallpaper(accountId, input.wallpaper)
			if (input.language) await ctx.user.setAccountLanguage(accountId, input.language)
			if (input.temperatureUnit) await ctx.user.setAccountTemperatureUnit(accountId, input.temperatureUnit)
			return true
		}),

	wallpaper: publicProcedure.query(async ({ctx}) => {
		const accountId = await resolveOptionalAccountId(ctx)
		if (accountId !== OWNER_USER_ID) {
			const member = await ctx.user.getMember(accountId)
			return resolveWallpaperAppearance(member?.wallpaper)
		} else {
			const user = await ctx.user.get()
			return resolveWallpaperAppearance(user?.wallpaper)
		}
	}),

	language: publicProcedure.query(async ({ctx}) => {
		const accountId = await resolveOptionalAccountId(ctx)
		return (await ctx.user.getAccountLanguage(accountId)) ?? null
	}),
})
