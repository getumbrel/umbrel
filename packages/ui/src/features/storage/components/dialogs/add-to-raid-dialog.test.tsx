// @vitest-environment jsdom
import {act, type PropsWithChildren} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import type {RaidDevice, StorageDevice} from '../../hooks/use-storage'
import {PendingRaidOperationProvider} from '../../providers/pending-operation-context'
import {AddToRaidDialog} from './add-to-raid-dialog'

vi.mock('react-i18next', async (importOriginal) => ({
	...(await importOriginal<object>()),
	useTranslation: () => ({t: (key: string) => key}),
}))
vi.mock('@/features/storage/hooks/use-active-raid-operation', () => ({useActiveRaidOperation: () => null}))
vi.mock('@/components/ui/toast', () => ({toast: {error: vi.fn()}}))
vi.mock('../storage-donut-chart', () => ({StorageDonutChart: () => null}))
vi.mock('@/components/ui/dialog', () => {
	const Container = ({children}: PropsWithChildren) => <div>{children}</div>
	return Object.fromEntries(
		['Dialog', 'DialogDescription', 'DialogFooter', 'DialogHeader', 'DialogScrollableContent', 'DialogTitle'].map(
			(name) => [name, Container],
		),
	)
})
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLDivElement

const drive = (id: string) =>
	({
		id,
		type: 'ssd',
		name: id,
		size: 2e12,
		roundedSize: 2e12,
		smartStatus: 'healthy',
	}) as StorageDevice

async function render(poolStatus: string) {
	await act(async () =>
		root.render(
			<PendingRaidOperationProvider>
				<AddToRaidDialog
					open
					onOpenChange={() => {}}
					device={drive('new')}
					canChooseMode={false}
					raidType='failsafe'
					poolStatus={poolStatus}
					raidDevices={[drive('a'), drive('b')] as RaidDevice[]}
					addDeviceAsync={async () => true}
					transitionToFailsafeAsync={async () => true}
				/>
			</PendingRaidOperationProvider>,
		),
	)
}

const addButton = () =>
	[...host.querySelectorAll('button')].find((button) => button.textContent === 'storage-manager.add-to-raid.add-ssd')

beforeEach(() => {
	host = document.createElement('div')
	root = createRoot(host)
})
afterEach(() => act(() => root.unmount()))

test('a healthy pool can take a new drive', async () => {
	await render('ONLINE')
	expect(addButton()?.disabled).toBe(false)
	expect(host.textContent).not.toContain('storage-status.degraded-help')
})

test('a degraded pool has to be repaired before a drive can be added', async () => {
	await render('DEGRADED')
	expect(addButton()?.disabled).toBe(true)
	expect(host.textContent).toContain('storage-status.degraded-help')
})
