// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {CloudAccountsListing} from '@/features/files/components/listing/cloud-accounts-listing'
import {SidebarCloud} from '@/features/files/components/sidebar/sidebar-cloud'

const state = vi.hoisted(() => ({
	currentPath: '/Cloud/dropbox-personal',
	navigateToDirectory: vi.fn(),
	navigate: vi.fn(),
	accounts: [
		{
			id: 'dropbox-personal',
			provider: 'dropbox',
			displayName: 'Personal',
			connection: {kind: 'oauth'},
		},
		{
			id: 'dropbox-work',
			provider: 'dropbox',
			displayName: 'Work',
			connection: {kind: 'oauth'},
		},
		{
			id: 'drive-personal',
			provider: 'google-drive',
			displayName: 'Drive account',
			connection: {kind: 'oauth'},
		},
	],
	providers: [
		{id: 'dropbox', displayName: 'Dropbox'},
		{id: 'google-drive', displayName: 'Google Drive'},
	],
	clouds: [
		{
			id: 'dropbox-personal-root',
			accountId: 'dropbox-personal',
			remote: {path: ''},
			destination: {path: '/Home/Dropbox'},
			status: {state: 'idle'},
		},
		{
			id: 'dropbox-work-root',
			accountId: 'dropbox-work',
			remote: {path: ''},
			destination: {path: '/Home/Dropbox Work'},
			status: {state: 'idle'},
		},
		{
			id: 'dropbox-work-projects',
			accountId: 'dropbox-work',
			remote: {path: 'Projects'},
			destination: {path: '/Home/Work Projects'},
			status: {state: 'idle'},
		},
		{
			id: 'drive-personal-projects',
			accountId: 'drive-personal',
			remote: {path: 'Projects'},
			destination: {path: '/Home/Drive Projects'},
			status: {state: 'idle'},
		},
	],
}))

vi.mock('react-i18next', () => ({
	initReactI18next: {type: '3rdParty', init: vi.fn()},
	useTranslation: () => ({t: (key: string) => key}),
}))
vi.mock('react-router-dom', () => ({useNavigate: () => state.navigate}))
vi.mock('motion/react', () => ({
	AnimatePresence: ({children}: {children: React.ReactNode}) => children,
	motion: {
		div: ({children, role, className}: {children: React.ReactNode; role?: string; className?: string}) => (
			<div role={role} className={className}>
				{children}
			</div>
		),
	},
}))
vi.mock('@/components/ui/context-menu', () => ({
	ContextMenu: ({children}: {children: React.ReactNode}) => children,
	ContextMenuContent: () => null,
	ContextMenuItem: () => null,
	ContextMenuTrigger: ({children}: {children: React.ReactNode}) => children,
}))
vi.mock('@/components/ui/card', () => ({Card: ({children}: {children: React.ReactNode}) => <div>{children}</div>}))
vi.mock('@/components/ui/scroll-area', () => ({
	ScrollArea: ({children}: {children: React.ReactNode}) => <div>{children}</div>,
}))
vi.mock('@/features/files/assets/cloud-icon', () => ({CloudIcon: () => <span aria-hidden='true' />}))
vi.mock('@/features/files/components/cloud-account-dialog', () => ({CloudAccountDialog: () => null}))
vi.mock('@/features/files/components/cloud-disconnect-dialog', () => ({CloudDisconnectDialog: () => null}))
vi.mock('@/features/files/components/listing/actions-bar/actions-bar-context', () => ({
	useSetActionsBarConfig: () => vi.fn(),
}))
vi.mock('@/features/files/components/shared/cloud-constellation', () => ({CloudPitchPoints: () => null}))
vi.mock('@/features/files/components/shared/circular-progress', () => ({CircularProgress: () => null}))
vi.mock('@/features/files/hooks/use-cloud', () => ({
	useCloudAccounts: () => ({data: state.accounts}),
	useCloudProviders: () => ({data: state.providers}),
	useCloudSyncs: () => ({data: state.clouds, isLoading: false}),
}))
vi.mock('@/features/files/hooks/use-navigate', () => ({
	useNavigate: () => ({currentPath: state.currentPath, navigateToDirectory: state.navigateToDirectory}),
}))
vi.mock('@/hooks/use-query-params', () => ({
	useQueryParams: () => ({addLinkSearchParams: (params: Record<string, string>) => params}),
}))
vi.mock('@/modules/desktop/dock', () => ({DockSpacer: () => null}))
vi.mock('@/providers/cloud', () => ({useCloudActivity: () => ({activities: []})}))
vi.mock('@/trpc/trpc', () => ({
	trpcReact: {files: {cloud: {syncs: {useQuery: () => ({data: []})}}}},
}))
vi.mock('@/utils/dialog', () => ({useLinkToDialog: () => vi.fn()}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let container!: HTMLDivElement
let root!: Root

beforeEach(() => {
	container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
	act(() => root.render(<SidebarCloud />))
})

afterEach(() => {
	act(() => root.unmount())
	document.body.replaceChildren()
	vi.clearAllMocks()
})

const keyDown = (element: Element, key: string) =>
	act(() => element.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true})))

describe('Cloud sidebar keyboard navigation', () => {
	it('uses native buttons for the Cloud root and add actions', () => {
		const rootButtons = Array.from(container.querySelectorAll(':scope > div:first-child > button'))

		expect(rootButtons).toHaveLength(2)
		expect(rootButtons.every((button) => button.tagName === 'BUTTON')).toBe(true)
		expect(rootButtons[0].getAttribute('aria-current')).toBeNull()
	})

	it('exposes grouped accounts as a roving-focus tree', () => {
		const tree = container.querySelector('[role="tree"]')
		const items = tree?.querySelectorAll('[role="treeitem"]')

		expect(tree).not.toBeNull()
		expect(items).toHaveLength(2)
		expect(items?.[0].tagName).toBe('BUTTON')
		expect(items?.[0].getAttribute('aria-expanded')).toBe('false')
		expect(items?.[0].getAttribute('aria-selected')).toBe('true')
		expect(items?.[0].getAttribute('tabindex')).toBe('0')
		expect(items?.[1].getAttribute('tabindex')).toBe('-1')
	})

	it('expands, traverses, and returns to a provider with arrow keys', () => {
		const provider = container.querySelector<HTMLElement>('[role="treeitem"][aria-expanded="false"]')
		expect(provider).not.toBeNull()

		provider?.focus()
		keyDown(provider!, 'ArrowRight')
		expect(provider?.getAttribute('aria-expanded')).toBe('true')

		keyDown(provider!, 'ArrowRight')
		const accounts = container.querySelectorAll<HTMLElement>('[role="treeitem"][aria-level="2"]')
		expect(accounts).toHaveLength(2)
		expect(document.activeElement).toBe(accounts[0])

		keyDown(accounts[0], 'ArrowDown')
		expect(document.activeElement).toBe(accounts[1])

		keyDown(accounts[1], 'ArrowLeft')
		expect(document.activeElement).toBe(provider)

		accounts[0].click()
		expect(state.navigateToDirectory).toHaveBeenLastCalledWith('/Home/Dropbox')

		accounts[1].click()
		expect(state.navigateToDirectory).toHaveBeenLastCalledWith('/Cloud/dropbox-work')

		const drive = Array.from(container.querySelectorAll<HTMLElement>('[role="treeitem"]')).find((item) =>
			item.textContent?.includes('Google Drive'),
		)
		drive?.click()
		expect(state.navigateToDirectory).toHaveBeenLastCalledWith('/Cloud/drive-personal')
	})
})

describe('Cloud account tile navigation', () => {
	it('opens a sole root directly and otherwise opens the account listing', () => {
		act(() => root.render(<CloudAccountsListing />))
		const personalButton = Array.from(container.querySelectorAll('button')).find((button) =>
			button.textContent?.includes('Personal'),
		)
		const workButton = Array.from(container.querySelectorAll('button')).find((button) =>
			button.textContent?.includes('Work'),
		)
		const driveButton = Array.from(container.querySelectorAll('button')).find((button) =>
			button.textContent?.includes('Drive account'),
		)

		expect(personalButton).not.toBeUndefined()
		expect(container.querySelector('div[role="button"]')).toBeNull()

		personalButton?.click()
		expect(state.navigateToDirectory).toHaveBeenLastCalledWith('/Home/Dropbox')

		workButton?.click()
		expect(state.navigateToDirectory).toHaveBeenLastCalledWith('/Cloud/dropbox-work')

		driveButton?.click()
		expect(state.navigateToDirectory).toHaveBeenLastCalledWith('/Cloud/drive-personal')
	})
})
