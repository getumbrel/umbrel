// @vitest-environment jsdom

import {notifyManager, QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {TRPCClientError} from '@trpc/client'
import {getQueryKey} from '@trpc/react-query'
import {observable} from '@trpc/server/observable'
import {act, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {useAppCardStateMap} from '@/features/app-store/hooks/use-app-status'
import {trpcReact, type RegistryApp, type UserApp} from '@/trpc/trpc'

import {useAppInstallProgress} from './use-app-install'
import {useAppsWithUpdates} from './use-apps-with-updates'
import {useUpdateAllApps} from './use-update-all-apps'
import {useUpdateAppMutation} from './use-update-app'

const registryApps = ['example', 'other'].map((id) => ({id, version: '2.0.0', compatible: true}) as RegistryApp)

vi.mock('@/trpc/trpc', async () => {
	const {createTRPCReact} = await import('@trpc/react-query')
	return {trpcReact: createTRPCReact()}
})
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/utils/i18n', () => ({t: (key: string) => key}))
vi.mock('@/components/ui/toast', () => ({toast: {error: vi.fn()}}))
vi.mock('@/features/app-store/providers/store-actions', () => ({useStoreActions: () => null}))
vi.mock('@/providers/apps', async () => {
	const {trpcReact} = await import('@/trpc/trpc')
	return {
		useApps: () => {
			const {data, isLoading} = trpcReact.apps.list.useQuery()
			return {
				isLoading,
				userApps: data,
				userAppsKeyed: Object.fromEntries((data ?? []).map((app) => [app.id, app])),
			}
		},
	}
})
vi.mock('@/providers/available-apps', () => ({
	useAllAvailableApps: () => ({
		isLoading: false,
		appsKeyed: Object.fromEntries(registryApps.map((app) => [app.id, app])),
	}),
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

describe('app update state', () => {
	let container: HTMLDivElement
	let root: ReturnType<typeof createRoot>
	let queryClient: QueryClient
	let serverApps: UserApp[]
	let update: ReturnType<typeof useUpdateAppMutation>
	let cards: ReturnType<typeof useAppCardStateMap>
	let updates: ReturnType<typeof useAppsWithUpdates>
	let updateAll: ReturnType<typeof useUpdateAllApps>
	let pending: Map<string, {resolve: () => void; reject: (error: Error) => void}>
	let observeApp: (appId: string) => void

	const apps = () => serverApps.map((app) => ({...app}))
	const resolveUpdate = (appId = 'example') => pending.get(appId)!.resolve()
	const rejectUpdate = (error: Error, appId = 'example') => pending.get(appId)!.reject(error)
	const refresh = () =>
		act(async () => {
			await queryClient.invalidateQueries()
		})
	const state = (appId = 'example') => container.querySelector(`[data-app="${appId}"]`)?.textContent

	function Controls() {
		update = useUpdateAppMutation()
		cards = useAppCardStateMap(registryApps)
		updates = useAppsWithUpdates()
		updateAll = useUpdateAllApps()
		return null
	}

	function Observer({appId}: {appId: string}) {
		const {state, progress} = useAppInstallProgress(appId)
		return <div data-app={appId}>{`${state}:${progress ?? '-'}`}</div>
	}

	function SelectedApp() {
		const [appId, setAppId] = useState('example')
		observeApp = setAppId
		return <Observer appId={appId} />
	}

	beforeEach(async () => {
		notifyManager.setScheduler(queueMicrotask)
		serverApps = ['example', 'other'].map((id) => ({id, version: '1.0.0', state: 'ready', progress: 0}) as UserApp)
		pending = new Map()
		queryClient = new QueryClient({defaultOptions: {queries: {staleTime: Infinity, retry: false}}})
		queryClient.setQueryData(getQueryKey(trpcReact.apps.list, undefined, 'query'), apps())
		const client = trpcReact.createClient({
			links: [
				() =>
					({op}) =>
						observable((observer) => {
							const respond = (data: unknown) => {
								observer.next({result: {data}})
								observer.complete()
							}
							if (op.path === 'apps.list') respond(apps())
							else if (op.path === 'apps.state') {
								const app = serverApps.find((app) => app.id === (op.input as {appId: string}).appId)!
								respond({state: app.state, progress: app.progress})
							} else if (op.path === 'apps.update') {
								pending.set((op.input as {appId: string}).appId, {
									resolve: () => respond(true),
									reject: (error) => observer.error(TRPCClientError.from(error)),
								})
							} else throw new Error(`Unexpected procedure: ${op.path}`)
							return () => {}
						}),
			],
		})
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
		await act(async () => {
			root.render(
				<trpcReact.Provider client={client} queryClient={queryClient}>
					<QueryClientProvider client={queryClient}>
						<Controls />
						<SelectedApp />
						<Observer appId='other' />
					</QueryClientProvider>
				</trpcReact.Provider>,
			)
		})
	})

	afterEach(async () => {
		await act(async () => pending.forEach((mutation) => mutation.resolve()))
		await act(async () => root.unmount())
		queryClient.clear()
		container.remove()
		notifyManager.setScheduler((callback) => setTimeout(callback, 0))
	})

	test('keeps a pending update visible when a fresh poll still reports ready', async () => {
		await act(async () => update.mutate({appId: 'example'}))
		await refresh()
		expect(state()).toBe('updating:0')
		expect(state('other')).toBe('ready:-')
		expect(cards.get('example')?.state).toBe('updating')
		expect(cards.get('other')?.state).toBe('ready')
		expect(updates.updatingApps.map((app) => app.id)).toEqual(['example'])
		expect(updates.updatableApps.map((app) => app.id)).toEqual(['other'])

		serverApps[0].state = 'updating'
		serverApps[0].progress = 42
		await refresh()
		expect(state()).toBe('updating:42')
		expect(cards.get('example')).toEqual({state: 'updating', progress: 42})

		serverApps[0].state = 'ready'
		serverApps[0].version = '2.0.0'
		await act(async () => resolveUpdate())
		await refresh()
		expect(state()).toBe('ready:-')
		expect(updates.appsWithUpdates.map((app) => app.id)).toEqual(['other'])
	})

	test('releases the pending update state when preparation fails and allows retrying', async () => {
		await act(async () => update.mutate({appId: 'example'}))
		await refresh()
		expect(state()).toBe('updating:0')

		await act(async () => rejectUpdate(new Error('Preparation failed')))
		await refresh()
		expect(state()).toBe('ready:-')
		expect(cards.get('example')?.state).toBe('ready')
		expect(updates.updatingApps).toEqual([])
		expect(updates.updatableApps.map((app) => app.id)).toContain('example')

		await act(async () => update.mutate({appId: 'example'}))
		await refresh()
		expect(state()).toBe('updating:0')
		await act(async () => resolveUpdate())
	})

	test('only shows the pending update for the currently observed app', async () => {
		await act(async () => update.mutate({appId: 'example'}))
		await refresh()
		expect(state()).toBe('updating:0')

		await act(async () => observeApp('other'))
		expect(state('other')).toBe('ready:-')

		await act(async () => observeApp('example'))
		expect(state()).toBe('updating:0')
	})

	test('follows server state for an update started elsewhere', async () => {
		serverApps[0].state = 'updating'
		serverApps[0].progress = 42
		await refresh()
		await refresh()
		expect(state()).toBe('updating:42')
		expect(cards.get('example')).toEqual({state: 'updating', progress: 42})
		expect(updates.updatingApps.map((app) => app.id)).toEqual(['example'])

		serverApps[0].state = 'ready'
		await refresh()
		expect(state()).toBe('ready:-')
	})

	test('keeps Update all and shelf state consistent as concurrent updates settle independently', async () => {
		await act(async () => updateAll.updateAll())
		await refresh()
		expect([...pending.keys()]).toEqual(['example', 'other'])
		expect(cards.get('example')?.state).toBe('updating')
		expect(cards.get('other')?.state).toBe('updating')
		expect(updates.updatingApps).toHaveLength(2)
		expect(updates.updatableApps).toEqual([])
		expect(updateAll.isUpdating).toBe(true)
		expect(updateAll.canUpdateAll).toBe(false)

		serverApps[0].version = '2.0.0'
		await refresh()
		expect(updates.appsWithUpdates).toHaveLength(2)
		await act(async () => resolveUpdate())
		await refresh()
		expect(updates.appsWithUpdates.map((app) => app.id)).toEqual(['other'])
		expect(cards.get('example')?.state).toBe('ready')
		expect(cards.get('other')?.state).toBe('updating')
		expect(updateAll.isUpdating).toBe(true)
		expect(updateAll.canUpdateAll).toBe(false)

		await act(async () => rejectUpdate(new Error('Preparation failed'), 'other'))
		await refresh()
		expect(cards.get('other')?.state).toBe('ready')
		expect(updates.updatingApps).toEqual([])
		expect(updateAll.isUpdating).toBe(false)
		expect(updateAll.canUpdateAll).toBe(true)
	})
})
