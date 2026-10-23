import fse from 'fs-extra'
import express from 'express'

import type Umbreld from '../../index.ts'
import type {Principal} from '../auth/auth.ts'
import {authorizeDashboardRequest} from '../auth/http-request.ts'
import {PRIVATE_IMMUTABLE_CACHE_CONTROL} from '../server/cache-control.ts'
import {
	AvatarError,
	MAX_AVATAR_UPLOAD_BYTES,
	removeAccountAvatar,
	resolveAccountAvatar,
	setAccountAvatar,
} from './avatar.ts'
import {OWNER_USER_ID} from './constants.ts'
import type {Account} from './user.ts'

export function accountAvatarUrl(userId: string, hash: string, context: 'dashboard' | 'app-auth' = 'dashboard') {
	const encodedUserId = encodeURIComponent(userId)
	return context === 'app-auth'
		? `/v1/account/avatar/${encodedUserId}/${hash}.webp`
		: `/api/accounts/${encodedUserId}/avatar/${hash}.webp`
}

export function serializeAccountAvatar(
	account: Account,
	context: 'dashboard' | 'app-auth' = 'dashboard',
): Omit<Account, 'avatarHash'> & {avatarUrl?: string} {
	const {avatarHash, ...publicAccount} = account
	return {
		...publicAccount,
		...(avatarHash ? {avatarUrl: accountAvatarUrl(account.userId, avatarHash, context)} : {}),
	}
}

function noStore(response: express.Response) {
	response.set('Cache-Control', 'no-store')
}

function writeError(response: express.Response, statusCode: number, message: string, request?: express.Request) {
	noStore(response)
	if (request?.method === 'PUT' && !request.readableEnded) response.set('Connection', 'close')
	return response.status(statusCode).json({error: message})
}

async function accountExists(umbreld: Umbreld, userId: string) {
	return userId === OWNER_USER_ID ? umbreld.user.exists() : Boolean(await umbreld.user.getMember(userId))
}

function canModifyAccountAvatar(principal: Principal, userId: string) {
	return principal.actor === 'account' && (principal.accountId === OWNER_USER_ID || principal.accountId === userId)
}

export async function authorizeAccountAvatarWrite(umbreld: Umbreld, principal: Principal, userId: string) {
	if (!canModifyAccountAvatar(principal, userId)) throw new AvatarError('Forbidden', 403)
	if (!(await accountExists(umbreld, userId))) throw new AvatarError('Account not found', 404)
	return principal
}

function contentLength(request: express.Request) {
	const header = request.get('Content-Length')
	if (!header) return
	const value = Number(header)
	return Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

export function serveAccountAvatar(umbreld: Umbreld): express.RequestHandler {
	return async (request, response) => {
		try {
			const path = await resolveAccountAvatar(umbreld, request.params.userId, request.params.hash)
			const image = await fse.readFile(path)
			response.set({
				'Content-Type': 'image/webp',
				'Cache-Control': PRIVATE_IMMUTABLE_CACHE_CONTROL,
				ETag: `"${request.params.hash}"`,
				'X-Content-Type-Options': 'nosniff',
			})
			return response.send(image)
		} catch {
			return writeError(response, 404, 'Not found')
		}
	}
}

function avatarWriteHandler(
	umbreld: Umbreld,
	operation: (umbreld: Umbreld, userId: string, request: express.Request) => Promise<unknown>,
): express.RequestHandler {
	return async (request, response) => {
		noStore(response)
		let principal: Principal
		try {
			principal = await authorizeDashboardRequest(umbreld, request)
		} catch {
			return writeError(response, 401, 'Unauthorized', request)
		}

		try {
			await authorizeAccountAvatarWrite(umbreld, principal, request.params.userId)
			const result = await operation(umbreld, request.params.userId, request)
			return response.json(result)
		} catch (error) {
			if (error instanceof AvatarError) return writeError(response, error.statusCode, error.message, request)
			if (error instanceof Error && error.message === 'User not found') {
				return writeError(response, 404, 'Account not found', request)
			}
			umbreld.logger.error(`Failed to update avatar for ${request.params.userId}`, error)
			return writeError(response, 500, 'Unable to update avatar', request)
		}
	}
}

export default function accountAvatarApi(umbreld: Umbreld) {
	const api = express.Router()
	const serve = serveAccountAvatar(umbreld)

	api.get('/:userId/avatar/:hash.webp', serve)
	api.get('/:userId/avatar/*', (_request, response) => writeError(response, 404, 'Not found'))

	api.put(
		'/:userId/avatar',
		avatarWriteHandler(umbreld, async (instance, userId, request) => {
			const length = contentLength(request)
			if (length !== undefined && length > MAX_AVATAR_UPLOAD_BYTES) {
				throw new AvatarError('Avatar image is too large', 413)
			}
			const hash = await setAccountAvatar(instance, userId, request)
			return {userId, avatarUrl: accountAvatarUrl(userId, hash)}
		}),
	)
	api.delete(
		'/:userId/avatar',
		avatarWriteHandler(umbreld, async (instance, userId) => {
			await removeAccountAvatar(instance, userId)
			return {userId, avatarUrl: null}
		}),
	)

	return api
}
