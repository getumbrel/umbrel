// @vitest-environment jsdom

import {act, type HTMLAttributes, type ReactNode} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, test, vi} from 'vitest'

import {SidebarNetworkStorage} from './sidebar-network-storage'

const mocks = vi.hoisted(() => ({
	shares: [{host: 'nas.local', share: 'Photos', mountPath: '/Network/nas.local/Photos', isMounted: false}],
	removeHostOrShare: vi.fn(),
	navigateToDirectory: vi.fn(),
}))
vi.mock('@/utils/i18n', () => ({t: (key: string) => key}))
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
vi.mock('react-router-dom', () => ({useNavigate: () => vi.fn()}))
vi.mock('@/hooks/use-query-params', () => ({useQueryParams: () => ({addLinkSearchParams: vi.fn()})}))
vi.mock('@/features/files/hooks/use-network-storage', () => ({
	useNetworkStorage: () => ({
		shares: mocks.shares,
		isLoadingShares: false,
		isRemovingShare: false,
		removeHostOrShare: mocks.removeHostOrShare,
	}),
}))
vi.mock('@/features/files/hooks/use-navigate', () => ({
	useNavigate: () => ({currentPath: '/Network', navigateToDirectory: mocks.navigateToDirectory}),
}))
vi.mock('@/features/files/components/shared/file-item-icon', () => ({FileItemIcon: () => <span />}))
vi.mock('@/features/files/components/shared/drag-and-drop', () => ({
	Droppable: ({
		disabled,
		path,
		children,
		...props
	}: HTMLAttributes<HTMLDivElement> & {disabled?: boolean; path: string; children: ReactNode}) => (
		<div {...props} data-drop-disabled={!!disabled} data-path={path}>
			{children}
		</div>
	),
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement

beforeEach(() => {
	vi.clearAllMocks()
	mocks.shares = [{host: 'nas.local', share: 'Photos', mountPath: '/Network/nas.local/Photos', isMounted: false}]
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
})
afterEach(() => {
	act(() => root.unmount())
	container.remove()
})

test('offline hosts stay visible, allow inspecting saved shares, and keep removal enabled', async () => {
	await act(() => root.render(<SidebarNetworkStorage />))
	expect(container.textContent).toContain('nas.local')
	expect(container.textContent).toContain('files-network-storage.disconnected')
	const host = container.querySelector<HTMLElement>('[data-path="/Network/nas.local"]')!
	expect(host.dataset.dropDisabled).toBe('true')
	await act(() => host.click())
	expect(mocks.navigateToDirectory).toHaveBeenCalledWith('/Network/nas.local')

	const remove = container.querySelector<HTMLButtonElement>('button[aria-label="files-action.remove-network-host"]')!
	expect(remove.disabled).toBe(false)
	await act(() => remove.click())
	expect(mocks.removeHostOrShare).toHaveBeenCalledWith('/Network/nas.local')
	// Eject must not also navigate into the removed host.
	expect(mocks.navigateToDirectory).toHaveBeenCalledTimes(1)
})

test('a host with one mounted share stays connected and is only rendered once', async () => {
	mocks.shares.push({host: 'nas.local', share: 'Documents', mountPath: '/Network/nas.local/Documents', isMounted: true})
	await act(() => root.render(<SidebarNetworkStorage />))
	expect(container.querySelectorAll('[data-path="/Network/nas.local"]')).toHaveLength(1)
	expect(container.textContent).not.toContain('files-network-storage.disconnected')
})
