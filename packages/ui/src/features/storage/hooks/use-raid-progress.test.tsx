// @vitest-environment jsdom
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {type TRPCLink} from '@trpc/client'
import {observable} from '@trpc/server/observable'
import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import {trpcReact} from '@/trpc/trpc'

import type {AppRouter} from '../../../../../umbreld/source/modules/server/trpc/common'
import {PendingRaidOperationProvider} from '../providers/pending-operation-context'
import {RaidProgress, useRaidProgress} from './use-raid-progress'

vi.mock('@/trpc/trpc', async () => {
	const {createTRPCReact} = await import('@trpc/react-query')
	return {trpcReact: createTRPCReact()}
})
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/components/ui/toast', () => ({toast: {error: vi.fn()}}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let cache: QueryClient
let progress: RaidProgress | null
let pool: Record<string, unknown>
let role: 'owner' | 'member'
let statusReads: number
let holdStatusReads: boolean
let listeners: Record<string, (data: unknown) => void>

function Harness() {
	progress = useRaidProgress()
	return null
}

async function advance(ms: number) {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms)
	})
}

async function render() {
	const link: TRPCLink<AppRouter> =
		() =>
		({op}) =>
			observable((observer) => {
				if (op.type === 'subscription') {
					const {event} = op.input as {event: string}
					listeners[event] = (data) => observer.next({result: {type: 'data', data}})
					return
				}
				if (op.path === 'hardware.raid.getStatus') {
					if (holdStatusReads) return
					statusReads++
				}
				const responses: Record<string, unknown> = {'user.get': {role}, 'hardware.raid.getStatus': pool}
				observer.next({result: {data: responses[op.path]}})
				observer.complete()
			})
	await act(async () =>
		root.render(
			<trpcReact.Provider client={trpcReact.createClient({links: [link]})} queryClient={cache}>
				<QueryClientProvider client={cache}>
					<PendingRaidOperationProvider>
						<Harness />
					</PendingRaidOperationProvider>
				</QueryClientProvider>
			</trpcReact.Provider>,
		),
	)
	await advance(100)
}

async function emit(event: string, data: unknown) {
	await act(async () => listeners[event](data))
}

beforeEach(() => {
	vi.useFakeTimers()
	root = createRoot(document.createElement('div'))
	cache = new QueryClient({defaultOptions: {queries: {retry: false}}})
	pool = {exists: true}
	role = 'owner'
	statusReads = 0
	holdStatusReads = false
	listeners = {}
})
afterEach(() => {
	act(() => root.unmount())
	cache.clear()
	vi.useRealTimers()
})

test('an operation already running shows before its first event', async () => {
	pool.rebuild = {state: 'rebuilding', progress: 40}
	await render()
	expect(progress).toEqual({type: 'rebuild', state: 'rebuilding', progress: 40})
})

test('events are preferred over the status they could be ahead of', async () => {
	pool.replace = {state: 'rebuilding', progress: 10}
	await render()
	await emit('raid:replace-progress', {state: 'rebuilding', progress: 60})
	expect(progress?.progress).toBe(60)
})

test('an operation ends when a later read shows its final event was lost', async () => {
	await render()
	await emit('raid:replace-progress', {state: 'rebuilding', progress: 73})
	expect(progress?.type).toBe('replace')

	await advance(3000)
	await act(async () => cache.invalidateQueries())
	await advance(100)
	expect(progress).toBeNull()
})

test('an operation with no more events ends on its own once the pool stops reporting it', async () => {
	await render()
	await emit('raid:rebuild-progress', {state: 'rebuilding', progress: 73})
	expect(progress?.type).toBe('rebuild')

	await advance(31_000)
	expect(progress).toBeNull()
})

test('a slow read after a final event cannot bring the operation back', async () => {
	pool.replace = {state: 'rebuilding', progress: 99}
	await render()
	expect(progress?.type).toBe('replace')

	// The refresh this triggers is still on its way when the event's display time is up
	holdStatusReads = true
	await emit('raid:replace-progress', {state: 'finished', progress: 100})
	await advance(2100)
	expect(progress).toBeNull()
})

test('a read right after an event cannot end the operation it just reported', async () => {
	await render()
	await emit('raid:replace-progress', {state: 'rebuilding', progress: 1})
	await act(async () => cache.invalidateQueries())
	await advance(100)
	expect(progress?.type).toBe('replace')
})

test('a final event refreshes the status so the operation does not come back', async () => {
	pool.expansion = {state: 'expanding', progress: 99}
	await render()
	expect(progress?.type).toBe('expansion')

	pool.expansion = {state: 'finished', progress: 100}
	await emit('raid:expansion-progress', {state: 'finished', progress: 100})
	expect(progress?.state).toBe('finished')

	await advance(2100)
	expect(progress).toBeNull()
})

test('members never read the owner-only status', async () => {
	role = 'member'
	await render()
	expect(statusReads).toBe(0)
	expect(progress).toBeNull()
})
