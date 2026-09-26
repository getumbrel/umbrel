// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import type {RegistryApp, UserApp} from '@/trpc/trpc'

import {
	InstallButtonConnected,
	InstallButtonConnectedController,
	InstallButtonConnectedView,
} from './install-button-connected'

const fixtures = vi.hoisted(() => ({
	app: {
		appStoreId: 'umbrel-app-store',
		id: 'incompatible-update',
		name: 'Incompatible Update',
		version: '2.0.0',
		manifestVersion: '2.0.0',
		compatible: false,
	} as RegistryApp,
	userApp: {
		id: 'incompatible-update',
		version: '1.0.0',
		state: 'ready',
	} as UserApp,
	launch: vi.fn(),
	update: vi.fn(),
	appInstallHook: vi.fn(() => ({state: 'ready', progress: undefined, install: vi.fn()})),
	installReviewDialog: vi.fn(),
	osUpdateDialog: vi.fn(),
}))

vi.mock('react-i18next', async (importOriginal) => ({
	...(await importOriginal<typeof import('react-i18next')>()),
	useTranslation: () => ({t: (key: string) => key}),
}))
vi.mock('@/hooks/use-app-install', () => ({
	useAppInstall: fixtures.appInstallHook,
}))
vi.mock('@/hooks/use-launch-app', () => ({useLaunchApp: () => fixtures.launch}))
vi.mock('@/hooks/use-update-app', () => ({
	useUpdateApp: () => ({update: fixtures.update, isPending: false}),
}))
vi.mock('@/providers/apps', () => ({
	useApps: () => ({isLoading: false, userAppsKeyed: {[fixtures.userApp.id]: fixtures.userApp}}),
}))
vi.mock('@/providers/available-apps', () => ({
	useAllAvailableApps: () => ({
		apps: [fixtures.app],
		ambiguousAppIds: new Set(),
		resolvedAppsKeyed: {[fixtures.app.id]: fixtures.app},
		isLoading: false,
	}),
}))
vi.mock('@/modules/app-store/install-review-dialog', () => ({
	InstallReviewDialog: (props: unknown) => {
		fixtures.installReviewDialog(props)
		return null
	},
}))
vi.mock('@/modules/app-store/os-update-required', () => ({
	OSUpdateRequiredDialog: (props: {open: boolean}) => {
		fixtures.osUpdateDialog(props)
		return props.open ? <div role='dialog'>os-update-required</div> : null
	},
}))
vi.mock('@/trpc/trpc', () => ({
	installedStates: ['ready', 'running', 'stopped'],
	progressBarStates: ['installing', 'updating'],
	trpcReact: {
		user: {get: {useQuery: () => ({data: {role: 'owner'}})}},
		apps: {
			installReview: {
				useQuery: () => ({data: {requiredFolders: [], gpuAccess: false}, refetch: vi.fn()}),
			},
		},
	},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

describe('InstallButtonConnected', () => {
	let container: HTMLDivElement
	let root: ReturnType<typeof createRoot>

	beforeEach(() => {
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(() => {
		act(() => root.unmount())
		container.remove()
		vi.clearAllMocks()
	})

	test('keeps Open and explains an incompatible update without mutating', () => {
		act(() =>
			root.render(
				<MemoryRouter>
					<InstallButtonConnected app={fixtures.app} />
				</MemoryRouter>,
			),
		)

		const buttons = [...container.querySelectorAll('button')]
		const openButton = buttons.find((button) => button.textContent?.includes('app.open'))
		const updateButton = buttons.find((button) => button.textContent?.includes('app-updates.update'))

		expect(openButton).toBeDefined()
		expect(updateButton).toBeDefined()
		act(() => updateButton?.click())

		expect(fixtures.update).not.toHaveBeenCalled()
		expect(container.querySelector('[role="dialog"]')?.textContent).toBe('os-update-required')

		act(() => openButton?.click())
		expect(fixtures.launch).toHaveBeenCalledWith(fixtures.app.id)
	})

	test('shares one behavioral controller and one dialog set across two action renderers', () => {
		act(() =>
			root.render(
				<MemoryRouter>
					<InstallButtonConnectedController app={fixtures.app}>
						<div data-testid='expanded'>
							<InstallButtonConnectedView />
						</div>
						<div data-testid='compact'>
							<InstallButtonConnectedView />
						</div>
					</InstallButtonConnectedController>
				</MemoryRouter>,
			),
		)

		expect(fixtures.appInstallHook).toHaveBeenCalledTimes(1)
		expect(fixtures.installReviewDialog).toHaveBeenCalledTimes(1)
		expect(fixtures.osUpdateDialog).toHaveBeenCalledTimes(1)
		expect(container.querySelector('[data-testid="expanded"] button')).not.toBeNull()
		expect(container.querySelector('[data-testid="compact"] button')).not.toBeNull()
	})
})
