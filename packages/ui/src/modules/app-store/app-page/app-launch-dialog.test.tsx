// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter, useLocation} from 'react-router-dom'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {useLaunchApp} from '@/hooks/use-launch-app'
import type {UserApp} from '@/trpc/trpc'
import {getAlwaysOpenHttpsRequiredApps, setAlwaysOpenHttpsRequiredApps} from '@/utils/misc'

import {AppLaunchDialog} from './app-launch-dialog'

const fixtures = vi.hoisted(() => ({
	app: {} as UserApp,
	trackOpen: vi.fn(),
	hideCredentials: vi.fn(),
	warning: vi.fn(),
	role: 'owner',
}))
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('@/components/ui/toast', () => ({toast: {warning: fixtures.warning}}))
vi.mock('@/providers/apps', () => ({
	useApps: () => ({userAppsKeyed: {[fixtures.app.id]: fixtures.app}}),
	useUserApp: (id: string | null) => ({isLoading: false, app: id === fixtures.app.id ? fixtures.app : undefined}),
}))
vi.mock('@/trpc/trpc', () => ({
	trpcReact: {
		useUtils: () => ({apps: {invalidate: vi.fn(), recentlyOpened: {invalidate: vi.fn()}}}),
		apps: {
			trackOpen: {useMutation: () => ({mutate: fixtures.trackOpen})},
			hideCredentialsBeforeOpen: {useMutation: () => ({mutate: fixtures.hideCredentials, isPending: false})},
		},
		user: {get: {useQuery: () => ({data: {role: fixtures.role}})}},
	},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

function Harness({direct = false, path}: {direct?: boolean; path?: string}) {
	const launchApp = useLaunchApp()
	const location = useLocation()
	return (
		<>
			<button id='launch' onClick={() => launchApp(fixtures.app.id, {direct, path})}>
				Launch
			</button>
			<output>
				{location.pathname}
				{location.search}
			</output>
			<AppLaunchDialog />
		</>
	)
}

describe('app launch dialog', () => {
	let root: ReturnType<typeof createRoot>
	let container: HTMLDivElement

	beforeEach(() => {
		vi.useFakeTimers()
		vi.spyOn(window, 'open').mockReturnValue({focus: vi.fn()} as unknown as Window)
		fixtures.app = {
			id: 'demo',
			name: 'Demo',
			port: 1234,
			path: '/app/',
			hiddenService: 'demo.onion',
			requiresHttps: true,
			credentials: {showBeforeOpen: true, defaultUsername: 'admin', defaultPassword: 'secret'},
		} as UserApp
		fixtures.role = 'owner'
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(() => {
		act(() => root.unmount())
		container.remove()
		localStorage.clear()
		vi.restoreAllMocks()
		vi.unstubAllGlobals()
		vi.clearAllMocks()
		vi.useRealTimers()
	})

	async function launch(props: {direct?: boolean; path?: string} = {}) {
		await act(async () =>
			root.render(
				<MemoryRouter initialEntries={['/?keep=1']}>
					<Harness {...props} />
				</MemoryRouter>,
			),
		)
		await act(async () => container.querySelector<HTMLButtonElement>('#launch')!.click())
	}

	async function clickButton(text: string) {
		const button = [...document.querySelectorAll('button')].find((button) => button.textContent === text)
		expect(button).toBeDefined()
		await act(async () => button!.click())
	}

	async function settleClose() {
		await act(async () => vi.advanceTimersByTimeAsync(200))
	}
	function dialog() {
		return document.querySelector('[role="dialog"]')
	}
	function checkboxes() {
		return [...document.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')]
	}

	test('shows both requirements in one persistent modal and opens the deep link over HTTPS once', async () => {
		await launch({path: '/deep/link?next=a&view=b#item'})
		expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
		expect(dialog()?.textContent).toContain('default-credentials.username')
		expect(dialog()?.textContent).toContain('app-requires-https-dialog-description')
		expect(checkboxes()).toHaveLength(2)
		await settleClose()
		expect(dialog()).not.toBeNull()
		expect(window.open).not.toHaveBeenCalled()
		await clickButton('app-requires-https-dialog-action')
		await settleClose()
		expect(window.open).toHaveBeenCalledExactlyOnceWith('https://localhost:1234/deep/link?next=a&view=b#item', '_blank')
		expect(fixtures.trackOpen).toHaveBeenCalledExactlyOnceWith({appId: 'demo'})
		expect(dialog()).toBeNull()
		expect(container.querySelector('output')?.textContent).toBe('/?keep=1')
	})

	test('shows credentials alone for an HTTP app and preserves its manifest path', async () => {
		fixtures.app.requiresHttps = false
		await launch()
		expect(checkboxes()).toHaveLength(1)
		expect(dialog()?.textContent).not.toContain('app-requires-https-dialog-description')
		await clickButton('default-credentials.open')
		expect(window.open).toHaveBeenCalledExactlyOnceWith('http://localhost:1234/app/', '_blank')
	})

	test.each([
		{requiresHttps: false, showBeforeOpen: true, action: 'default-credentials.open', protocol: 'http:'},
		{requiresHttps: true, showBeforeOpen: false, action: 'app-requires-https-dialog-action', protocol: 'https:'},
	])(
		'replacing an open launch modal does not inherit its requirements or deep link ($protocol)',
		async ({requiresHttps, showBeforeOpen, action, protocol}) => {
			await launch({path: '/first-app-only'})
			expect(checkboxes()).toHaveLength(2)

			// Cmd+K can launch another app while this URL-driven dialog is still open.
			fixtures.app = {
				...fixtures.app,
				id: 'second',
				name: 'Second',
				port: 5678,
				path: '/second-app/',
				requiresHttps,
				credentials: {...fixtures.app.credentials, showBeforeOpen},
			}
			await launch()

			expect(checkboxes()).toHaveLength(1)
			expect(dialog()?.textContent?.includes('default-credentials.username')).toBe(showBeforeOpen)
			expect(dialog()?.textContent?.includes('app-requires-https-dialog-description')).toBe(requiresHttps)
			await clickButton(action)
			await settleClose()
			expect(window.open).toHaveBeenCalledExactlyOnceWith(`${protocol}//localhost:5678/second-app/`, '_blank')
			expect(fixtures.trackOpen).toHaveBeenCalledExactlyOnceWith({appId: 'second'})
			expect(container.querySelector('output')?.textContent).toBe('/?keep=1')
		},
	)

	test('shows HTTPS alone when credentials have been hidden', async () => {
		fixtures.app.credentials.showBeforeOpen = false
		await launch({path: '/deep-link'})
		expect(checkboxes()).toHaveLength(1)
		expect(dialog()?.textContent).not.toContain('default-credentials.username')
		await clickButton('app-requires-https-dialog-action')
		expect(window.open).toHaveBeenCalledExactlyOnceWith('https://localhost:1234/deep-link', '_blank')
	})

	test('saved HTTPS preference leaves credentials visible and still opens HTTPS', async () => {
		setAlwaysOpenHttpsRequiredApps(true)
		await launch()
		expect(checkboxes()).toHaveLength(1)
		expect(dialog()?.textContent).toContain('default-credentials.username')
		expect(dialog()?.textContent).not.toContain('app-requires-https-dialog-description')
		await clickButton('app-requires-https-dialog-action')
		expect(window.open).toHaveBeenCalledExactlyOnceWith('https://localhost:1234/app/', '_blank')
		expect(getAlwaysOpenHttpsRequiredApps()).toBe(true)
	})

	test('opens immediately when both preferences are saved', async () => {
		fixtures.app.credentials.showBeforeOpen = false
		setAlwaysOpenHttpsRequiredApps(true)
		await launch()
		expect(dialog()).toBeNull()
		expect(window.open).toHaveBeenCalledExactlyOnceWith('https://localhost:1234/app/', '_blank')
	})

	test('widget launches skip credentials but retain HTTPS guidance and their deep link', async () => {
		await launch({direct: true, path: '/widget'})
		expect(dialog()?.textContent).not.toContain('default-credentials.username')
		expect(dialog()?.textContent).toContain('app-requires-https-dialog-description')
		await clickButton('app-requires-https-dialog-action')
		expect(window.open).toHaveBeenCalledExactlyOnceWith('https://localhost:1234/widget', '_blank')
	})

	test('credentials preference is independent and does not remove the current credentials', async () => {
		await launch()
		await act(async () => checkboxes()[0].click())
		expect(fixtures.hideCredentials).toHaveBeenCalledExactlyOnceWith({appId: 'demo', value: true})
		expect(getAlwaysOpenHttpsRequiredApps()).toBe(false)
		fixtures.app.credentials.showBeforeOpen = false
		await act(async () =>
			root.render(
				<MemoryRouter>
					<Harness />
				</MemoryRouter>,
			),
		)
		expect(dialog()?.textContent).toContain('default-credentials.username')
		expect(dialog()?.textContent).toContain('app-requires-https-dialog-description')
	})

	test('HTTPS preference is saved only on Open and does not hide credentials', async () => {
		await launch()
		await act(async () => checkboxes()[1].click())
		expect(getAlwaysOpenHttpsRequiredApps()).toBe(false)
		expect(fixtures.hideCredentials).not.toHaveBeenCalled()
		await clickButton('app-requires-https-dialog-action')
		expect(getAlwaysOpenHttpsRequiredApps()).toBe(true)
		expect(fixtures.hideCredentials).not.toHaveBeenCalled()
	})

	test('dismissal resets an unsaved HTTPS checkbox on the next launch', async () => {
		await launch()
		await act(async () => checkboxes()[1].click())
		await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})))
		await settleClose()
		expect(dialog()).toBeNull()
		expect(getAlwaysOpenHttpsRequiredApps()).toBe(false)
		await launch()
		expect(checkboxes()[1].getAttribute('aria-checked')).toBe('false')
		expect(window.open).not.toHaveBeenCalled()
	})

	test('HTTPS instructions navigate to the guide without saving the checkbox or opening the app', async () => {
		await launch()
		await act(async () => checkboxes()[1].click())
		await clickButton('app-requires-https-dialog-learn')
		await settleClose()
		expect(container.querySelector('output')?.textContent).toBe('/settings/advanced/network?httpsAccess=guide')
		expect(getAlwaysOpenHttpsRequiredApps()).toBe(false)
		expect(window.open).not.toHaveBeenCalled()
	})

	test('members get no HTTPS instructions link, since only the owner can open them', async () => {
		fixtures.role = 'member'
		await launch()
		expect(dialog()?.textContent).toContain('app-requires-https-dialog-always-open')
		expect(dialog()?.textContent).not.toContain('app-requires-https-dialog-learn')
	})

	test.each([
		['https://umbrel.local', 'https://umbrel.local:1234/app/'],
		['http://umbrel.onion', 'http://demo.onion/app/'],
	])('does not show HTTPS guidance when already using %s', async (origin, expectedUrl) => {
		const location = new URL(origin)
		vi.stubGlobal('location', location)
		await launch()
		expect(dialog()?.textContent).not.toContain('app-requires-https-dialog-description')
		await clickButton('default-credentials.open')
		expect(window.open).toHaveBeenCalledExactlyOnceWith(expectedUrl, '_blank')
	})

	test('Tor-only apps warn without opening a launch modal off Tor', async () => {
		fixtures.app.torOnly = true
		await launch()
		expect(dialog()).toBeNull()
		expect(fixtures.warning).toHaveBeenCalledOnce()
		expect(window.open).not.toHaveBeenCalled()
	})

	test('member app launches do not send owner-only open tracking', async () => {
		fixtures.role = 'member'
		fixtures.app.credentials.showBeforeOpen = false
		await launch()
		await clickButton('app-requires-https-dialog-action')
		expect(window.open).toHaveBeenCalledOnce()
		expect(fixtures.trackOpen).not.toHaveBeenCalled()
	})
})
