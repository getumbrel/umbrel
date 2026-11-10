// @vitest-environment jsdom
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {TRPCClientError, type TRPCLink} from '@trpc/client'
import {observable} from '@trpc/server/observable'
import {act, type PropsWithChildren, type ReactNode} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import {trpcReact} from '@/trpc/trpc'

import type {AppRouter} from '../../../../umbreld/source/modules/server/trpc/common'
import BackupsRestoreOnboarding from './restore'

vi.mock('@/trpc/trpc', async () => {
	const {createTRPCReact} = await import('@trpc/react-query')
	return {trpcReact: createTRPCReact()}
})
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key}), Trans: () => null}))
vi.mock('@/utils/i18n', () => ({t: (key: string) => key}))
// Keep the device and storage checks real. Stub presentation and the restore flow's own
// dependencies, which only matter once a backup location is being chosen.
vi.mock('@/layouts/bare/shared', () => ({
	primaryButtonProps: {},
	formGroupClass: '',
	Layout: ({subTitle, children}: PropsWithChildren<{subTitle: ReactNode}>) => (
		<div>
			<p>{subTitle}</p>
			{children}
		</div>
	),
}))
vi.mock('@/routes/onboarding/onboarding-footer', () => ({OnboardingAction: {}, OnboardingFooter: () => null}))
vi.mock('@/features/backups/components/restore-location-dropdown', () => ({
	RestoreLocationDropdown: () => <div>choose-backup-location</div>,
}))
vi.mock('@/features/backups/hooks/use-backups', () => ({
	useConnectToRepository: () => ({}),
	useRepositoryBackups: () => ({}),
	useRestoreBackup: () => ({}),
}))
vi.mock('@/features/files/components/dialogs/add-network-share-dialog', () => ({default: () => null}))
vi.mock('@/features/files/components/mini-browser', () => ({MiniBrowser: () => null}))
vi.mock('@/features/files/hooks/use-external-storage', () => ({useExternalStorage: () => ({})}))
vi.mock('@/hooks/use-language', () => ({useLanguage: () => ['en']}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const SET_UP_FIRST = 'backups-restore-setup-first.step1'
const RESTORE_HERE = 'choose-backup-location'
const CHECK_FAILED = 'storage-status.check-failed'

const bootDrive = {id: 'BOOT', type: 'ssd', isSystemDrive: true}
const spareDrive = {id: 'SPARE', type: 'ssd', isSystemDrive: false}

let host: HTMLDivElement
let root: Root
let cache: QueryClient
let productName: string
let drives: (typeof bootDrive)[]
let identityOffline: boolean
let inventoryOffline: boolean
let queries: string[]

beforeEach(() => {
	vi.useFakeTimers()
	host = document.createElement('div')
	root = createRoot(host)
	cache = new QueryClient({defaultOptions: {queries: {retry: false}}})
	productName = 'Mini PC'
	drives = [bootDrive]
	identityOffline = false
	inventoryOffline = false
	queries = []
})
afterEach(() => {
	act(() => root.unmount())
	cache.clear()
	vi.useRealTimers()
})

async function mount() {
	const link: TRPCLink<AppRouter> =
		() =>
		({op}) =>
			observable((observer) => {
				queries.push(op.path)
				const offline = op.path === 'systemNg.device.getIdentity' ? identityOffline : inventoryOffline
				if (offline) {
					observer.error(TRPCClientError.from(new Error('offline')))
					return
				}
				observer.next({result: {data: op.path === 'systemNg.device.getIdentity' ? {productName} : drives}})
				observer.complete()
			})
	const client = trpcReact.createClient({links: [link]})
	await act(async () =>
		root.render(
			<trpcReact.Provider client={client} queryClient={cache}>
				<QueryClientProvider client={cache}>
					<MemoryRouter>
						<BackupsRestoreOnboarding />
					</MemoryRouter>
				</QueryClientProvider>
			</trpcReact.Provider>,
		),
	)
	await settle()
}

// Long enough for the device identity and the storage inventory asked for after it
async function settle() {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(100)
	})
}

const shows = (text: string) => host.textContent!.includes(text)

test('Umbrel Pro sets up with a temporary account before restoring', async () => {
	productName = 'Umbrel Pro'
	await mount()

	expect(shows('backups-restore-setup-first.subtitle-pro')).toBe(true)
	expect(shows(SET_UP_FIRST)).toBe(true)
	expect(shows(RESTORE_HERE)).toBe(false)
})

test('generic hardware with an internal drive to set up does the same', async () => {
	drives = [bootDrive, spareDrive]
	await mount()

	expect(shows('backups-restore-setup-first.subtitle-internal-storage')).toBe(true)
	expect(shows(SET_UP_FIRST)).toBe(true)
	expect(shows(RESTORE_HERE)).toBe(false)
})

test('generic hardware with only its boot drive restores right away', async () => {
	await mount()

	expect(shows(RESTORE_HERE)).toBe(true)
	expect(shows(SET_UP_FIRST)).toBe(false)
})

test.each(['Umbrel Home', 'Raspberry Pi 5 Model B'])('%s restores right away', async (name) => {
	productName = name
	drives = [bootDrive, spareDrive]
	await mount()

	expect(shows(RESTORE_HERE)).toBe(true)
	expect(queries).not.toContain('hardware.internalStorage.getDevices')
})

test.each(['identity', 'inventory'] as const)(
	'a failed %s check offers to check again instead of restoring',
	async (check) => {
		drives = [bootDrive, spareDrive]
		if (check === 'identity') identityOffline = true
		else inventoryOffline = true
		await mount()

		expect(shows(CHECK_FAILED)).toBe(true)
		expect(shows(RESTORE_HERE)).toBe(false)

		identityOffline = false
		inventoryOffline = false
		await act(async () => host.querySelector('button')!.click())
		await settle()

		expect(shows(CHECK_FAILED)).toBe(false)
		expect(shows(SET_UP_FIRST)).toBe(true)
	},
)

test('a failed recheck leaves a restore in progress on screen', async () => {
	await mount()
	expect(shows(RESTORE_HERE)).toBe(true)

	identityOffline = true
	inventoryOffline = true
	await act(async () => cache.invalidateQueries())
	await settle()

	expect(shows(RESTORE_HERE)).toBe(true)
	expect(shows(CHECK_FAILED)).toBe(false)
})
