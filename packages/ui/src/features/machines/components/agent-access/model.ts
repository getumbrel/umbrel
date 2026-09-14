import type {RouterOutput} from '@/trpc/trpc'

import type {MachineAgentControl} from '../../types'

export type AgentSettings = RouterOutput['mcp']['getSettings']
export type AgentToken = RouterOutput['mcp']['listTokens'][number]
export type AgentAccessState = 'off' | 'connection' | 'access' | 'ready' | 'active'

export function machineIsGranted(settings: AgentSettings, id: string) {
	return settings.permissions.machines === 'all' || settings.permissions.machines.includes(id)
}
export function machineAgentState(
	settings: AgentSettings,
	tokens: AgentToken[],
	id: string,
	control?: MachineAgentControl,
): AgentAccessState {
	if (!settings.enabled) return 'off'
	if (machineIsGranted(settings, id) && control) return 'active'
	if (!tokens.some((token) => token.lastRequestAt !== null)) return 'connection'
	return machineIsGranted(settings, id) ? 'ready' : 'access'
}
export function grantMachine(permissions: AgentSettings['permissions'], id: string) {
	return {
		...permissions,
		machines: permissions.machines === 'all' ? ('all' as const) : [...new Set([...permissions.machines, id])],
	}
}
