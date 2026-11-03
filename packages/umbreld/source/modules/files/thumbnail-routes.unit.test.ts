import {expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'
import type {Context} from '../server/trpc/context.ts'
import routes from './routes.ts'

function context() {
	const getThumbnailOnDemand = vi.fn(async () => '/api/files/thumbnail/rendition.webp')
	const caller = routes.createCaller({
		umbreld: {
			auth: {validatePrincipal: vi.fn(async () => {})},
			files: {thumbnails: {getThumbnailOnDemand}},
		} as unknown as Umbreld,
		transport: 'ws',
		principal: {sessionId: 'member-session', accountId: 'Alice', actor: 'account'},
		logger: {verbose: vi.fn(), error: vi.fn()},
		dangerouslyBypassAuthentication: false,
	} as unknown as Context)
	return {caller, getThumbnailOnDemand}
}

test("a thumbnail is the listing's unless a rendition is asked for", async () => {
	const {caller, getThumbnailOnDemand} = context()

	await caller.getThumbnail({path: '/Users/Alice/photo.heic'})
	expect(getThumbnailOnDemand).toHaveBeenLastCalledWith('/Users/Alice/photo.heic', 'Alice', undefined)

	await expect(caller.getThumbnail({path: '/Users/Alice/photo.heic', variant: 'preview-1280-webp-v2'})).resolves.toBe(
		'/api/files/thumbnail/rendition.webp',
	)
	expect(getThumbnailOnDemand).toHaveBeenLastCalledWith('/Users/Alice/photo.heic', 'Alice', 'preview-1280-webp-v2')
})

test('only the renditions umbreld makes can be asked for', async () => {
	const {caller, getThumbnailOnDemand} = context()

	await expect(
		caller.getThumbnail({path: '/Users/Alice/photo.heic', variant: 'original' as 'preview-1280-webp-v2'}),
	).rejects.toMatchObject({code: 'BAD_REQUEST'})
	expect(getThumbnailOnDemand).not.toHaveBeenCalled()
})
