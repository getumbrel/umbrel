import {expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'
import type {Context} from '../server/trpc/context.ts'
import routes from './routes.ts'

function context() {
	const list = vi.fn(async () => ({
		name: 'Home',
		path: '/Home',
		type: 'directory',
		size: undefined,
		modified: 0,
		operations: [],
		files: [
			{name: 'unknown-b', path: '/Home/unknown-b', type: 'directory', size: undefined, modified: 0, operations: []},
			{name: 'known', path: '/Home/known', type: 'directory', size: 1, modified: 0, operations: []},
			{name: 'empty', path: '/Home/empty', type: 'directory', size: 0, modified: 0, operations: []},
			{name: 'unknown-a', path: '/Home/unknown-a', type: 'directory', size: undefined, modified: 0, operations: []},
		],
	}))
	return routes.createCaller({
		umbreld: {files: {list}} as unknown as Umbreld,
		user: {exists: vi.fn(async () => false)},
		transport: 'express',
		logger: {verbose: vi.fn(), error: vi.fn()},
		dangerouslyBypassAuthentication: true,
	} as unknown as Context)
}

test('size sorting remains deterministic when directory sizes are unknown', async () => {
	const ascending = await context().list({path: '/Home', sortBy: 'size', sortOrder: 'ascending', limit: 100})
	expect(ascending.files.map(({name}) => name)).toStrictEqual(['empty', 'unknown-a', 'unknown-b', 'known'])

	const descending = await context().list({path: '/Home', sortBy: 'size', sortOrder: 'descending', limit: 100})
	expect(descending.files.map(({name}) => name)).toStrictEqual(['known', 'unknown-b', 'unknown-a', 'empty'])
})
