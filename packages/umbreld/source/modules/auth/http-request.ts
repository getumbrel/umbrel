import type express from 'express'

import type Umbreld from '../../index.ts'
import type {HttpApiScope} from './auth.ts'
import {browserSessionTokenFromRequest} from './browser-session-cookie.ts'

function bearerToken(request: express.Request) {
	const [scheme, token] = request.get('Authorization')?.split(' ') ?? []
	return scheme?.toLowerCase() === 'bearer' && token ? token : undefined
}

export async function authorizePhotoBackupRequest(umbreld: Umbreld, request: express.Request) {
	const token = bearerToken(request)
	if (!token) throw new Error('Missing photo backup credential')
	return umbreld.auth.authenticatePhotoBackupGrant(token)
}

export async function authorizeDashboardRequest(umbreld: Umbreld, request: express.Request) {
	const token = bearerToken(request)
	if (!token) throw new Error('Missing dashboard credential')
	return umbreld.auth.authenticateDashboardCredentials(token, browserSessionTokenFromRequest(request))
}

export async function authorizeHttpRequest(
	umbreld: Umbreld,
	request: express.Request,
	scope: HttpApiScope,
	resource?: string,
) {
	const dashboardToken = bearerToken(request)
	if (dashboardToken) {
		const principal = await umbreld.auth.authenticate(dashboardToken, 'dashboard')
		if (principal.actor !== 'system') throw new Error('Dashboard credentials cannot authorize HTTP API URLs')
		return umbreld.auth.authorizeHttpApi(principal, scope, resource)
	}

	const browserSessionToken = browserSessionTokenFromRequest(request)
	const urlToken = request.query.token
	if (typeof browserSessionToken !== 'string' || typeof urlToken !== 'string') {
		throw new Error('Missing HTTP API credentials')
	}
	return umbreld.auth.authorizeHttpApiCredentials(browserSessionToken, urlToken, scope, resource)
}
