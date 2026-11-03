// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {GlobalSystemStateProvider, useGlobalSystemState} from '.'

type MutationOptions = {
	networkMode?: 'online' | 'always' | 'offlineFirst'
	retry?: boolean
	onMutate?: () => unknown
	onSuccess?: (success: boolean) => unknown
	onError?: (error: {message: string}) => unknown
}

const mocks = vi.hoisted(() => ({
	cancelQueries: vi.fn(),
	cancelStatus: vi.fn(),
	mutations: {} as Record<string, MutationOptions>,
	statusQuery: {
		data: 'running' as string | undefined,
		error: null as {message: string} | null,
		failureCount: 0,
		isError: false,
		isLoading: false,
	},
	toastError: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
	useQueryClient: () => ({cancelQueries: mocks.cancelQueries}),
}))

vi.mock('react-i18next', async (importOriginal) => ({
	...(await importOriginal<typeof import('react-i18next')>()),
	useTranslation: () => ({t: (key: string) => key}),
}))

vi.mock('@/components/ui/toast', () => ({toast: {error: mocks.toastError}}))

vi.mock('@/providers/global-system-state/restart', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/providers/global-system-state/restart')>()),
	RestartingCover: () => <div>restart.restarting</div>,
}))

vi.mock('@/providers/global-system-state/shutdown', async (importOriginal) => ({
	...(await importOriginal<typeof import('@/providers/global-system-state/shutdown')>()),
	ShuttingDownCover: () => <div>shut-down.shutting-down</div>,
}))

vi.mock('@/trpc/trpc', () => {
	const mutation = (name: string) => ({
		useMutation: (options: MutationOptions) => {
			mocks.mutations[name] = options
			return {mutate: () => options.onMutate?.()}
		},
	})

	return {
		trpcReact: {
			useUtils: () => ({system: {status: {cancel: mocks.cancelStatus}}}),
			system: {
				status: {useQuery: () => mocks.statusQuery},
				restart: mutation('restart'),
				shutdown: mutation('shutdown'),
				factoryReset: mutation('factoryReset'),
			},
			update: {install: mutation('update')},
			migration: {migrate: mutation('migrate')},
			backups: {
				restoreStatus: {useQuery: () => ({data: false})},
			},
		},
	}
})

let systemState: ReturnType<typeof useGlobalSystemState>

function Probe() {
	systemState = useGlobalSystemState()
	return <div>Live app</div>
}

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

describe('GlobalSystemStateProvider power actions', () => {
	let container: HTMLDivElement
	let root: ReturnType<typeof createRoot>

	beforeEach(() => {
		localStorage.clear()
		mocks.statusQuery = {
			data: 'running',
			error: null,
			failureCount: 0,
			isError: false,
			isLoading: false,
		}
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(() => {
		vi.useRealTimers()
		act(() => root.unmount())
		container.remove()
		vi.clearAllMocks()
		mocks.mutations = {}
	})

	async function renderProvider() {
		await act(async () => {
			root.render(
				<GlobalSystemStateProvider>
					<Probe />
				</GlobalSystemStateProvider>,
			)
		})
	}

	test.each([
		['restart', 'restart.restarting'],
		['shutdown', 'shut-down.shutting-down'],
	] as const)('shows the %s cover only after umbreld accepts the action', async (action, coverText) => {
		await renderProvider()

		await act(async () => systemState[action]())
		expect(systemState.isPowerActionPending).toBe(true)
		expect(container.textContent).toContain('Live app')

		await act(async () => mocks.mutations[action].onSuccess?.(true))
		expect(container.textContent).toContain(coverText)
		expect(container.textContent).not.toContain('Live app')
	})

	test.each(['restart', 'shutdown'] as const)('does not queue or retry %s when offline', async (action) => {
		await renderProvider()

		expect(mocks.mutations[action]).toMatchObject({networkMode: 'always', retry: false})
	})

	test('keeps the live page usable when a restart request fails', async () => {
		await renderProvider()

		await act(async () => systemState.restart())
		await act(async () => mocks.mutations.restart.onError?.({message: 'Failed to fetch'}))

		expect(systemState.isPowerActionPending).toBe(false)
		expect(container.textContent).toContain('Live app')
		expect(mocks.toastError).toHaveBeenCalledWith('something-went-wrong', {
			area: 'umbrelos',
			description: 'Failed to fetch',
		})
	})

	test('ignores a restarting status until the restart request is acknowledged', async () => {
		vi.useFakeTimers()
		await renderProvider()

		await act(async () => systemState.restart())
		mocks.statusQuery = {...mocks.statusQuery, data: 'restarting'}
		await renderProvider()
		expect(container.textContent).toContain('Live app')

		mocks.statusQuery = {...mocks.statusQuery, data: 'running'}
		await renderProvider()
		await act(async () => vi.advanceTimersByTime(500))
		expect(mocks.cancelQueries).not.toHaveBeenCalled()
	})

	test('does not start the shutdown-complete timer before acknowledgement', async () => {
		vi.useFakeTimers()
		await renderProvider()

		await act(async () => systemState.shutdown())
		mocks.statusQuery = {...mocks.statusQuery, error: {message: 'Failed to fetch'}, failureCount: 1, isError: true}
		await renderProvider()
		await act(async () => vi.advanceTimersByTime(30_000))

		await act(async () => mocks.mutations.shutdown.onSuccess?.(true))
		expect(container.textContent).toContain('shut-down.shutting-down')
		expect(container.textContent).not.toContain('shut-down.complete')
	})

	test('waits for a successful status request before reloading after restart', async () => {
		vi.useFakeTimers()
		await renderProvider()

		await act(async () => systemState.restart())
		await act(async () => mocks.mutations.restart.onSuccess?.(true))

		mocks.statusQuery = {...mocks.statusQuery, error: {message: 'Failed to fetch'}, failureCount: 1, isError: true}
		await renderProvider()
		expect(mocks.cancelQueries).not.toHaveBeenCalled()

		mocks.statusQuery = {...mocks.statusQuery, error: null, failureCount: 0, isError: false}
		await renderProvider()
		await act(async () => vi.advanceTimersByTime(500))

		expect(mocks.cancelQueries).toHaveBeenCalledOnce()
	})
})
