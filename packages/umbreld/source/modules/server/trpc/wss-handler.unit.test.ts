import {expect, test, vi} from 'vitest'
import {WebSocketServer} from 'ws'

import type Umbreld from '../../../index.ts'
import {coalesceWrites} from './coalesce-writes.ts'
import {trpcWssHandler} from './index.ts'

test('coalesces writes on every tRPC WebSocket connection', () => {
	const wss = new WebSocketServer({noServer: true})
	const logger = {log: vi.fn(), verbose: vi.fn(), error: vi.fn()}

	trpcWssHandler({wss, umbreld: {} as Umbreld, logger: logger as unknown as Umbreld['logger']})

	expect(wss.listeners('connection')).toContain(coalesceWrites)
	wss.close()
})
