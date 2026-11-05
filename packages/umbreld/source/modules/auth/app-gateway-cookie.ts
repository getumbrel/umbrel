import type express from 'express'

import {BROWSER_SESSION_COOKIE_NAMES} from './browser-session-cookie.ts'

export const APP_GATEWAY_HTTPS_COOKIE_NAME = '__Host-UMBREL_APP_SESSION_HTTPS'
export const APP_GATEWAY_HTTP_COOKIE_NAME = 'UMBREL_APP_SESSION'

const COOKIE_NAMES_BLOCKED_FROM_UPSTREAM = [
	APP_GATEWAY_HTTPS_COOKIE_NAME,
	APP_GATEWAY_HTTP_COOKIE_NAME,
	...BROWSER_SESSION_COOKIE_NAMES,
	// Browsers may retain credentials issued by the removed app-proxy sidecar.
	// They are never accepted, cleared, or migrated, but must still be stripped
	// so an untrusted app cannot capture a credential that could work after a downgrade.
	'__Host-UMBREL_PROXY_TOKEN_HTTPS',
	'UMBREL_PROXY_TOKEN',
]

function cookiePairs(cookieHeader: string | undefined) {
	return (cookieHeader?.split(';') ?? []).map((pair) => {
		const raw = pair.trim()
		const separator = raw.indexOf('=')
		return {
			raw,
			name: separator === -1 ? undefined : raw.slice(0, separator).trim(),
			value: separator === -1 ? undefined : raw.slice(separator + 1).trim(),
		}
	})
}

export function appGatewayTokenFromRequest(request: express.Request) {
	return request.cookies?.[request.secure ? APP_GATEWAY_HTTPS_COOKIE_NAME : APP_GATEWAY_HTTP_COOKIE_NAME]
}

export function appGatewayTokenFromCookieHeader(cookieHeader: string | undefined, secure: boolean) {
	const cookieName = secure ? APP_GATEWAY_HTTPS_COOKIE_NAME : APP_GATEWAY_HTTP_COOKIE_NAME
	for (const pair of cookiePairs(cookieHeader)) {
		if (pair.name !== cookieName || pair.value === undefined) continue
		try {
			return decodeURIComponent(pair.value)
		} catch {
			return pair.value
		}
	}
}

export function setAppGatewayCookie(
	response: express.Response,
	request: express.Request,
	token: string,
	expires: Date,
) {
	const secure = request.secure
	response.cookie(secure ? APP_GATEWAY_HTTPS_COOKIE_NAME : APP_GATEWAY_HTTP_COOKIE_NAME, token, {
		httpOnly: true,
		expires,
		path: '/',
		sameSite: 'lax',
		secure,
	})
}

export function clearAppGatewayCookies(response: express.Response) {
	response.clearCookie(APP_GATEWAY_HTTPS_COOKIE_NAME, {path: '/', secure: true})
	response.clearCookie(APP_GATEWAY_HTTP_COOKIE_NAME, {path: '/'})
}

export function stripAppGatewayCookies(cookieHeader?: string) {
	if (!cookieHeader) return ''
	return cookiePairs(cookieHeader)
		.filter((pair) => pair.raw && !COOKIE_NAMES_BLOCKED_FROM_UPSTREAM.includes(pair.name ?? ''))
		.map((pair) => pair.raw)
		.join('; ')
}
