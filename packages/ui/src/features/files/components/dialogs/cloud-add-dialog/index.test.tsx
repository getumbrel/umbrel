// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import CloudAddDialog from '@/features/files/components/dialogs/cloud-add-dialog'

type Locations = {
	locations: Array<{
		id: string
		displayName: string
		remote: {path: string; driveType?: 'personal' | 'business'}
	}>
	truncated: boolean
}

type TestAccount = {
	id: string
	provider: string
	displayName: string
	connection: {kind: string}
}

const mocks = vi.hoisted(() => ({
	locationRequests: new Map<string, (locations: Locations) => void>(),
	fetchLocations: vi.fn(
		(accountId: string) =>
			new Promise<Locations>((resolve) => {
				mocks.locationRequests.set(accountId, resolve)
			}),
	),
	onDialogOpenChange: vi.fn(),
	params: new URLSearchParams(),
	accounts: [
		{id: 'account-a', provider: 'dropbox', displayName: 'Account A', connection: {kind: 'oauth'}},
		{id: 'account-b', provider: 'google-drive', displayName: 'Account B', connection: {kind: 'oauth'}},
		{id: 'onedrive-personal', provider: 'onedrive', displayName: 'OneDrive Personal', connection: {kind: 'oauth'}},
		{id: 'onedrive-business', provider: 'onedrive', displayName: 'OneDrive Business', connection: {kind: 'oauth'}},
	],
	providers: [
		{id: 'dropbox', displayName: 'Dropbox'},
		{id: 'google-drive', displayName: 'Google Drive'},
		{id: 'onedrive', displayName: 'OneDrive'},
	],
}))

vi.mock('react-i18next', () => ({
	initReactI18next: {type: '3rdParty', init: vi.fn()},
	useTranslation: () => ({t: (key: string) => key}),
}))
vi.mock('motion/react', () => ({
	AnimatePresence: ({children}: {children: React.ReactNode}) => children,
	useReducedMotion: () => false,
	motion: {
		div: ({children}: {children: React.ReactNode}) => <div>{children}</div>,
	},
}))
vi.mock('@/components/ui/dialog', () => ({
	Dialog: ({
		children,
		open,
		onOpenChange,
	}: {
		children: React.ReactNode
		open: boolean
		onOpenChange: (open: boolean) => void
	}) => (
		<div data-testid='wizard' data-open={String(open)}>
			{children}
			<button data-testid='close-wizard' onClick={() => onOpenChange(false)}>
				Close
			</button>
		</div>
	),
	DialogContent: ({children}: {children: React.ReactNode}) => <div>{children}</div>,
	DialogDescription: ({children}: {children: React.ReactNode}) => <p>{children}</p>,
	DialogHeader: ({children}: {children: React.ReactNode}) => <header>{children}</header>,
	DialogTitle: ({children}: {children: React.ReactNode}) => <h1>{children}</h1>,
}))
vi.mock('@/components/ui/drawer', () => ({
	Drawer: ({children}: {children: React.ReactNode}) => <div>{children}</div>,
	DrawerContent: ({children}: {children: React.ReactNode}) => <div>{children}</div>,
	DrawerDescription: ({children}: {children: React.ReactNode}) => <p>{children}</p>,
	DrawerHeader: ({children}: {children: React.ReactNode}) => <header>{children}</header>,
	DrawerScroller: ({children}: {children: React.ReactNode}) => <div>{children}</div>,
	DrawerTitle: ({children}: {children: React.ReactNode}) => <h1>{children}</h1>,
}))
vi.mock('@/components/ui/toast', () => ({toast: {error: vi.fn()}}))
vi.mock('@/features/files/components/mini-browser', () => ({
	MiniBrowser: ({open, rootPath}: {open: boolean; rootPath: string}) =>
		open ? <div data-testid={rootPath === '/cloud' ? 'cloud-picker' : 'destination-picker'} /> : null,
}))
vi.mock('@/features/files/hooks/use-cloud', () => ({
	useCloudAccounts: () => ({data: mocks.accounts, isLoading: false}),
	useCloudProviders: () => ({data: mocks.providers, isLoading: false}),
	useCloudConnect: () => ({
		fetchLocations: mocks.fetchLocations,
		browseRemote: vi.fn(),
		createSync: vi.fn(),
	}),
}))
vi.mock('@/features/files/hooks/use-home-path', () => ({useHomePath: () => '/Home', useIsMember: () => false}))
vi.mock('@/features/files/hooks/use-member-shares', () => ({useMemberShares: () => ({sharedWithMe: undefined})}))
vi.mock('@/features/files/hooks/use-navigate', () => ({useNavigate: () => ({navigateToDirectory: vi.fn()})}))
vi.mock('@/features/files/utils/error-messages', () => ({getFilesErrorMessage: (message: string) => message}))
vi.mock('@/hooks/use-is-mobile', () => ({useIsMobile: () => false}))
vi.mock('@/hooks/use-query-params', () => ({useQueryParams: () => ({params: mocks.params})}))
vi.mock('@/trpc/trpc', () => ({
	trpcReact: {
		useUtils: () => ({
			client: {
				files: {
					list: {query: vi.fn(async () => ({files: []}))},
					cloud: {destination: {query: vi.fn()}},
					cleanupCreatedDirectory: {mutate: vi.fn()},
				},
			},
		}),
		files: {
			createDirectory: {useMutation: () => ({mutateAsync: vi.fn()})},
			raidMounts: {useQuery: () => ({data: []})},
		},
	},
}))
vi.mock('@/utils/dialog', () => ({
	useDialogOpenProps: () => ({open: true, onOpenChange: mocks.onDialogOpenChange}),
}))
vi.mock('./source-step', () => ({
	SourceStep: ({
		accounts,
		onSelectAccount,
	}: {
		accounts: TestAccount[]
		onSelectAccount: (account: TestAccount) => void
	}) => (
		<div data-testid='source-step'>
			{accounts.map((account) => (
				<button key={account.id} data-account={account.id} onClick={() => onSelectAccount(account)}>
					{account.displayName}
				</button>
			))}
		</div>
	),
}))
vi.mock('./cloud-folder-step', () => ({
	CloudFolderStep: ({
		state,
		isPersonalOneDrive,
		onBack,
	}: {
		state: string
		isPersonalOneDrive: boolean
		onBack: () => void
	}) => (
		<div data-testid='folder-step' data-state={state} data-personal-onedrive={String(isPersonalOneDrive)}>
			<button data-testid='folder-back' onClick={onBack}>
				Back
			</button>
		</div>
	),
}))
vi.mock('./connect-step', () => ({ConnectStep: () => <div data-testid='connect-step' />}))
vi.mock('./destination-step', () => ({DestinationStep: () => <div data-testid='destination-step' />}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

class ResizeObserverMock {
	observe() {}
	unobserve() {}
	disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock

let container!: HTMLDivElement
let root!: Root

beforeEach(async () => {
	container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
	await act(async () => root.render(<CloudAddDialog />))
})

afterEach(() => {
	act(() => root.unmount())
	document.body.replaceChildren()
	mocks.locationRequests.clear()
	vi.clearAllMocks()
})

const click = (selector: string) => {
	const element = container.querySelector<HTMLElement>(selector)
	expect(element).not.toBeNull()
	act(() => element?.click())
}

const locations = (count: number): Locations => ({
	locations: Array.from({length: count}, (_, index) => ({
		id: `location-${index}`,
		displayName: `Location ${index}`,
		remote: {path: `/location-${index}`},
	})),
	truncated: false,
})

const oneDriveLocation = (driveType: 'personal' | 'business'): Locations => ({
	locations: [
		{
			id: `${driveType}-drive`,
			displayName: `${driveType} OneDrive`,
			remote: {path: '/', driveType},
		},
	],
	truncated: false,
})

describe('Cloud location request generations', () => {
	it('ignores an older account response after another account is selected', async () => {
		click('[data-account="account-a"]')
		click('[data-testid="folder-back"]')
		click('[data-account="account-b"]')

		await act(async () => mocks.locationRequests.get('account-a')?.(locations(2)))

		expect(container.querySelector('[data-testid="folder-step"]')?.getAttribute('data-state')).toBe('loading')
		expect(container.querySelector('[data-testid="wizard"]')?.getAttribute('data-open')).toBe('true')
		expect(container.querySelector('[data-testid="cloud-picker"]')).toBeNull()

		await act(async () => mocks.locationRequests.get('account-b')?.(locations(1)))
		expect(container.querySelector('[data-testid="folder-step"]')?.getAttribute('data-state')).toBe('ready')
	})

	it('does not open a stale picker after leaving the folder step', async () => {
		click('[data-account="account-a"]')
		click('[data-testid="folder-back"]')

		await act(async () => mocks.locationRequests.get('account-a')?.(locations(2)))

		expect(container.querySelector('[data-testid="source-step"]')).not.toBeNull()
		expect(container.querySelector('[data-testid="wizard"]')?.getAttribute('data-open')).toBe('true')
		expect(container.querySelector('[data-testid="cloud-picker"]')).toBeNull()
	})

	it('invalidates a location request as soon as the dialog closes', async () => {
		click('[data-account="account-a"]')
		click('[data-testid="close-wizard"]')

		await act(async () => mocks.locationRequests.get('account-a')?.(locations(2)))

		expect(mocks.onDialogOpenChange).toHaveBeenCalledWith(false)
		expect(container.querySelector('[data-testid="cloud-picker"]')).toBeNull()
	})
})

describe('OneDrive location metadata', () => {
	it('identifies only a personal OneDrive location', async () => {
		click('[data-account="onedrive-personal"]')
		await act(async () => mocks.locationRequests.get('onedrive-personal')?.(oneDriveLocation('personal')))
		expect(container.querySelector('[data-testid="folder-step"]')?.getAttribute('data-personal-onedrive')).toBe('true')

		click('[data-testid="folder-back"]')
		click('[data-account="onedrive-business"]')
		await act(async () => mocks.locationRequests.get('onedrive-business')?.(oneDriveLocation('business')))
		expect(container.querySelector('[data-testid="folder-step"]')?.getAttribute('data-personal-onedrive')).toBe('false')

		click('[data-testid="folder-back"]')
		click('[data-account="account-a"]')
		await act(async () => mocks.locationRequests.get('account-a')?.(locations(1)))
		expect(container.querySelector('[data-testid="folder-step"]')?.getAttribute('data-personal-onedrive')).toBe('false')
	})
})
