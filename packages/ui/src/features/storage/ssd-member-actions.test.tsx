// @vitest-environment jsdom
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {type TRPCLink} from '@trpc/client'
import {observable} from '@trpc/server/observable'
import {act, type PropsWithChildren} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import {trpcReact} from '@/trpc/trpc'

import type {AppRouter} from '../../../../umbreld/source/modules/server/trpc/common'
import type {ReplaceFailedDriveDialog} from './components/dialogs/replace-failed-drive-dialog'
import type {SwapDialog} from './components/dialogs/swap-dialog'
import type {RaidStatus, StorageDevice} from './hooks/use-storage'
import StorageManagerDialog from './index'

vi.mock('@/trpc/trpc', async () => {
	const {createTRPCReact} = await import('@trpc/react-query')
	return {trpcReact: createTRPCReact()}
})
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/utils/i18n', () => ({t: (key: string) => key, maybeT: (key: string) => key}))
vi.mock('@/components/ui/toast', () => ({toast: {error: vi.fn()}}))
// Keep the manager, inventory derivation, and action selection real. Dialog surfaces
// expose the selected identities without rendering unrelated health/confirmation UI.
vi.mock('@/components/ui/immersive-dialog', () => {
	const Container = ({children}: PropsWithChildren) => <div>{children}</div>
	return {
		ImmersiveDialog: Container,
		ImmersiveDialogContent: Container,
		ImmersiveDialogOverlay: () => null,
		immersiveDialogTitleClass: '',
	}
})
vi.mock('@/components/ui/dialog', async (importOriginal) => ({
	...(await importOriginal<object>()),
	DialogPortal: ({children}: PropsWithChildren) => children,
	DialogTitle: ({children}: PropsWithChildren) => children,
}))
vi.mock('@/components/ui/scroll-area', () => ({ScrollArea: ({children}: PropsWithChildren) => <div>{children}</div>}))
vi.mock('@/features/storage/components/dialogs/replace-failed-drive-dialog', () => ({
	ReplaceFailedDriveDialog: (props: React.ComponentProps<typeof ReplaceFailedDriveDialog>) => {
		replacement = props
		return props.open ? <div>replacement dialog</div> : null
	},
}))
vi.mock('@/features/storage/components/dialogs/swap-dialog', () => ({
	SwapDialog: (props: React.ComponentProps<typeof SwapDialog>) => {
		swap = props
		return props.open ? <div>swap dialog</div> : null
	},
}))
vi.mock('@/features/storage/components/dialogs/install-ssd-dialog', () => ({InstallSsdDialog: () => null}))
vi.mock('@/features/storage/components/dialogs/add-to-raid-dialog', () => ({AddToRaidDialog: () => null}))
vi.mock('@/features/storage/components/ssd-shape', () => ({SsdShape: () => null}))
vi.mock('@/features/storage/components/storage-mode-display', () => ({StorageModeDisplay: () => null}))
vi.mock('@/features/storage/components/storage-donut-chart', () => ({StorageDonutChart: () => null}))
vi.mock('@/features/storage/components/storage-operation-error', () => ({StorageOperationError: () => null}))
vi.mock('@/features/storage/components/storage-unavailable', () => ({StorageUnavailable: () => <div>unavailable</div>}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement
let root: Root
let cache: QueryClient
let replacement: React.ComponentProps<typeof ReplaceFailedDriveDialog>
let swap: React.ComponentProps<typeof SwapDialog>
let fixture: {host: 'pro' | 'custom'; devices: StorageDevice[]; pool: RaidStatus}

function ssd(slot: number): StorageDevice {
	return {
		type: 'ssd',
		transport: 'nvme',
		device: `nvme${slot}n1`,
		id: `test-ssd-${slot}`,
		name: `Test SSD ${slot}`,
		model: 'Test SSD',
		serial: `TEST-${slot}`,
		slot,
		size: 2e12,
		roundedSize: 2e12,
		smartStatus: 'healthy',
		isSystemDrive: false,
	}
}

beforeEach(() => {
	vi.useFakeTimers()
	host = document.createElement('div')
	root = createRoot(host)
	cache = new QueryClient({defaultOptions: {queries: {retry: false}}})
	const devices = [ssd(1), ssd(2)]
	fixture = {
		host: 'pro',
		devices,
		pool: {
			name: 'umbrel',
			exists: true,
			status: 'ONLINE',
			raidType: 'failsafe',
			topology: 'raidz',
			devices: devices.map((device) => ({
				id: device.id!,
				status: 'ONLINE',
				readErrors: 0,
				writeErrors: 0,
				checksumErrors: 0,
			})),
			totalSpace: 4e12,
			usableSpace: 2e12,
			usedSpace: 7e11,
			freeSpace: 1.3e12,
			dataErrors: 0,
			accelerator: {exists: false, devices: [], specialSize: 0, l2arcSize: 0},
			replace: undefined,
			failsafeTransitionStatus: undefined,
		},
	}
})
afterEach(() => {
	act(() => root.unmount())
	cache.clear()
	vi.useRealTimers()
})
async function render() {
	const responses: Record<string, unknown> = {
		'hardware.umbrelPro.isUmbrelPro': fixture.host === 'pro',
		'hardware.raid.getStatus': fixture.pool,
		'hardware.internalStorage.getDevices': fixture.devices,
		'files.externalDevices': [],
		'user.get': {name: 'Test', role: 'owner', temperatureUnit: 'c'},
	}
	const link: TRPCLink<AppRouter> =
		() =>
		({op}) =>
			observable((observer) => {
				if (op.type === 'subscription') return
				if (op.type !== 'query' || !(op.path in responses)) throw new Error(`Unexpected test request: ${op.path}`)
				observer.next({result: {data: structuredClone(responses[op.path])}})
				observer.complete()
			})
	const client = trpcReact.createClient({links: [link]})
	await act(async () =>
		root.render(
			<trpcReact.Provider client={client} queryClient={cache}>
				<QueryClientProvider client={cache}>
					<MemoryRouter>
						<StorageManagerDialog />
					</MemoryRouter>
				</QueryClientProvider>
			</trpcReact.Provider>,
		),
	)
	await act(async () => {
		await vi.advanceTimersByTimeAsync(200)
	})
}
async function click(label: string) {
	const button = [...host.querySelectorAll('button')].find((el) => el.textContent === label)
	expect(button, host.textContent ?? '').toBeTruthy()
	await act(async () => button!.click())
}
function failFirstMember() {
	fixture.pool.status = 'DEGRADED'
	fixture.pool.devices![0].status = 'FAULTED'
	return fixture.devices.find((device) => device.id === fixture.pool.devices![0].id)!
}

test('a missing member owns the only Replace button when a spare is ready', async () => {
	fixture.pool.status = 'DEGRADED'
	fixture.pool.devices![1].status = 'REMOVED'
	fixture.devices = [fixture.devices[0], ssd(4)]
	await render()
	expect(
		[...host.querySelectorAll('button')].filter((el) => el.textContent === 'storage-manager.replace'),
	).toHaveLength(1)
	await click('storage-manager.replace')
	expect(replacement.open).toBe(true)
	expect(replacement.failedDevice?.id).toBe(fixture.pool.devices!.find((member) => member.status !== 'ONLINE')!.id)
	expect(replacement.newDevice?.id).not.toBe(replacement.failedDevice?.id)
})

test.each([1, undefined, 99])('failed attached members can repair in place with slot %s', async (slot) => {
	const device = failFirstMember()
	device.slot = slot
	await render()
	await click('storage-manager.replace')
	expect(replacement.open).toBe(true)
	expect(replacement.newDevice?.id).toBe(device.id)
	expect(replacement.failedDevice?.id).toBe(device.id)
	expect(replacement.failedSlot).toBe(slot === 1 ? 1 : null)
	expect(swap.open).toBe(false)
})

test('an unmapped failed member prefers a fitting spare over in-place repair', async () => {
	const device = failFirstMember()
	device.slot = undefined
	fixture.devices.push({...device, id: 'new-spare', slot: 3, name: 'New spare'})
	await render()
	await click('storage-manager.replace')
	expect(replacement.newDevice?.id).toBe('new-spare')
	expect(replacement.failedDevice?.id).toBe(device.id)
})

test('a healthy spare is chosen ahead of a failing one', async () => {
	failFirstMember()
	fixture.devices.push({...ssd(3), id: 'failing-spare', smartStatus: 'unhealthy'}, {...ssd(4), id: 'healthy-spare'})
	await render()
	await click('storage-manager.replace')
	expect(replacement.newDevice?.id).toBe('healthy-spare')
})

test('a safe in-place repair is chosen ahead of a failing spare, which stays free', async () => {
	const device = failFirstMember()
	fixture.devices.push({...ssd(3), id: 'failing-spare', smartStatus: 'unhealthy'})
	await render()
	expect(host.textContent).not.toContain('storage-manager.ready-to-replace')
	await click('storage-manager.replace')
	expect(replacement.newDevice?.id).toBe(device.id)
})

test('a missing member leads the list on hardware without a tray', async () => {
	fixture.host = 'custom'
	fixture.pool.status = 'DEGRADED'
	Object.assign(fixture.pool.devices![1], {status: 'REMOVED', size: 2e12})
	const missingId = fixture.pool.devices![1].id
	fixture.devices = [fixture.devices[0], {...ssd(3), id: 'new-spare'}]
	await render()
	const text = host.textContent!
	expect(text.indexOf('storage-status.not-detected')).toBeGreaterThan(-1)
	expect(text.indexOf('storage-status.not-detected')).toBeLessThan(text.indexOf('Test SSD'))
	await click('storage-manager.replace')
	expect(replacement.failedDevice?.id).toBe(missingId)
	expect(replacement.newDevice?.id).toBe('new-spare')
})

test('a failing spare is still offered when nothing else fits', async () => {
	failFirstMember().smartStatus = 'unhealthy'
	fixture.devices.push({...ssd(3), id: 'failing-spare', smartStatus: 'unhealthy'})
	await render()
	await click('storage-manager.replace')
	expect(replacement.newDevice?.id).toBe('failing-spare')
})

test('a missing member is sized by what the pool remembers of it, not the drives left', async () => {
	fixture.pool.status = 'DEGRADED'
	Object.assign(fixture.pool.devices![1], {status: 'REMOVED', size: 9.9e11})
	fixture.devices = [fixture.devices[0], {...ssd(3), id: 'small-spare', size: 1e12, roundedSize: 1e12}]
	await render()
	await click('storage-manager.replace')
	expect(replacement.newDevice?.id).toBe('small-spare')
	expect(replacement.minRoundedDriveSize).toBe(9.9e11)
})

test.each<[string, () => void]>([
	[
		'on a pool without redundancy',
		() => {
			fixture.pool.raidType = 'storage'
			fixture.pool.topology = 'stripe'
		},
	],
	['while ZFS is still using the drive', () => (fixture.pool.devices![0].status = 'DEGRADED')],
	['when the drive itself is failing', () => (fixture.devices[0].smartStatus = 'unhealthy')],
	['when the surviving drive is failing', () => (fixture.devices[1].smartStatus = 'unhealthy')],
])('in-place repair is not offered %s', async (_, arrange) => {
	failFirstMember()
	arrange()
	await render()
	await click('storage-manager.replace')
	expect(replacement.open).toBe(false)
	expect(swap.open).toBe(true)
})

test('old error counts on the surviving drive do not block in-place repair', async () => {
	const device = failFirstMember()
	fixture.pool.devices![1].readErrors = 2
	await render()
	await click('storage-manager.replace')
	expect(replacement.newDevice?.id).toBe(device.id)
})

test('the replace dialog closes rather than retargeting another failed drive', async () => {
	fixture.pool.status = 'DEGRADED'
	for (const member of fixture.pool.devices!) member.status = 'FAULTED'
	fixture.devices.push({...ssd(3), id: 'new-spare'})
	await render()
	await click('storage-manager.replace')
	const target = replacement.failedDevice!.id
	expect(replacement.open).toBe(true)

	fixture.pool.devices!.find((member) => member.id === target)!.status = 'ONLINE'
	await act(async () => {
		await vi.advanceTimersByTimeAsync(16_000)
	})
	expect(replacement.open).toBe(false)
	expect(replacement.failedDevice).toBeNull()
})

test('a missing member without a spare receives physical insertion instructions', async () => {
	const device = failFirstMember()
	fixture.devices = fixture.devices.filter((candidate) => candidate.id !== device.id)
	await render()
	await click('storage-manager.replace')
	expect(swap.open).toBe(true)
	expect(swap.oldDeviceId).toBe(device.id)
	expect(swap.slot).toBeNull()
})

test('an ONLINE member with an unknown slot retains its Swap action', async () => {
	fixture.devices[0].slot = undefined
	await render()
	// The fallback action is last; tray actions for other members precede it.
	const buttons = [...host.querySelectorAll('button')].filter((el) => el.textContent === 'storage-manager.swap')
	await act(async () => buttons.at(-1)!.click())
	expect(swap.open).toBe(true)
	expect(swap.oldDeviceId).toBe(fixture.devices[0].id)
	expect(replacement.open).toBe(false)
})

test.each(['pro', 'custom'] as const)(
	'an unknown-media ONLINE pool on %s uses established hardware identity only',
	async (hostType) => {
		fixture.host = hostType
		fixture.pool.topology = 'stripe'
		fixture.devices = []
		await render()
		expect(host.textContent?.includes('unavailable')).toBe(hostType !== 'pro')
		if (hostType === 'pro') expect(host.textContent).toContain('storage-status.not-detected')
	},
)

test('Pro identity never bypasses a genuinely unavailable pool', async () => {
	fixture.pool.status = 'UNAVAIL'
	fixture.devices = []
	await render()
	expect(host.textContent).toBe('unavailable')
})
