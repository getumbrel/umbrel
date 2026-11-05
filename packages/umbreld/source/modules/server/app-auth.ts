import {isIP} from 'node:net'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

import express from 'express'
import {createProxyMiddleware} from 'http-proxy-middleware'

import type Umbreld from '../../index.ts'
import {appGatewayTokenFromRequest, clearAppGatewayCookies, setAppGatewayCookie} from '../auth/app-gateway-cookie.ts'
import {SessionIssuanceInvalidatedError} from '../auth/auth.ts'
import {serializeAccountAvatar, serveAccountAvatar} from '../user/avatar-api.ts'
import {OWNER_USER_ID} from '../user/constants.ts'
import {resolveWallpaperAppearance} from '../user/wallpapers.ts'

type AppAuthRequest = {
	appId: string
	origin: 'host' | 'tor'
	redirectPath: string
}

function requestString(request: express.Request, name: string) {
	const value = request.query[name]
	if (typeof value !== 'string' || !value.trim()) throw new Error(`'${name}' is missing`)
	return value
}

function parseAppAuthRequest(request: express.Request): AppAuthRequest {
	const appId = requestString(request, 'app')
	if (!/^[a-zA-Z0-9-]+$/.test(appId)) throw new Error('Invalid app')

	const origin = requestString(request, 'origin')
	if (origin !== 'host' && origin !== 'tor') throw new Error('Unsupported origin')

	const requestedPath = requestString(request, 'path')
	let redirectPath = '/'
	try {
		const url = new URL(requestedPath, 'http://umbrel.local')
		redirectPath = `${url.pathname}${url.search}${url.hash}`
	} catch {}

	return {appId, origin, redirectPath}
}

function hostWithPort(hostname: string, port: number) {
	const host = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
	return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`
}

function formActionSource(protocol: string, hostname: string, port?: number | '*') {
	if (protocol !== 'http' && protocol !== 'https') return

	const host = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
	if (!isIP(host) && !/^[a-zA-Z0-9.-]+$/.test(host)) return

	const formattedHost = host.includes(':') ? `[${host}]` : host
	return `${protocol}://${formattedHost}${port === undefined ? '' : `:${port}`}`
}

async function appHandoffFormAction(umbreld: Umbreld, request: express.Request) {
	if (request.protocol !== 'http' && request.protocol !== 'https') return

	const appId = request.query.app
	if (request.query.origin === 'tor' && typeof appId === 'string' && /^[a-zA-Z0-9-]+$/.test(appId)) {
		try {
			const hiddenService = (await umbreld.apps.getApp(appId).readHiddenService()).trim()
			const source = formActionSource(request.protocol, hiddenService)
			if (source) return source
		} catch {}
	}

	return formActionSource(request.protocol, request.hostname, '*')
}

async function allowAppHandoffFormAction(umbreld: Umbreld, request: express.Request, response: express.Response) {
	const policy = response.get('Content-Security-Policy')
	const formAction = await appHandoffFormAction(umbreld, request)
	if (policy && formAction) {
		const directive = `form-action 'self' ${formAction}`
		response.set(
			'Content-Security-Policy',
			policy.includes('form-action ') ? policy.replace(/form-action [^;]*/i, directive) : `${policy};${directive}`,
		)
	}
}

async function createHandoffResponse(umbreld: Umbreld, request: express.Request, appGatewayToken: string) {
	const {appId, origin, redirectPath} = parseAppAuthRequest(request)
	const app = umbreld.apps.getApp(appId)
	const manifest = await app.readManifest()

	let host: string
	if (origin === 'tor') {
		host = (await app.readHiddenService()).trim()
		if (!host) throw new Error('App hidden service is unavailable')
	} else {
		host = hostWithPort(request.hostname, manifest.port)
	}

	const handoff = await umbreld.auth.issueAppHandoff(appId, appGatewayToken)
	return {
		url: `${request.protocol}://${host}/umbrel_/api/v1/auth/handoff`,
		params: {r: redirectPath, handoff},
	}
}

export function rewriteAppAuthDevProxyPath(path: string) {
	const queryIndex = path.indexOf('?')
	const pathname = queryIndex === -1 ? path : path.slice(0, queryIndex)
	const search = queryIndex === -1 ? '' : path.slice(queryIndex)

	if (pathname === '/' || pathname === '/app-auth' || pathname === '/app-auth/') {
		return `/app-auth/${search}`
	}
	if (pathname.startsWith('/app-auth/')) {
		return `${pathname.slice('/app-auth'.length)}${search}`
	}
	return path
}

export default function createAppAuthRouter(umbreld: Umbreld) {
	const router = express.Router()
	// App login finishes with a form POST from the dedicated auth port back to
	// the app port. Helmet's default `form-action 'self'` blocks that because
	// ports are part of an origin. Allow the current LAN hostname on another port,
	// or the app's exact onion hostname when the login originated over Tor.
	router.use((request, response, next) => {
		allowAppHandoffFormAction(umbreld, request, response).then(() => next(), next)
	})
	router.use(express.json())
	// Avatar bytes have immutable content-addressed URLs, so serve them before
	// the blanket no-store policy for app-auth JSON responses.
	router.get('/v1/account/avatar/:userId/:hash.webp', serveAccountAvatar(umbreld))
	router.get('/v1/account/avatar/:userId/*', (_request, response) =>
		response.status(404).set('Cache-Control', 'no-store').json({error: 'Not found'}),
	)
	router.use('/v1', (_request, response, next) => {
		response.set('Cache-Control', 'no-store')
		next()
	})

	router.get('/v1/account/accounts', async (_request, response) => {
		if (!(await umbreld.user.exists())) return response.json([])
		response.json(
			(await umbreld.user.listAccounts()).map((account) => ({
				...serializeAccountAvatar(account, 'app-auth'),
				wallpaper: resolveWallpaperAppearance(account.wallpaper),
			})),
		)
	})

	router.post('/v1/account/login', async (request, response) => {
		const userId = typeof request.body?.userId === 'string' ? request.body.userId : OWNER_USER_ID
		const password = typeof request.body?.password === 'string' ? request.body.password : ''
		const totpToken = typeof request.body?.totpToken === 'string' ? request.body.totpToken : undefined
		const validation = await umbreld.user.validateAccountLogin(userId, password, totpToken)
		if (!validation.valid) {
			const message =
				validation.reason === 'missing-totp'
					? 'Missing 2FA code'
					: validation.reason === 'incorrect-totp'
						? 'Incorrect 2FA code'
						: 'Incorrect password'
			return response.status(401).json({error: {code: -32001, message}})
		}

		let session
		try {
			session = await umbreld.auth.createSession({
				accountId: userId,
				userAgent: request.get('user-agent'),
				expectedSessionIssuanceRevision: validation.sessionIssuanceRevision,
			})
		} catch (error) {
			if (error instanceof SessionIssuanceInvalidatedError) {
				return response.status(401).json({error: {code: -32001, message: error.message}})
			}
			throw error
		}

		try {
			const handoff = await createHandoffResponse(umbreld, request, session.appGatewayToken)
			setAppGatewayCookie(response, request, session.appGatewayToken, new Date(session.expiresAt))
			response.json(handoff)
		} catch {
			await umbreld.auth.revokeSession(session.principal.sessionId)
			response.status(403).json({error: {code: -32003, message: 'This app has not been shared with this account'}})
		}
	})

	router.get('/v1/account/session', async (request, response) => {
		const token = appGatewayTokenFromRequest(request)
		try {
			await umbreld.auth.authenticate(token, 'app-gateway')
		} catch {
			clearAppGatewayCookies(response)
			return response.status(401).json({error: {code: -32001, message: 'Unauthorized'}})
		}
		try {
			response.json(await createHandoffResponse(umbreld, request, token))
		} catch {
			response.status(403).json({error: {code: -32003, message: 'This app has not been shared with this account'}})
		}
	})

	router.get('/v1/account/wallpaper', async (_request, response) => {
		const user = await umbreld.user.get()
		response.json(resolveWallpaperAppearance(user?.wallpaper))
	})

	router.get('/v1/apps', async (request, response) => {
		const appId = requestString(request, 'app')
		if (!/^[a-zA-Z0-9-]+$/.test(appId)) return response.status(400).json({error: 'Invalid app'})
		const manifest = await umbreld.apps.getApp(appId).readManifest()
		response.json({id: manifest.id, name: manifest.name})
	})

	if (process.env.UMBREL_UI_PROXY) {
		router.use(
			createProxyMiddleware({
				target: process.env.UMBREL_UI_PROXY,
				// Serve Vite's app-auth HTML entrypoint for document requests, while
				// keeping shared root assets and source modules at their normal paths.
				// Express may pass either this router's relative path or the original
				// `/app-auth` path depending on how the proxy middleware is invoked.
				pathRewrite: rewriteAppAuthDevProxyPath,
				ws: true,
			}),
		)
	} else {
		const currentDirname = dirname(fileURLToPath(import.meta.url))
		const uiPath = join(currentDirname, '../../../ui')
		const staticOptions = {cacheControl: true, etag: true, lastModified: true, maxAge: 0}
		// Never let express.static implicitly serve the dashboard index for `/`.
		// Assets remain shared, but every app-auth document fallback is explicit.
		router.use(express.static(uiPath, {...staticOptions, index: false}))
		router.get('*', (_request, response) => response.sendFile(join(uiPath, 'app-auth/index.html'), staticOptions))
	}

	return router
}
