import express from 'express'

import type Umbreld from '../../index.ts'
import type {Principal} from '../auth/auth.ts'
import {authorizeHttpRequest} from '../auth/http-request.ts'
import {PRIVATE_IMMUTABLE_CACHE_CONTROL} from '../server/cache-control.ts'

export default function api(umbreld: Umbreld) {
	const api = express.Router()

	// Deny-by-default, like Files' router: adding a handler below also requires
	// an explicit policy here.
	api.use((request, response, next) => {
		const path = request.path.replace(/\/+$/, '') || '/'
		if (request.method !== 'GET' || !path.startsWith('/moment/')) {
			return response.status(401).json({error: 'unauthorized'})
		}
		authorizeHttpRequest(
			umbreld,
			request,
			'file-thumbnail',
			typeof request.query.path === 'string' ? request.query.path : undefined,
		)
			.then((principal: Principal) => {
				response.locals.principal = principal
				next()
			})
			.catch(() => response.status(401).json({error: 'unauthorized'}))
	})

	// GET /api/search/moment/:version.jpg?path=/Home/video.mp4&t=35000
	// A still of a video the caller can open, at about `t` milliseconds in.
	// `version` is whatever a search result named the file's state by, so a
	// file that has changed has a different URL: the bytes stay private while
	// the browser keeps that URL for good.
	api.get('/moment/:still', async (request, response) => {
		try {
			if (!request.params.still.endsWith('.jpg') || typeof request.query.path !== 'string') {
				throw new Error('[moment-not-found]')
			}
			const principal = response.locals.principal as Principal
			// Only ever a number from here on, whatever was sent
			const still = await umbreld.search.moment(principal.accountId, request.query.path, Number(request.query.t))
			response.setHeader('Cache-Control', PRIVATE_IMMUTABLE_CACHE_CONTROL)
			response.setHeader('X-Content-Type-Options', 'nosniff')
			return response.type('image/jpeg').send(still)
		} catch {
			return response.status(404).json({error: 'not found'})
		}
	})

	return api
}
