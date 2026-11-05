// @vitest-environment jsdom
import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import {PendingRaidOperationProvider, usePendingRaidOperation} from '../providers/pending-operation-context'
import {StorageOperationError} from './storage-operation-error'

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/trpc/trpc', () => ({
	trpcReact: {
		hardware: {
			raid: {
				getStatus: {
					useQuery: () => ({
						data: {failsafeTransitionStatus: reportedError ? {state: 'error', error: reportedError} : undefined},
					}),
				},
			},
		},
	},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement
let root: Root
let reportedError: string | undefined
let state: ReturnType<typeof usePendingRaidOperation>
function Harness({show}: {show: boolean}) {
	state = usePendingRaidOperation()
	return show ? <StorageOperationError /> : null
}
async function render(show = true) {
	await act(async () =>
		root.render(
			<PendingRaidOperationProvider>
				<Harness show={show} />
			</PendingRaidOperationProvider>,
		),
	)
}
beforeEach(() => {
	host = document.createElement('div')
	root = createRoot(host)
	reportedError = undefined
})
afterEach(() => act(() => root.unmount()))

test('a rejected request can be dismissed and stays dismissed when Storage Manager reopens', async () => {
	await render()
	await act(async () => state.setOperationError('operation already in progress'))
	expect(host.textContent).toContain('operation already in progress')
	await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="close"]')!.click())
	expect(state.operationError).toBeNull()
	await render(false)
	await render(true)
	expect(host.textContent).toBe('')
})

test('a local dismissal cannot hide an error still reported by the pool', async () => {
	reportedError = 'transition failed'
	await render()
	await act(async () => state.setOperationError('operation already in progress'))
	await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="close"]')!.click())
	expect(host.textContent).toContain('transition failed')
	expect(host.querySelector('button')).toBeNull()
})

test('an event echo of the current pool error stays visible until the backend resolves it', async () => {
	reportedError = 'transition failed'
	await render()
	await act(async () => state.setOperationError('transition failed'))
	expect(host.querySelector('button')).toBeNull()
	reportedError = undefined
	await render()
	expect(host.querySelector('button')).not.toBeNull()
})
