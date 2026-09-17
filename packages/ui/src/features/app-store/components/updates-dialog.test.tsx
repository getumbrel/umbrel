// @vitest-environment jsdom

import {act, type ReactNode} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import type {RegistryApp, UserApp} from '@/trpc/trpc'

import {UpdatesDialogConnected} from './updates-dialog'

const fixtures = vi.hoisted(() => ({
	registryApps: [] as RegistryApp[],
	userApps: [] as UserApp[],
	progress: undefined as number | undefined,
	mutate: vi.fn(),
}))

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/utils/i18n', () => ({t: (key: string) => key}))
vi.mock('@/providers/apps', () => ({
	useApps: () => ({
		isLoading: false,
		userApps: fixtures.userApps,
		userAppsKeyed: Object.fromEntries(fixtures.userApps.map((app) => [app.id, app])),
	}),
}))
vi.mock('@/providers/available-apps', () => ({
	useAllAvailableApps: () => ({
		isLoading: false,
		appsKeyed: Object.fromEntries(fixtures.registryApps.map((app) => [app.id, app])),
	}),
}))
vi.mock('@/hooks/use-app-install', () => ({
	pollStates: ['installing', 'uninstalling', 'updating', 'starting', 'restarting', 'stopping'],
	useAppInstallProgress: (id: string) => ({
		state: fixtures.userApps.find((app) => app.id === id)?.state,
		progress: fixtures.progress,
	}),
}))
vi.mock('@/hooks/use-update-app', () => ({
	usePendingAppUpdateIds: () => [],
	useUpdateApp: (appId: string) => ({update: () => fixtures.mutate({appId}), isPending: false}),
	useUpdateAppMutation: () => ({mutate: fixtures.mutate, isPending: false}),
}))
vi.mock('@/utils/dialog', () => ({useDialogOpenProps: () => ({open: true})}))
vi.mock('@/trpc/trpc', () => ({progressBarStates: ['installing', 'updating']}))
vi.mock('@/components/app-icon', () => ({AppIcon: () => null}))
vi.mock('@/components/markdown', () => ({Markdown: ({children}: {children: ReactNode}) => <>{children}</>}))
vi.mock('@/components/ui/animated-number', () => ({AnimatedNumber: ({to}: {to: number}) => <>{Math.round(to)}</>}))
vi.mock('@/components/ui/scroll-area', () => ({ScrollArea: ({children}: {children: ReactNode}) => <>{children}</>}))
vi.mock('@/components/ui/dialog', () => {
	const Wrapper = ({children}: {children: ReactNode}) => <>{children}</>
	return {
		Dialog: Wrapper,
		DialogPortal: Wrapper,
		DialogContent: Wrapper,
		DialogHeader: Wrapper,
		DialogTitle: Wrapper,
	}
})
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

describe('UpdatesDialogConnected', () => {
	let container: HTMLDivElement
	let root: ReturnType<typeof createRoot>
	const render = () => act(async () => root.render(<UpdatesDialogConnected />))
	const button = (label: string) => [...container.querySelectorAll('button')].find((el) => el.textContent === label)

	beforeEach(() => {
		fixtures.registryApps = [
			{id: 'example', name: 'Example', version: '2.0.0', manifestVersion: '1.0', compatible: true} as RegistryApp,
		]
		fixtures.userApps = [{id: 'example', version: '1.0.0', state: 'ready'} as UserApp]
		fixtures.progress = undefined
		fixtures.mutate.mockClear()
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(async () => {
		await act(async () => root.unmount())
		container.remove()
	})

	test('keeps the row through the manifest version change until the update completes', async () => {
		await render()
		await act(async () => button('app-updates.update')!.click())
		expect(fixtures.mutate).toHaveBeenCalledWith({appId: 'example'})

		fixtures.userApps = [{...fixtures.userApps[0], state: 'updating'}]
		await render()
		const row = container.querySelector('h3')
		expect(row?.textContent).toBe('Example')

		// The backend replaces the manifest before pulling images and starting the app.
		fixtures.userApps = [{...fixtures.userApps[0], version: '2.0.0'}]
		fixtures.progress = 42
		await render()
		expect(container.querySelector('h3')).toBe(row)
		expect(container.textContent).not.toContain('app-updates.no-updates')
		expect(container.querySelector('button')?.disabled).toBe(true)

		fixtures.userApps = [{...fixtures.userApps[0], state: 'ready'}]
		await render()
		expect(container.querySelector('h3')).toBeNull()
		expect(container.textContent).toContain('app-updates.no-updates')
	})

	test('shows update progress in the disabled button label and background', async () => {
		fixtures.userApps = [{...fixtures.userApps[0], state: 'updating'}]
		fixtures.progress = 42.4
		await render()

		const progressButton = button('app.updating 42%')
		expect(progressButton?.disabled).toBe(true)
		expect(progressButton?.style.getPropertyValue('--progress-button-progress')).toBe('42%')
		await act(async () => progressButton!.click())
		expect(fixtures.mutate).not.toHaveBeenCalled()
	})

	test('keeps updates started elsewhere visible and only updates the remaining apps', async () => {
		fixtures.registryApps = [...fixtures.registryApps, {...fixtures.registryApps[0], id: 'second', name: 'Second'}]
		fixtures.userApps = [
			{...fixtures.userApps[0], version: '2.0.0', state: 'updating'},
			{...fixtures.userApps[0], id: 'second'},
		]
		await render()
		expect(container.querySelectorAll('h3')).toHaveLength(2)
		await act(async () => button('app-updates.update-all')!.click())
		expect(fixtures.mutate.mock.calls).toEqual([[{appId: 'second'}]])

		fixtures.userApps = fixtures.userApps.map((app) => ({...app, version: '2.0.0', state: 'updating'}))
		await render()
		expect(button('app-updates.updating')?.disabled).toBe(true)
		expect(container.querySelectorAll('h3')).toHaveLength(2)
	})

	test('ignores updating apps that are missing from the registry', async () => {
		fixtures.registryApps = []
		fixtures.userApps = [{...fixtures.userApps[0], state: 'updating'}]
		await render()
		expect(container.querySelector('h3')).toBeNull()
		expect(container.textContent).toContain('app-updates.no-updates')
	})

	test('allows retrying when preparation fails before the version changes', async () => {
		fixtures.userApps = [{...fixtures.userApps[0], state: 'unknown'}]
		await render()
		expect(button('app-updates.update')?.disabled).toBe(false)
	})

	test('keeps incompatible updates visible and disabled', async () => {
		fixtures.registryApps = [{...fixtures.registryApps[0], compatible: false}]
		await render()
		expect(container.querySelector('h3')?.textContent).toBe('Example')
		expect(container.textContent).toContain('app-updates.os-update-required')
		expect(button('app-updates.update')?.disabled).toBe(true)
	})
})
