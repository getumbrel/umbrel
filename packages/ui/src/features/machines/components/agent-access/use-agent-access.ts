import {useRef, useState} from 'react'

import type {McpPermissions} from '@/routes/settings/mcp/access'
import {MCP_AGENTS, type McpAgentId} from '@/routes/settings/mcp/agents'
import {trpcReact} from '@/trpc/trpc'

import {grantMachine} from './model'

// Credentials live only in this mounted machine's session, never in storage or URLs.
export function useAgentAccess(machineId: string, open: boolean) {
	const utils = trpcReact.useUtils()
	const settingsQ = trpcReact.mcp.getSettings.useQuery(undefined, {enabled: open, refetchInterval: open ? 3000 : false})
	const tokensQ = trpcReact.mcp.listTokens.useQuery(undefined, {enabled: open, refetchInterval: open ? 3000 : false})
	const appsQ = trpcReact.apps.list.useQuery(undefined, {enabled: open})
	const machinesQ = trpcReact.machines.list.useQuery(undefined, {enabled: open})
	const enable = trpcReact.mcp.enable.useMutation()
	const create = trpcReact.mcp.createToken.useMutation()
	const permissions = trpcReact.mcp.setPermissions.useMutation()
	const [credential, setCredential] = useState<{id: string; token: string; agent: McpAgentId | 'generic'}>()
	const [busy, setBusy] = useState(false)
	const lock = useRef(false)
	const [error, setError] = useState(false)
	const refresh = async () => {
		await Promise.allSettled([utils.mcp.getSettings.invalidate(), utils.mcp.listTokens.invalidate()])
	}
	const perform = async (operation: () => Promise<void>) => {
		if (lock.current) return false
		lock.current = true
		setBusy(true)
		setError(false)
		try {
			await operation()
			await refresh()
			return true
		} catch {
			setError(true)
			await refresh()
			return false
		} finally {
			lock.current = false
			setBusy(false)
		}
	}
	return {
		settings: settingsQ.data,
		tokens: tokensQ.data,
		apps: appsQ.data?.map((app) => app.id) ?? [],
		machines: machinesQ.data ?? [],
		loading: settingsQ.isLoading || tokensQ.isLoading,
		loadError: settingsQ.isError || tokensQ.isError,
		machinesError: machinesQ.isError,
		machinesLoading: machinesQ.isLoading,
		appsLoading: appsQ.isLoading,
		retry: () => {
			void settingsQ.refetch()
			void tokensQ.refetch()
			void machinesQ.refetch()
		},
		busy,
		error,
		credential,
		clearCredential: () => setCredential(undefined),
		connect: (agent: McpAgentId | 'generic') =>
			perform(async () => {
				const fresh = await utils.mcp.getSettings.fetch()
				const tokens = await utils.mcp.listTokens.fetch()
				const metadata = {label: MCP_AGENTS.find((item) => item.id === agent)?.name ?? 'Other agent', agentType: agent}
				let result: {id: string; token: string} | null
				if (!fresh.enabled && tokens.length === 0) result = await enable.mutateAsync(metadata)
				else {
					if (!fresh.enabled) await enable.mutateAsync(undefined)
					result = await create.mutateAsync(metadata)
				}
				if (result) setCredential({...result, agent})
			}),
		resume: () =>
			perform(async () => {
				const fresh = await utils.mcp.getSettings.fetch()
				if (!fresh.enabled) await enable.mutateAsync(undefined)
			}),
		grant: () =>
			perform(async () => {
				const fresh = await utils.mcp.getSettings.fetch()
				if (!fresh.enabled) throw new Error('disabled')
				await permissions.mutateAsync(grantMachine(fresh.permissions, machineId))
			}),
		updatePermissions: (patch: Partial<McpPermissions>) =>
			perform(async () => {
				const fresh = await utils.mcp.getSettings.fetch()
				await permissions.mutateAsync({...fresh.permissions, ...patch})
			}),
	}
}
export type AgentAccessController = ReturnType<typeof useAgentAccess>
