// @vitest-environment jsdom
// Storage Manager's connection to umbreld: which screen each answer leads to, and what a
// failed refresh must leave alone.
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {TRPCClientError, type TRPCLink} from '@trpc/client'
import {observable} from '@trpc/server/observable'
import {act, useState} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import {trpcReact} from '@/trpc/trpc'

import type {AppRouter} from '../../../../umbreld/source/modules/server/trpc/common'
import {ConnectedStorageManager} from './index'
import type {StorageManagerProps} from './manager/shared'
import {PendingRaidOperationProvider} from './providers/pending-operation-context'
import {viewPool} from './state'

vi.mock('@/trpc/trpc', async () => {
	const {createTRPCReact} = await import('@trpc/react-query')
	return {trpcReact: createTRPCReact()}
})
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key, i18n: {language: 'en'}})}))
vi.mock('@/utils/i18n', () => ({t: (key: string) => key, maybeT: (key: string) => key}))
vi.mock('@/components/ui/toast', () => ({toast: {error: vi.fn(), success: vi.fn()}}))
// The screens are tested where they are written. Here they only show which one was chosen,
// and the manager keeps a sheet open to show it wasn't taken off the screen.
vi.mock('./manager/manager', () => ({StorageManager: OpenSheet}))
vi.mock('./single-drive', () => ({
	SingleDriveManager: ({host}: {host: string}) => <div>single drive on {host}</div>,
	StorageUnreadable: ({reason, loading}: {reason: string; loading?: boolean}) => (
		<div>{loading ? 'loading' : `unreadable: ${reason}`}</div>
	),
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

function OpenSheet({state}: StorageManagerProps) {
	const [open, setOpen] = useState(false)
	return (
		<button onClick={() => setOpen(true)}>
			{open ? 'sheet open' : 'manager'} · {viewPool(state).status}
		</button>
	)
}

let host: HTMLDivElement
let root: Root
let cache: QueryClient
let failedQuery: string | undefined
let reads: string[]
let pool: Record<string, unknown>
let devices: Record<string, unknown>[]
let isPro: boolean
const storageQueries = [
	'hardware.umbrelPro.isUmbrelPro',
	'hardware.raid.getStatus',
	'hardware.internalStorage.getDevices',
]
const drive = (id: string) => ({
	id,
	type: 'hdd',
	name: 'Model',
	serial: id,
	size: 8e12,
	roundedSize: 8e12,
	smartStatus: 'healthy',
})
const member = (id: string) => ({id, status: 'ONLINE', readErrors: 0, writeErrors: 0, checksumErrors: 0})

beforeEach(() => {
	vi.useFakeTimers()
	localStorage.clear()
	host = document.createElement('div')
	root = createRoot(host)
	cache = new QueryClient({defaultOptions: {queries: {retry: false}}})
	failedQuery = undefined
	reads = []
	isPro = false
	devices = [drive('a'), drive('b')]
	pool = {
		name: 'umbrelos',
		exists: true,
		status: 'ONLINE',
		raidType: 'failsafe',
		topology: 'mirror',
		devices: [member('a'), member('b')],
		mirrors: [['a', 'b']],
		accelerator: {exists: false, devices: []},
	}
})
afterEach(() => {
	act(() => root.unmount())
	cache.clear()
	vi.useRealTimers()
})

async function flush() {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(100)
	})
}

async function mount() {
	const link: TRPCLink<AppRouter> =
		() =>
		({op}) =>
			observable((observer) => {
				if (op.type === 'subscription') return
				reads.push(op.path)
				if (failedQuery === op.path) {
					observer.error(TRPCClientError.from(new TypeError('Failed to fetch')))
					return
				}
				const responses: Record<string, unknown> = {
					'hardware.umbrelPro.isUmbrelPro': isPro,
					'hardware.raid.getStatus': pool,
					'hardware.internalStorage.getDevices': devices,
					'user.get': {name: 'Test', role: 'owner', temperatureUnit: 'c'},
					'files.externalDevices': [],
					'system.memorySize': 16 * 2 ** 30,
					'system.systemDiskUsage': {size: 1e12, totalUsed: 2e11},
					'systemNg.device.getIdentity': {productName: 'Umbrel Home'},
				}
				if (!(op.path in responses)) throw new Error(`Unexpected test request: ${op.path}`)
				observer.next({result: {data: structuredClone(responses[op.path])}})
				observer.complete()
			})
	const client = trpcReact.createClient({links: [link]})
	await act(async () =>
		root.render(
			<trpcReact.Provider client={client} queryClient={cache}>
				<QueryClientProvider client={cache}>
					<PendingRaidOperationProvider>
						<MemoryRouter>
							<ConnectedStorageManager onShutdown={() => {}} onRestart={() => {}} />
						</MemoryRouter>
					</PendingRaidOperationProvider>
				</QueryClientProvider>
			</trpcReact.Provider>,
		),
	)
	await flush()
}

const refresh = async () => {
	await act(async () => {
		await cache.refetchQueries()
	})
	await flush()
}

test.each(storageQueries)('an open sheet survives %s failing on a refresh', async (path) => {
	await mount()
	await act(async () => host.querySelector('button')!.click())
	failedQuery = path
	await refresh()
	expect(reads.filter((name) => name === path).length).toBeGreaterThan(1)
	// What is on screen stays, with the last answer umbreld gave
	expect(host.textContent).toBe('sheet open · protected')
})

test.each(storageQueries)('with no answer from %s there is nothing to go by, and nothing is guessed', async (path) => {
	failedQuery = path
	await mount()
	expect(host.textContent).toBe('unreadable: no-answer')
})

test('a storage that stops stays on screen, as stopped', async () => {
	await mount()
	await act(async () => host.querySelector('button')!.click())
	pool = {...pool, status: 'UNAVAIL'}
	await refresh()
	// The window itself says so and closes what can no longer be done: it isn't swapped for a blank one
	expect(host.textContent).toBe('sheet open · offline')
})

test('a machine that never had storage of its own gets the single-drive view', async () => {
	pool = {name: '', exists: false}
	devices = [{...drive('boot'), isSystemDrive: true}]
	await mount()
	expect(host.textContent).toBe('single drive on home')
})

test('a storage that is set up but not running, or can’t be identified, is listed and not managed', async () => {
	pool = {name: 'umbrelos', exists: false}
	await mount()
	expect(host.textContent).toBe('unreadable: unidentified')
})

test('an Umbrel Pro’s storage is SSDs even when none of them can be seen', async () => {
	isPro = true
	pool = {...pool, raidType: 'storage', topology: 'stripe', mirrors: undefined, status: 'UNAVAIL'}
	devices = []
	await mount()
	expect(host.textContent).toBe('manager · offline')
	// Other hardware can't say what the storage is made of, so it only lists what it sees
	act(() => root.unmount())
	root = createRoot(host)
	cache.clear()
	isPro = false
	await mount()
	expect(host.textContent).toBe('unreadable: unidentified')
})
