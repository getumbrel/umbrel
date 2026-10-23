import {expect, test, vi} from 'vitest'

import type Umbreld from '../../index.ts'

import Server, {MAX_WEBSOCKET_PAYLOAD_BYTES} from './index.ts'

test('mounted WebSocket servers reject oversized client messages', () => {
	const logger = {log: vi.fn(), error: vi.fn(), verbose: vi.fn()}
	const server = new Server({
		umbreld: {logger: {createChildLogger: () => logger}} as unknown as Umbreld,
	})

	server.mountWebSocketServer('/test', () => {})

	expect(server.webSocketRouter.get('/test')?.options.maxPayload).toBe(MAX_WEBSOCKET_PAYLOAD_BYTES)
})
