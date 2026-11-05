import {describe, expect, test, vi} from 'vitest'
import type express from 'express'

import {
	APP_GATEWAY_HTTP_COOKIE_NAME,
	APP_GATEWAY_HTTPS_COOKIE_NAME,
	appGatewayTokenFromCookieHeader,
	appGatewayTokenFromRequest,
	clearAppGatewayCookies,
	setAppGatewayCookie,
	stripAppGatewayCookies,
} from './app-gateway-cookie.ts'
import {
	BROWSER_SESSION_HTTP_COOKIE_NAME,
	BROWSER_SESSION_HTTPS_COOKIE_NAME,
	browserSessionTokenFromRequest,
	clearBrowserSessionCookies,
	setBrowserSessionCookie,
} from './browser-session-cookie.ts'

function request(secure: boolean, cookies: Record<string, string> = {}) {
	return {secure, cookies} as express.Request
}

function response() {
	return {cookie: vi.fn(), clearCookie: vi.fn()} as unknown as express.Response
}

describe('session cookies', () => {
	test.each([
		{
			secure: false,
			appName: APP_GATEWAY_HTTP_COOKIE_NAME,
			browserName: BROWSER_SESSION_HTTP_COOKIE_NAME,
		},
		{
			secure: true,
			appName: APP_GATEWAY_HTTPS_COOKIE_NAME,
			browserName: BROWSER_SESSION_HTTPS_COOKIE_NAME,
		},
	])('sets host-only HTTP-only cookies with the correct transport attributes', ({secure, appName, browserName}) => {
		const expires = new Date('2026-01-08T00:00:00Z')
		const result = response()
		setAppGatewayCookie(result, request(secure), 'app-token', expires)
		setBrowserSessionCookie(result, request(secure), 'browser-token', expires)

		expect(result.cookie).toHaveBeenNthCalledWith(1, appName, 'app-token', {
			httpOnly: true,
			expires,
			path: '/',
			sameSite: 'lax',
			secure,
		})
		expect(result.cookie).toHaveBeenNthCalledWith(2, browserName, 'browser-token', {
			httpOnly: true,
			expires,
			path: '/',
			sameSite: 'lax',
			secure,
		})
	})

	test('selects only the cookie for the current HTTP or HTTPS context', () => {
		const cookies = {
			[APP_GATEWAY_HTTP_COOKIE_NAME]: 'http-app',
			[APP_GATEWAY_HTTPS_COOKIE_NAME]: 'https-app',
			[BROWSER_SESSION_HTTP_COOKIE_NAME]: 'http-browser',
			[BROWSER_SESSION_HTTPS_COOKIE_NAME]: 'https-browser',
		}
		expect(appGatewayTokenFromRequest(request(false, cookies))).toBe('http-app')
		expect(appGatewayTokenFromRequest(request(true, cookies))).toBe('https-app')
		expect(browserSessionTokenFromRequest(request(false, cookies))).toBe('http-browser')
		expect(browserSessionTokenFromRequest(request(true, cookies))).toBe('https-browser')
	})

	test('reads encoded app cookies from WebSocket headers for the selected context', () => {
		const header = `${APP_GATEWAY_HTTP_COOKIE_NAME}=http%20token; ${APP_GATEWAY_HTTPS_COOKIE_NAME}=https%20token`
		expect(appGatewayTokenFromCookieHeader(header, false)).toBe('http token')
		expect(appGatewayTokenFromCookieHeader(header, true)).toBe('https token')
		expect(appGatewayTokenFromCookieHeader(`${APP_GATEWAY_HTTP_COOKIE_NAME}=%E0%A4%A`, false)).toBe('%E0%A4%A')
	})

	test('strips every current and retired auth cookie while preserving app cookies and lookalikes', () => {
		const header = [
			`${APP_GATEWAY_HTTP_COOKIE_NAME}=app-http`,
			`${APP_GATEWAY_HTTPS_COOKIE_NAME}=app-https`,
			`${BROWSER_SESSION_HTTP_COOKIE_NAME}=browser-http`,
			`${BROWSER_SESSION_HTTPS_COOKIE_NAME}=browser-https`,
			'UMBREL_PROXY_TOKEN=retired-http',
			'__Host-UMBREL_PROXY_TOKEN_HTTPS=retired-https',
			'UMBREL_APP_SESSION_EXTRA=keep-lookalike',
			'app-cookie=keep',
		].join('; ')
		expect(stripAppGatewayCookies(header)).toBe('UMBREL_APP_SESSION_EXTRA=keep-lookalike; app-cookie=keep')
		expect(stripAppGatewayCookies()).toBe('')
	})

	test('uses whitespace-tolerant parsing consistently for authentication and stripping', () => {
		const header = [
			'app-cookie=keep',
			`\t${APP_GATEWAY_HTTP_COOKIE_NAME} = http%20token`,
			`  ${APP_GATEWAY_HTTPS_COOKIE_NAME}=https-token`,
			`\t${BROWSER_SESSION_HTTP_COOKIE_NAME} = browser-token`,
			'  UMBREL_PROXY_TOKEN = retired-token',
			'UMBREL_APP_SESSION_EXTRA=keep-lookalike',
		].join(';')

		expect(appGatewayTokenFromCookieHeader(header, false)).toBe('http token')
		expect(appGatewayTokenFromCookieHeader(header, true)).toBe('https-token')
		expect(stripAppGatewayCookies(header)).toBe('app-cookie=keep; UMBREL_APP_SESSION_EXTRA=keep-lookalike')
	})

	test('clears both transport variants on logout', () => {
		const result = response()
		clearAppGatewayCookies(result)
		clearBrowserSessionCookies(result)
		expect(result.clearCookie).toHaveBeenCalledWith(APP_GATEWAY_HTTPS_COOKIE_NAME, {path: '/', secure: true})
		expect(result.clearCookie).toHaveBeenCalledWith(APP_GATEWAY_HTTP_COOKIE_NAME, {path: '/'})
		expect(result.clearCookie).toHaveBeenCalledWith(BROWSER_SESSION_HTTPS_COOKIE_NAME, {path: '/', secure: true})
		expect(result.clearCookie).toHaveBeenCalledWith(BROWSER_SESSION_HTTP_COOKIE_NAME, {path: '/'})
	})
})
