import {afterEach, beforeEach, describe, expect, test} from 'vitest'
import type express from 'express'

import type Umbreld from '../../index.ts'
import temporaryDirectory from '../utilities/temporary-directory.ts'

import Auth from './auth.ts'
import {BROWSER_SESSION_HTTP_COOKIE_NAME, BROWSER_SESSION_HTTPS_COOKIE_NAME} from './browser-session-cookie.ts'
import {authorizeDashboardRequest, authorizeHttpRequest} from './http-request.ts'

describe('HTTP request authentication', () => {
	let directory: ReturnType<typeof temporaryDirectory>
	let auth: Auth
	let umbreld: Umbreld

	beforeEach(async () => {
		directory = temporaryDirectory()
		await directory.createRoot()
		umbreld = {
			dataDirectory: await directory.create(),
			isBackupRestoreFirstStart: false,
			user: {exists: async () => true},
		} as Umbreld
		auth = new Auth(umbreld)
		umbreld.auth = auth
		await auth.start()
	})

	afterEach(async () => {
		await auth.stop()
		await directory.destroyRoot()
	})

	function request({
		authorization,
		cookies = {},
		query = {},
		secure = false,
	}: {
		authorization?: string
		cookies?: Record<string, string>
		query?: Record<string, string>
		secure?: boolean
	} = {}) {
		return {
			cookies,
			query,
			secure,
			get: (header: string) => (header.toLowerCase() === 'authorization' ? authorization : undefined),
		} as express.Request
	}

	test('dashboard requests require token and browser credentials from the same session', async () => {
		const first = await auth.createSession()
		const second = await auth.createSession()

		await expect(
			authorizeDashboardRequest(
				umbreld,
				request({
					authorization: `Bearer ${first.dashboardToken}`,
					cookies: {[BROWSER_SESSION_HTTP_COOKIE_NAME]: first.browserSessionToken},
				}),
			),
		).resolves.toEqual(first.principal)
		await expect(
			authorizeDashboardRequest(umbreld, request({authorization: `Bearer ${first.dashboardToken}`})),
		).rejects.toThrow('Missing browser session credential')
		await expect(
			authorizeDashboardRequest(
				umbreld,
				request({
					authorization: `Bearer ${first.dashboardToken}`,
					cookies: {[BROWSER_SESSION_HTTP_COOKIE_NAME]: second.browserSessionToken},
				}),
			),
		).rejects.toThrow('Invalid browser session credentials')
	})

	test('HTTP API URLs reject account dashboard credentials and allow the system credential', async () => {
		const session = await auth.createSession()
		await expect(
			authorizeHttpRequest(
				umbreld,
				request({
					authorization: `Bearer ${session.dashboardToken}`,
					cookies: {[BROWSER_SESSION_HTTP_COOKIE_NAME]: session.browserSessionToken},
				}),
				'file-view',
			),
		).rejects.toThrow('Dashboard credentials cannot authorize HTTP API URLs')

		const systemToken = await import('node:fs/promises').then((fs) => fs.readFile(auth.systemTokenPath, 'utf8'))
		await expect(
			authorizeHttpRequest(umbreld, request({authorization: `Bearer ${systemToken}`}), 'file-view', '/Home/photo.jpg'),
		).resolves.toMatchObject({actor: 'system'})
	})

	test('requires the browser cookie and HTTP API token from the same session', async () => {
		const first = await auth.createSession()
		const second = await auth.createSession()
		const firstToken = await auth.getHttpApiToken(first.principal)
		const secondToken = await auth.getHttpApiToken(second.principal)

		await expect(
			authorizeHttpRequest(
				umbreld,
				request({
					cookies: {[BROWSER_SESSION_HTTP_COOKIE_NAME]: first.browserSessionToken},
					query: {token: firstToken},
				}),
				'file-view',
			),
		).resolves.toEqual(first.principal)

		await expect(
			authorizeHttpRequest(
				umbreld,
				request({cookies: {[BROWSER_SESSION_HTTP_COOKIE_NAME]: first.browserSessionToken}}),
				'file-view',
			),
		).rejects.toThrow('Missing HTTP API credentials')
		await expect(authorizeHttpRequest(umbreld, request({query: {token: firstToken}}), 'file-view')).rejects.toThrow(
			'Missing HTTP API credentials',
		)
		await expect(
			authorizeHttpRequest(
				umbreld,
				request({
					cookies: {[BROWSER_SESSION_HTTP_COOKIE_NAME]: first.browserSessionToken},
					query: {token: secondToken},
				}),
				'file-view',
			),
		).rejects.toThrow('Invalid HTTP API credentials')
	})

	test('selects the HTTPS cookie only for secure requests', async () => {
		const session = await auth.createSession()
		const token = await auth.getHttpApiToken(session.principal)

		await expect(
			authorizeHttpRequest(
				umbreld,
				request({
					secure: true,
					cookies: {
						[BROWSER_SESSION_HTTP_COOKIE_NAME]: 'ignored-on-https',
						[BROWSER_SESSION_HTTPS_COOKIE_NAME]: session.browserSessionToken,
					},
					query: {token},
				}),
				'file-thumbnail',
			),
		).resolves.toEqual(session.principal)
	})
})
