// @vitest-environment jsdom
import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'

import type {MachineAgentControl} from '../types'
import {MachineAgentPresence} from './machine-agent-presence'

const preferences = vi.hoisted(() => ({reduced: false}))
vi.mock('motion/react', async (original) => ({
	...(await original<typeof import('motion/react')>()),
	useReducedMotion: () => preferences.reduced,
}))
vi.mock('@/routes/settings/mcp/magic-rings', () => ({MagicRings: () => <div data-wave />}))
vi.mock('react-i18next', () => ({useTranslation: () => ({t: () => 'Codex is controlling this machine'})}))
let host: HTMLDivElement, root: Root
const control: MachineAgentControl = {
	agent: {tokenId: 'codex', label: 'Codex', agentType: 'codex'},
	lastInputAt: 1,
	observedAt: 1,
	sequence: 1,
}
function render(arrival: boolean, sequence = 1) {
	act(() =>
		root.render(<MachineAgentPresence control={{...control, sequence}} takenOver={false} animateArrival={arrival} />),
	)
}
beforeEach(() => {
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			disconnect() {}
		},
	)
	vi.useFakeTimers()
	preferences.reduced = false
	host = document.createElement('div')
	document.body.append(host)
	root = createRoot(host)
	;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => {
	act(() => root.unmount())
	host.remove()
	vi.useRealTimers()
	vi.unstubAllGlobals()
})
it('starts settled when opening an already controlled console', () => {
	render(false)
	expect(host.querySelector('[data-agent-arriving]')?.getAttribute('data-agent-arriving')).toBe('false')
	expect(host.querySelector('[data-wave]')).toBeNull()
})
it('settles once without restarting when fresh input arrives', () => {
	render(true)
	expect(host.querySelector('[data-agent-arriving]')?.getAttribute('data-agent-arriving')).toBe('true')
	act(() => vi.advanceTimersByTime(600))
	render(true, 2)
	act(() => vi.advanceTimersByTime(899))
	expect(host.querySelector('[data-agent-arriving]')?.getAttribute('data-agent-arriving')).toBe('true')
	act(() => vi.advanceTimersByTime(1))
	expect(host.querySelector('[data-agent-arriving]')?.getAttribute('data-agent-arriving')).toBe('false')
	render(true, 3)
	expect(host.querySelector('[data-agent-arriving]')?.getAttribute('data-agent-arriving')).toBe('false')
})
it('skips the ceremony for reduced motion', () => {
	preferences.reduced = true
	render(true)
	expect(host.querySelector('[data-agent-arriving]')?.getAttribute('data-agent-arriving')).toBe('false')
	expect(host.querySelector('[data-wave]')).toBeNull()
})
