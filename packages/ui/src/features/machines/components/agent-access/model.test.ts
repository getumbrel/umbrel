import {describe, expect, it} from 'vitest'

import {grantMachine, machineAgentState, type AgentSettings, type AgentToken} from './model'

const permissions: AgentSettings['permissions'] = {
	apps: ['photos'],
	files: ['/Home'],
	appStore: true,
	manageSystem: false,
	createMachines: false,
	machines: ['another'],
}
const token: AgentToken = {id: 'token', label: 'Codex', agentType: 'codex', createdAt: 1, lastRequestAt: 2, clients: []}
const control = {agent: {tokenId: 'token', label: 'Codex'}, lastInputAt: 1, observedAt: 1, sequence: 1}
describe('machine-specific setup states', () => {
	it('never offers control while AI Agents is disabled', () => {
		expect(
			machineAgentState({enabled: false, permissions: {...permissions, machines: 'all'}}, [token], 'machine', control),
		).toBe('off')
	})
	it('distinguishes an unused credential from a connected agent', () => {
		expect(machineAgentState({enabled: true, permissions}, [{...token, lastRequestAt: null}], 'machine')).toBe(
			'connection',
		)
		expect(machineAgentState({enabled: true, permissions}, [token], 'machine')).toBe('access')
	})
	it('recognizes explicit and all-machine grants', () => {
		for (const machines of [['machine'], 'all'] as const) {
			const settings = {
				enabled: true,
				permissions: {...permissions, machines: machines === 'all' ? machines : [...machines]},
			}
			expect(machineAgentState(settings, [token], 'machine')).toBe('ready')
			expect(machineAgentState(settings, [], 'machine', control)).toBe('active')
		}
	})
	it('grants only this machine while preserving every other permission', () => {
		const result = grantMachine(permissions, 'machine')
		expect(result).toEqual({...permissions, machines: ['another', 'machine']})
		expect(permissions.machines).toEqual(['another'])
		expect(grantMachine(result, 'machine')).toEqual(result)
		expect(grantMachine({...permissions, machines: 'all'}, 'machine').machines).toBe('all')
	})
})
