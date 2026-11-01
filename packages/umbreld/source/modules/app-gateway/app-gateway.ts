import http from 'node:http'
import https from 'node:https'
import net from 'node:net'

import cookieParser from 'cookie-parser'
import dotenv from 'dotenv'
import express from 'express'
import fse from 'fs-extra'
import type {Compose} from 'compose-spec-schema'
import {createProxyMiddleware} from 'http-proxy-middleware'

import type Umbreld from '../../index.js'
import proxyStreamCleanup from '../utilities/proxy-stream-cleanup.js'
import {
	appGatewayTokenFromCookieHeader,
	appGatewayTokenFromRequest,
	setAppGatewayCookie,
	stripAppGatewayCookies,
} from '../auth/app-gateway-cookie.js'
import {SESSION_DURATION} from '../auth/auth.js'
import {appGatewayErrorPage} from './error-page.js'

export type AppGatewayConfig = {
	appId: string
	appName: string
	appIcon: string
	targetProtocol: 'http' | 'https'
	targetHost: string
	targetAddress?: string
	targetPort: number
	auth: boolean
	authWhitelist: string[]
	authBlacklist: string[]
	trustUpstream: boolean
	timeout: number
}

type AppGatewayOptions = {
	onUpstreamUnavailable?: () => void
}

function environmentRecord(environment: unknown) {
	if (Array.isArray(environment)) {
		return Object.fromEntries(
			environment.flatMap((entry) => {
				if (typeof entry !== 'string') return []
				const separator = entry.indexOf('=')
				return separator < 0 ? [[entry, '']] : [[entry.slice(0, separator), entry.slice(separator + 1)]]
			}),
		)
	}
	if (!environment || typeof environment !== 'object') return {}
	return Object.fromEntries(
		Object.entries(environment).map(([name, value]) => [name, value === null ? '' : String(value)]),
	)
}

function paths(value = '') {
	return value
		.split(/[, ]+/)
		.map((path) => path.trim())
		.filter(Boolean)
}

export async function readAppGatewayConfig(
	appId: string,
	dataDirectory: string,
	compose: Compose,
	appMetadata: {name?: string; icon?: string} = {},
) {
	const appProxy = compose.services?.app_proxy
	if (!appProxy) return null

	const renderedEnvironment = await fse.readJson(`${dataDirectory}/app-gateway.json`).catch(() => null)
	const environment = environmentRecord(renderedEnvironment ?? appProxy.environment)
	const customEnvironment = await fse
		.readFile(`${dataDirectory}/.env.app_proxy`, 'utf8')
		.then((contents) => dotenv.parse(contents))
		.catch(() => ({}))
	const config = {...environment, ...customEnvironment}
	const targetHost = config.APP_HOST?.trim()
	const targetPort = Number(config.APP_PORT)
	if (!targetHost || !Number.isInteger(targetPort) || targetPort <= 0 || targetPort > 65_535) return null

	return {
		appId,
		appName: appMetadata.name?.trim() || appId,
		appIcon:
			appMetadata.icon?.trim() ||
			`https://getumbrel.github.io/umbrel-apps-gallery/${encodeURIComponent(appId)}/icon.svg`,
		targetProtocol: config.APP_PROTOCOL === 'https' ? 'https' : 'http',
		targetHost,
		targetPort,
		// Match the removed sidecar's fail-safe default: authentication is enabled
		// unless an app explicitly opts out with PROXY_AUTH_ADD=false.
		auth: config.PROXY_AUTH_ADD?.trim().toLowerCase() !== 'false',
		authWhitelist: paths(config.PROXY_AUTH_WHITELIST),
		authBlacklist: paths(config.PROXY_AUTH_BLACKLIST),
		trustUpstream: config.PROXY_TRUST_UPSTREAM === 'true',
		timeout: Math.max(0, Number(config.PROXY_TIMEOUT) || 0),
	} satisfies AppGatewayConfig
}

function normalisePath(value: string) {
	let path = value || '/'
	path = path.split('?')[0] || '/'
	if (!path.startsWith('/')) path = `/${path}`
	if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
	return path
}

export function pathMatches(pathname: string, rules: string[]) {
	const requestPath = normalisePath(pathname)
	return rules.some((rule) => {
		const path = normalisePath(rule.trim())
		if (!rule.trim()) return false
		if (rule.trim() === '*') return true
		if (path === '/') return requestPath === '/'
		if (path.endsWith('/*')) {
			const basePath = normalisePath(path.slice(0, -2))
			return basePath === '/' || requestPath.startsWith(`${basePath}/`)
		}
		if (path.endsWith('*')) {
			const basePath = normalisePath(path.slice(0, -1))
			return basePath === '/' || requestPath.startsWith(basePath)
		}
		return requestPath === path
	})
}

function safeRedirect(value: unknown) {
	if (typeof value !== 'string') return '/'
	try {
		const url = new URL(value, 'http://umbrel.local')
		return `${url.pathname}${url.search}${url.hash}`
	} catch {
		return '/'
	}
}

function hostWithPort(hostname: string, port: number) {
	const host = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
	return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`
}

export default class AppGateway {
	#umbreld: Umbreld
	#config: AppGatewayConfig
	#onUpstreamUnavailable?: () => void
	#proxy: ReturnType<typeof createProxyMiddleware>
	server: http.Server

	constructor(umbreld: Umbreld, config: AppGatewayConfig, options: AppGatewayOptions = {}) {
		this.#umbreld = umbreld
		this.#config = config
		this.#onUpstreamUnavailable = options.onUpstreamUnavailable
		this.#proxy = this.createProxy()

		const app = express()
		app.disable('x-powered-by')
		app.set('trust proxy', 'loopback')
		app.use(cookieParser())
		app.post('/umbrel_/api/v1/auth/handoff', express.urlencoded({extended: false}), (request, response) => {
			this.acceptHandoff(request, response).catch((error) => {
				this.#umbreld.logger.error(`Failed app auth handoff for ${config.appId}`, error)
				response.status(401).send('Unauthorized')
			})
		})
		app.use((request, response) => {
			this.handleRequest(request, response).catch((error) => {
				this.#umbreld.logger.error(`Failed app gateway request for ${config.appId}`, error)
				response.status(500).send('Internal Server Error')
			})
		})

		this.server = http.createServer(app)
		// Let upstream apps enforce their own upload deadlines, as LAN ingress does.
		// Keep the separate timeout for receiving request headers.
		this.server.requestTimeout = 0
		this.server.on('upgrade', (request, socket, head) => {
			this.handleUpgrade(request, socket as net.Socket, head).catch(() => {
				socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
				socket.destroy()
			})
		})
	}

	private createProxy() {
		const targetHost = hostWithPort(this.#config.targetAddress ?? this.#config.targetHost, this.#config.targetPort)
		return createProxyMiddleware({
			target: `${this.#config.targetProtocol}://${targetHost}`,
			agent:
				this.#config.targetProtocol === 'https' && this.#config.targetAddress
					? new https.Agent({servername: this.#config.targetHost})
					: undefined,
			changeOrigin: false,
			ws: true,
			xfwd: false,
			proxyTimeout: this.#config.timeout,
			followRedirects: false,
			onProxyReq: (proxyRequest, request, response) => {
				proxyStreamCleanup(proxyRequest, response)
				if (request.socket.remoteAddress === undefined) return response.end()
				if (!this.#config.trustUpstream) {
					proxyRequest.setHeader('x-forwarded-proto', request.protocol)
					if (request.headers.host) proxyRequest.setHeader('x-forwarded-host', request.headers.host)
					proxyRequest.setHeader('x-forwarded-for', request.socket.remoteAddress)
				}
				this.stripCookies(proxyRequest, request)
			},
			onProxyReqWs: (proxyRequest, request) => this.stripCookies(proxyRequest, request),
			onError: (error, _request, response) => this.handleUpstreamError(response, error),
		})
	}

	private handleUpstreamError(response: http.ServerResponse | net.Socket, error?: unknown) {
		try {
			this.#umbreld.logger.error(`App gateway upstream error for ${this.#config.appId}`, error)
			this.#onUpstreamUnavailable?.()
			this.sendUpstreamError(response, error)
		} catch (handlerError) {
			// Proxy errors are emitted asynchronously. Never let an error while
			// reporting one escape the event handler and terminate umbreld.
			try {
				this.#umbreld.logger.error(`Failed to handle app gateway error for ${this.#config.appId}`, handlerError)
			} catch {}
			this.destroyProxyResponse(response)
		}
	}

	private sendUpstreamError(response: http.ServerResponse | net.Socket, error?: unknown) {
		// http-proxy passes a raw socket here for WebSocket failures even though
		// http-proxy-middleware types it as an HTTP response.
		if (typeof (response as http.ServerResponse).writeHead !== 'function') {
			this.destroyProxyResponse(response)
			return
		}

		const httpResponse = response as http.ServerResponse
		if (httpResponse.headersSent) {
			this.destroyProxyResponse(httpResponse)
			return
		}
		const errorCode =
			error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined
		const body = appGatewayErrorPage({...this.#config, errorCode})
		httpResponse.writeHead(502, {
			'cache-control': 'no-store',
			'content-length': Buffer.byteLength(body),
			'content-security-policy':
				"default-src 'none'; img-src 'self' https: http: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
			'content-type': 'text/html; charset=utf-8',
			'referrer-policy': 'no-referrer',
		})
		httpResponse.end(body)
	}

	private destroyProxyResponse(response: http.ServerResponse | net.Socket) {
		try {
			response.destroy()
		} catch {}
	}

	private stripCookies(proxyRequest: http.ClientRequest, request: http.IncomingMessage) {
		const cookies = stripAppGatewayCookies(request.headers.cookie)
		if (cookies) proxyRequest.setHeader('cookie', cookies)
		else proxyRequest.removeHeader('cookie')
	}

	private async isAuthorized(request: express.Request | http.IncomingMessage) {
		if (!this.#config.auth) return
		const pathname = new URL(request.url ?? '/', 'http://umbrel.local').pathname
		const whitelisted = pathMatches(pathname, this.#config.authWhitelist)
		const blacklisted = pathMatches(pathname, this.#config.authBlacklist)
		if (whitelisted && !blacklisted) return

		const token =
			'cookies' in request
				? appGatewayTokenFromRequest(request as express.Request)
				: appGatewayTokenFromCookieHeader(
						request.headers.cookie,
						request.socket.remoteAddress === '127.0.0.1' && request.headers['x-forwarded-proto'] === 'https',
					)
		const principal = await this.#umbreld.auth.authenticate(token, 'app-gateway')
		await this.#umbreld.auth.authorizeApp(principal, this.#config.appId)
		return principal
	}

	private async acceptHandoff(request: express.Request, response: express.Response) {
		if (typeof request.body?.handoff !== 'string') return response.status(400).send('Invalid handoff')
		const handoff = await this.#umbreld.auth.consumeAppHandoff(this.#config.appId, request.body.handoff)
		setAppGatewayCookie(response, request, handoff.appGatewayToken, new Date(Date.now() + SESSION_DURATION))
		response.redirect(safeRedirect(request.body.r))
	}

	private async handleRequest(request: express.Request, response: express.Response) {
		try {
			await this.isAuthorized(request)
		} catch {
			const origin = request.hostname.endsWith('.onion') ? 'tor' : 'host'
			const searchParams = new URLSearchParams({
				origin,
				app: this.#config.appId,
				path: request.originalUrl,
			})
			let host: string
			if (origin === 'tor') {
				host = await fse
					.readFile(`${this.#umbreld.dataDirectory}/tor/data/auth/hostname`, 'utf8')
					.then((value) => value.trim())
					.catch(() => 'not-yet-generated.onion')
			} else {
				host = hostWithPort(request.hostname, 2000)
			}
			response.redirect(`${request.protocol}://${host}/app-auth?${searchParams}`)
			return
		}
		this.#proxy(request, response, (error) => {
			if (error) this.sendUpstreamError(response, error)
		})
	}

	private async handleUpgrade(request: http.IncomingMessage, socket: net.Socket, head: Buffer) {
		const appAccessRevision = this.#umbreld.auth.appAccessRevision
		const principal = await this.isAuthorized(request)
		// Re-check and register synchronously after asynchronous authentication so
		// session or app-share revocation cannot race a late app WebSocket into
		// the upstream proxy.
		if (principal && !this.#umbreld.auth.registerAppSocket(principal, this.#config.appId, socket, appAccessRevision)) {
			return
		}
		this.#proxy.upgrade?.(request as express.Request, socket, head)
	}
}
