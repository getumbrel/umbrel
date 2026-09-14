// @vitest-environment jsdom
import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'

import {useAgentAccess, type AgentAccessController} from './use-agent-access'

const api = vi.hoisted(() => ({
	settings: vi.fn(),
	tokens: vi.fn(),
	enable: vi.fn(),
	create: vi.fn(),
	permissions: vi.fn(),
	invalidate: vi.fn(),
}))
vi.mock('@/trpc/trpc', () => ({
	trpcReact: {
		useUtils: () => ({
			mcp: {
				getSettings: {fetch: api.settings, invalidate: api.invalidate},
				listTokens: {fetch: api.tokens, invalidate: api.invalidate},
			},
		}),
		mcp: {
			getSettings: {useQuery: () => ({})},
			listTokens: {useQuery: () => ({})},
			enable: {useMutation: () => ({mutateAsync: api.enable})},
			createToken: {useMutation: () => ({mutateAsync: api.create})},
			setPermissions: {useMutation: () => ({mutateAsync: api.permissions})},
		},
		apps: {list: {useQuery: () => ({})}},
		machines: {list: {useQuery: () => ({})}},
	},
}))
let root: Root, host: HTMLDivElement, controller: AgentAccessController
const permissions = {
	apps: ['photos'],
	files: ['/Home'],
	appStore: false,
	manageSystem: true,
	createMachines: false,
	machines: ['another'],
}
function Harness() {
	controller = useAgentAccess('this-machine', true)
	return null
}
beforeEach(() => {
	vi.resetAllMocks()
	api.settings.mockResolvedValue({enabled: true, permissions})
	api.tokens.mockResolvedValue([{id: 'existing'}])
	api.create.mockResolvedValue({id: 'new', token: 'secret'})
	host = document.createElement('div')
	root = createRoot(host)
	;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
	act(() => root.render(<Harness />))
})
afterEach(() => act(() => root.unmount()))
it('resumes existing connections without minting a replacement token or altering grants', async () => {
	api.settings.mockResolvedValue({enabled: false, permissions})
	await act(async () => {
		expect(await controller.resume()).toBe(true)
	})
	expect(api.enable).toHaveBeenCalledWith(undefined)
	expect(api.create).not.toHaveBeenCalled()
	expect(api.permissions).not.toHaveBeenCalled()
})
it('enables a first connection with agent metadata and keeps its secret in memory', async () => {
	api.settings.mockResolvedValue({enabled: false, permissions})
	api.tokens.mockResolvedValue([])
	api.enable.mockResolvedValue({id: 'first', token: 'secret'})
	await act(async () => {
		await controller.connect('codex')
	})
	expect(api.enable).toHaveBeenCalledWith({label: 'Codex', agentType: 'codex'})
	expect(api.create).not.toHaveBeenCalled()
	expect(api.permissions).not.toHaveBeenCalled()
	expect(controller.credential).toEqual({id: 'first', token: 'secret', agent: 'codex'})
})
it('adds another connection without reenabling an already enabled service', async () => {
	await act(async () => {
		await controller.connect('codex')
	})
	expect(api.enable).not.toHaveBeenCalled()
	expect(api.create).toHaveBeenCalledOnce()
})
it('fetches current grants at action time and preserves unrelated access', async () => {
	api.settings.mockResolvedValue({enabled: true, permissions: {...permissions, machines: ['added-elsewhere']}})
	await act(async () => {
		await controller.grant()
	})
	expect(api.permissions).toHaveBeenCalledWith({...permissions, machines: ['added-elsewhere', 'this-machine']})
})
it('reports failed writes, releases the lock, and permits retry', async () => {
	api.permissions.mockRejectedValueOnce(new Error('offline'))
	await act(async () => {
		expect(await controller.grant()).toBe(false)
	})
	expect(controller.error).toBe(true)
	expect(controller.busy).toBe(false)
	await act(async () => {
		expect(await controller.grant()).toBe(true)
	})
	expect(controller.error).toBe(false)
})
it('rejects duplicate clicks while a mutation is pending', async () => {
	let finish!: () => void
	api.permissions.mockImplementation(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve
			}),
	)
	let first!: Promise<boolean>
	await act(async () => {
		first = controller.grant()
		expect(await controller.grant()).toBe(false)
	})
	expect(api.permissions).toHaveBeenCalledOnce()
	await act(async () => {
		finish()
		await first
	})
})
