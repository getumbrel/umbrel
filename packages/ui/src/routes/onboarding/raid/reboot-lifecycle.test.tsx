// @vitest-environment jsdom
import {focusManager, QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {TRPCClientError, type TRPCLink} from '@trpc/client'
import {observable} from '@trpc/server/observable'
import {act, useState, type PropsWithChildren, type ReactNode} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {createMemoryRouter, Outlet, RouterProvider} from 'react-router-dom'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import {EnsureNoRaidMountFailure} from '@/modules/auth/ensure-no-raid-mount-failure'
import {EnsureProDevice} from '@/modules/auth/ensure-pro-device'
import {EnsureUserDoesntExist} from '@/modules/auth/ensure-user-exists'
import {GlobalSystemStateProvider} from '@/providers/global-system-state'
import RaidErrorScreen from '@/routes/raid-error'
import {queryClient as defaultQueryClient} from '@/trpc/query-client'
import {trpcReact} from '@/trpc/trpc'

import type {AppRouter} from '../../../../../umbreld/source/modules/server/trpc/common'
import HddRaidOnboarding from '../hdd-raid'
import HddRaidSetup from '../hdd-raid/setup'
import RaidSetup from './setup'
import {STORAGE_WAIT_NOTICE_DELAY_MS} from './use-storage-wait'

vi.mock('@/trpc/trpc', async () => {
	const {createTRPCReact} = await import('@trpc/react-query')
	return {trpcReact: createTRPCReact()}
})
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key}), Trans: () => null}))
vi.mock('@/utils/i18n', () => ({t: (key: string) => key, maybeT: (key: string) => key}))
// Keep routing, query lifecycles, recovery state, and global status handling real.
// Stub presentation-only dependencies and the unused login action.
vi.mock('@/layouts/bare/shared', () => ({
	primaryButtonProps: {},
	footerLinkClass: '',
	secondaryButtonClasss: '',
	Layout: ({title, children, footer}: PropsWithChildren<{title: string; footer?: ReactNode}>) => (
		<div>
			<h1>{title}</h1>
			{children}
			{footer}
		</div>
	),
}))
vi.mock('@/layouts/bare/onboarding-page', () => ({OnboardingPage: ({children}: PropsWithChildren) => children}))
vi.mock('@/components/ui/debug-only', () => ({DebugOnlyBare: () => null, DebugOnly: () => null}))
vi.mock('@/components/ui/cover-message', () => ({
	BareCoverMessage: ({children}: PropsWithChildren) => children,
	CoverMessage: ({children}: PropsWithChildren) => children,
	CoverMessageParagraph: ({children}: PropsWithChildren) => children,
}))
vi.mock('@/components/ui/connection-lost-screen', () => ({ConnectionLostScreen: () => <div>connection-lost</div>}))
vi.mock('@/components/ui/loading', () => ({Loading: () => null, Spinner: () => null}))
vi.mock('@/components/ui/toast', () => ({toast: {error: () => {}}}))
vi.mock('@/modules/auth/use-auth', () => ({useAuth: () => ({signUpWithToken: () => {}})}))
vi.mock('@/routes/settings/_components/language-dropdown', () => ({LanguageDropdown: () => null}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let cache: QueryClient
let router: ReturnType<typeof createMemoryRouter>
let offline: boolean
let userExists: boolean
let status: 'running' | 'restarting'
let mountOffline: boolean
let mountFailed: boolean
let inventory: 'available' | 'empty' | 'error'
let recoverable: boolean
let productName: string
let identityOffline: boolean
let queries: string[]
let destination: {href: string}
let restoreOutcome: 'accepted' | 'failed' | 'lost'
let registrationLost: boolean
let registrationDelay: number
let registrationStartedAt: number

const credentials = {name: 'Test', password: 'test123', language: 'en'}
const disk = {
	id: 'disk-A',
	device: 'sdb',
	name: 'Drive',
	model: 'Test',
	slot: 1,
	size: 1e12,
	roundedSize: 1e12,
	isSystemDrive: false,
}
const recoveryRoutes = ['/onboarding/hdd-raid', '/onboarding/ssd-raid/setup', '/onboarding/raid/setup']

function unauthorized(message = 'Invalid token') {
	return TRPCClientError.from({error: {message, code: -32001, data: {code: 'UNAUTHORIZED', httpStatus: 401}}})
}

beforeEach(() => {
	vi.useFakeTimers()
	localStorage.clear()
	focusManager.setFocused(true)
	host = document.createElement('div')
	root = createRoot(host)
	cache = new QueryClient({defaultOptions: defaultQueryClient.getDefaultOptions()})
	offline = false
	userExists = false
	status = 'running'
	mountOffline = false
	mountFailed = false
	inventory = 'available'
	recoverable = true
	restoreOutcome = 'accepted'
	registrationLost = false
	registrationDelay = 0
	registrationStartedAt = 0
	productName = 'Umbrel Pro'
	identityOffline = false
	queries = []
	destination = {href: 'unchanged'}
	const testWindow = Object.create(window)
	Object.defineProperty(testWindow, 'location', {value: destination})
	vi.stubGlobal('window', testWindow)
})

afterEach(() => {
	act(() => root.unmount())
	router?.dispose()
	cache.clear()
	focusManager.setFocused(undefined)
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

async function advance(ms: number) {
	// Flush React between polling/retry ticks, just as separate browser tasks would.
	for (let left = ms; left > 0; left -= 100) {
		await act(async () => {
			await vi.advanceTimersByTimeAsync(Math.min(100, left))
		})
	}
}

async function mount(path: string) {
	const link: TRPCLink<AppRouter> =
		() =>
		({op}) =>
			observable((observer) => {
				queries.push(op.path)
				if (op.path === 'user.register') registrationStartedAt = Date.now()
				if (op.path === 'user.register' && registrationDelay) {
					const timer = setTimeout(() => {
						observer.next({result: {data: true}})
						observer.complete()
					}, registrationDelay)
					return () => clearTimeout(timer)
				}
				if (
					offline ||
					(identityOffline && op.path === 'systemNg.device.getIdentity') ||
					(mountOffline && op.path === 'hardware.raid.checkRaidMountFailure') ||
					(inventory === 'error' && op.path === 'hardware.internalStorage.getDevices')
				) {
					observer.error(TRPCClientError.from(new TypeError('Failed to fetch')))
					return
				}
				// The browser still has no token when an account becomes available after reboot.
				if (
					op.path === 'hardware.umbrelPro.isUmbrelPro' ||
					(userExists &&
						[
							'systemNg.device.getIdentity',
							'hardware.internalStorage.getDevices',
							'hardware.raid.hasRecoverableInstall',
							'hardware.raid.recoverExistingInstall',
						].includes(op.path))
				) {
					observer.error(unauthorized())
					return
				}
				if (op.path === 'user.register' && userExists) {
					observer.error(unauthorized('Attempted to register when user is already registered'))
					return
				}
				if (
					(op.path === 'hardware.raid.recoverExistingInstall' && restoreOutcome === 'lost') ||
					(op.path === 'user.register' && registrationLost)
				) {
					observer.error(TRPCClientError.from(new TypeError('Failed to fetch')))
					return
				}
				if (op.path === 'hardware.raid.recoverExistingInstall' && restoreOutcome === 'accepted') status = 'restarting'
				const responses: Record<string, unknown> = {
					'system.status': status,
					'user.exists': userExists,
					'systemNg.device.getIdentity': {productName},
					'hardware.raid.checkRaidMountFailure': mountFailed,
					'hardware.raid.checkRaidMountFailureDevices': [{name: disk.id, isOk: false}],
					'hardware.internalStorage.getDevices':
						inventory === 'empty' ? [] : [{...disk, type: path.includes('hdd') ? 'hdd' : 'ssd'}],
					'hardware.raid.hasRecoverableInstall': recoverable,
					'hardware.raid.recoverExistingInstall': restoreOutcome === 'accepted',
					'hardware.raid.checkInitialRaidSetupStatus': userExists,
					'user.register': true,
				}
				if (!(op.path in responses)) throw new Error(`Unsupported query: ${op.path}`)
				observer.next({result: {data: responses[op.path]}})
				observer.complete()
			})
	const client = trpcReact.createClient({links: [link]})
	// Match the relevant production route guards, including the unguarded setup route.
	router = createMemoryRouter(
		[
			{
				path: '/onboarding',
				element: (
					<EnsureNoRaidMountFailure>
						<Outlet />
					</EnsureNoRaidMountFailure>
				),
				children: [
					{
						path: 'hdd-raid',
						element: (
							<EnsureUserDoesntExist>
								<HddRaidOnboarding />
							</EnsureUserDoesntExist>
						),
					},
					{path: 'ssd-raid/setup', element: <RaidSetup variant='generic' />},
					{
						path: 'raid/setup',
						element: (
							<EnsureProDevice>
								<RaidSetup />
							</EnsureProDevice>
						),
					},
					{path: 'hdd-raid/setup', element: <HddRaidSetup />},
				],
			},
			{
				path: '/state',
				element: (
					<EnsureNoRaidMountFailure>
						<StatefulPage />
					</EnsureNoRaidMountFailure>
				),
			},
			{path: '/login', element: <div>login</div>},
			{path: '/raid-error', element: <RaidErrorScreen />},
		],
		{initialEntries: [{pathname: path, state: {credentials, config: {raidDevices: ['disk-A'], raidType: 'storage'}}}]},
	)
	await act(async () =>
		root.render(
			<trpcReact.Provider client={client} queryClient={cache}>
				<QueryClientProvider client={cache}>
					<GlobalSystemStateProvider>
						<RouterProvider router={router} />
					</GlobalSystemStateProvider>
				</QueryClientProvider>
			</trpcReact.Provider>,
		),
	)
	await advance(300)
}

function StatefulPage() {
	const [edited, setEdited] = useState(false)
	return <button onClick={() => setEdited(true)}>{edited ? 'edited' : 'clean'}</button>
}

async function click(label: string) {
	const button = [...host.querySelectorAll('button')].find((candidate) => candidate.textContent === label)
	expect(button, host.textContent ?? '').toBeTruthy()
	await act(async () => button!.click())
	await advance(100)
}

async function refocus() {
	await act(async () => {
		focusManager.setFocused(false)
		focusManager.setFocused(true)
	})
	await advance(100)
}

const calls = (path: string) => queries.filter((query) => query === path).length

test.each(recoveryRoutes)('recovery survives exhausted discovery retries during reboot on %s', async (path) => {
	await mount(path)
	await click('onboarding.raid.recovery.restore')
	await advance(1000)
	offline = true
	await advance(20_000)
	expect(host.textContent).toContain('onboarding.raid.recovery.restoring.title')
	expect(host.textContent).not.toContain('onboarding.raid.error.detection-failed')
	offline = false
	userExists = true
	status = 'running'
	await advance(3000)
	expect(destination.href).toBe('/')
	expect(calls('hardware.raid.recoverExistingInstall')).toBe(1)
})

test('an empty inventory cannot redirect away from active SSD recovery', async () => {
	await mount('/onboarding/ssd-raid/setup')
	await click('onboarding.raid.recovery.restore')
	inventory = 'empty'
	await advance(4000)
	expect(router.state.location.pathname).toBe('/onboarding/ssd-raid/setup')
	expect(host.textContent).toContain('onboarding.raid.recovery.restoring.title')
	status = 'running'
	userExists = true
	await advance(3000)
	expect(destination.href).toBe('/')
	expect(calls('hardware.raid.recoverExistingInstall')).toBe(1)
})

test('a stale focus check during HDD setup reboot preserves the one registration', async () => {
	recoverable = false
	await mount('/onboarding/hdd-raid/setup')
	expect(calls('user.register')).toBe(1)
	offline = true
	await advance(61_000)
	expect(calls('hardware.raid.checkRaidMountFailure')).toBe(1)
	await refocus()
	expect(calls('hardware.raid.checkRaidMountFailure')).toBe(2)
	expect(host.textContent).toContain('onboarding.raid.configuring.title')
	offline = false
	userExists = true
	await advance(3000)
	expect(host.textContent).toContain('onboarding.account-created.youre-all-set-name')
	expect(calls('user.register')).toBe(1)
})

test('a failed background mount check preserves unrelated page state', async () => {
	await mount('/state')
	await click('clean')
	await advance(61_000)
	mountOffline = true
	await refocus()
	expect(calls('hardware.raid.checkRaidMountFailure')).toBe(2)
	expect(host.textContent).toBe('edited')
})

test('an initial mount-check failure retries, then offers a neutral connection screen and manual retry', async () => {
	mountOffline = true
	await mount('/state')
	expect(host.textContent).not.toContain('storage-status.connection-unavailable')
	await advance(2200)
	expect(calls('hardware.raid.checkRaidMountFailure')).toBe(3)
	expect(host.textContent).toContain('storage-status.connection-unavailable')
	expect(host.textContent).not.toContain('clean')
	mountOffline = false
	await click('storage-status.check-again')
	expect(host.textContent).toBe('clean')
})

test('a confirmed mount failure still redirects after an earlier successful check', async () => {
	await mount('/state')
	await advance(61_000)
	mountFailed = true
	await refocus()
	await advance(1000)
	expect(router.state.location.pathname).toBe('/raid-error')
})

test.each(recoveryRoutes)('initial inventory errors still block fresh setup on %s', async (path) => {
	recoverable = false
	inventory = 'error'
	await mount(path)
	// Observe the exhausted initial retries before the next inventory poll starts.
	await advance(8000)
	expect(host.textContent).toContain('onboarding.raid.error.detection-failed')
	expect(calls('hardware.raid.recoverExistingInstall')).toBe(0)
	expect(calls('user.register')).toBe(0)
})

test.each(['Umbrel Pro', 'Umbrel Home', 'Custom PC'])(
	'boot diagnostics identify %s without an owner token',
	async (name) => {
		productName = name
		mountFailed = true
		await mount('/raid-error')
		expect(host.textContent).toContain('Drive')
		expect(host.querySelector('img[alt="onboarding.raid.ssd-tray-alt"]') !== null).toBe(name === 'Umbrel Pro')
		expect(calls('hardware.umbrelPro.isUmbrelPro')).toBe(0)
	},
)

test('boot diagnostics remain usable when identity fails and Check again recovers it', async () => {
	mountFailed = true
	identityOffline = true
	await mount('/raid-error')
	expect(host.textContent).toContain('Drive')
	expect(host.textContent).toContain('storage-status.check-failed')
	expect(host.querySelector('img[alt="onboarding.raid.ssd-tray-alt"]')).toBeNull()
	identityOffline = false
	await click('storage-status.check-again')
	expect(host.textContent).not.toContain('storage-status.check-failed')
	expect(host.querySelector('img[alt="onboarding.raid.ssd-tray-alt"]')).not.toBeNull()
})

test('boot diagnostics preserve Pro identity when its background refresh fails', async () => {
	mountFailed = true
	await mount('/raid-error')
	identityOffline = true
	await click('storage-status.check-again')
	expect(host.querySelector('img[alt="onboarding.raid.ssd-tray-alt"]')).not.toBeNull()
	expect(host.textContent).toContain('storage-status.check-failed')
})

test('a transient initial mount-check failure recovers automatically', async () => {
	mountOffline = true
	await mount('/state')
	mountOffline = false
	await advance(1200)
	expect(host.textContent).toBe('clean')
	expect(calls('hardware.raid.checkRaidMountFailure')).toBe(2)
})

test('the mount guard keeps rechecking after its initial retries are exhausted', async () => {
	mountOffline = true
	await mount('/state')
	await advance(2500)
	expect(host.textContent).toContain('storage-status.connection-unavailable')
	mountOffline = false
	await advance(5500)
	expect(host.textContent).toBe('clean')
})

async function clickDialog(label: string) {
	const dialog = document.querySelector('[role="dialog"]')
	expect(dialog).not.toBeNull()
	const button = [...dialog!.querySelectorAll('button')].find((candidate) => candidate.textContent === label)
	expect(button).toBeTruthy()
	await act(async () => button!.click())
	await advance(200)
}

test.each(recoveryRoutes)('failed restore offers confirmed setup as new on %s', async (path) => {
	restoreOutcome = 'failed'
	await mount(path)
	await click('onboarding.raid.recovery.restore')
	expect(host.textContent).toContain('onboarding.raid.recovery.failed.title')
	await click('onboarding.raid.recovery.set-up-new')
	expect(document.body.textContent).toContain('onboarding.raid.recovery.set-up-new-dialog.description')
	expect(calls('user.register')).toBe(0)
	await clickDialog('cancel')
	expect(host.textContent).toContain('onboarding.raid.recovery.failed.title')
	await click('onboarding.raid.recovery.set-up-new')
	await clickDialog('onboarding.raid.recovery.set-up-new-dialog.confirm')
	expect(host.textContent).not.toContain('onboarding.raid.recovery.failed.title')
	expect(calls('user.register')).toBe(0)
	expect(calls('hardware.raid.recoverExistingInstall')).toBe(1)
})

test.each(recoveryRoutes)(
	'lost restore response allows a deliberate return after a sustained wait on %s',
	async (path) => {
		restoreOutcome = 'lost'
		await mount(path)
		await click('onboarding.raid.recovery.restore')
		expect(host.textContent).not.toContain('onboarding.raid.return-to-start')
		await advance(STORAGE_WAIT_NOTICE_DELAY_MS + 1000)
		await click('onboarding.raid.return-to-start')
		expect(document.body.textContent).toContain('onboarding.raid.return-to-start-warning')
		await clickDialog('cancel')
		expect(destination.href).toBe('unchanged')
		await click('onboarding.raid.return-to-start')
		await clickDialog('onboarding.raid.return-to-start')
		expect(destination.href).toBe('/')
		expect(calls('hardware.raid.recoverExistingInstall')).toBe(1)
		expect(calls('user.register')).toBe(0)
	},
)

test.each(['/onboarding/hdd-raid/setup', '/onboarding/ssd-raid/setup', '/onboarding/raid/setup'])(
	'the wait notice counts from registration, across the restart transition, on %s',
	async (path) => {
		recoverable = false
		registrationDelay = 120_000
		await mount(path)
		if (!path.includes('hdd')) {
			await click('onboarding.raid.continue')
			if (path.includes('ssd')) await clickDialog('onboarding.raid.recovery.set-up-new-dialog.confirm')
		}
		expect(calls('user.register')).toBe(1)
		expect(calls('hardware.raid.checkInitialRaidSetupStatus')).toBe(0)
		await advance(registrationDelay)
		expect(calls('hardware.raid.checkInitialRaidSetupStatus')).toBeGreaterThan(0)
		await advance(registrationStartedAt + STORAGE_WAIT_NOTICE_DELAY_MS - Date.now() - 1)
		expect(host.textContent).not.toContain('onboarding.raid.still-working')
		await advance(1)
		expect(host.textContent).toContain('onboarding.raid.still-working')
		expect(calls('user.register')).toBe(1)
	},
)

test.each(['/onboarding/hdd-raid/setup', '/onboarding/ssd-raid/setup', '/onboarding/raid/setup'])(
	'lost registration response allows return without repeating setup on %s',
	async (path) => {
		recoverable = false
		registrationLost = true
		await mount(path)
		if (!path.includes('hdd')) {
			await click('onboarding.raid.continue')
			if (path.includes('ssd')) await clickDialog('onboarding.raid.recovery.set-up-new-dialog.confirm')
		}
		expect(calls('user.register')).toBe(1)
		expect(host.textContent).not.toContain('onboarding.raid.return-to-start')
		await advance(STORAGE_WAIT_NOTICE_DELAY_MS + 1000)
		await click('onboarding.raid.return-to-start')
		await clickDialog('onboarding.raid.return-to-start')
		expect(destination.href).toBe('/')
		expect(calls('user.register')).toBe(1)
	},
)
