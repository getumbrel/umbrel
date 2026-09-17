// @vitest-environment jsdom

import {act, createRef} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'

import type {MachineAgentControl} from '@/features/machines/types'

import {pointOnMotion} from '../../../../../umbreld/source/modules/machines/input-motion'
import {createAgentGlowTrail} from './agent-glow-trail'
import {AgentPointer} from './agent-pointer'

const preferences = vi.hoisted(() => ({reducedMotion: false}))
vi.mock('motion/react', async (importOriginal) => ({
	...(await importOriginal<typeof import('motion/react')>()),
	useReducedMotion: () => preferences.reducedMotion,
}))
const glow = vi.hoisted(() => ({move: vi.fn(), clear: vi.fn(), dispose: vi.fn()}))
vi.mock('./agent-glow-trail', () => ({createAgentGlowTrail: vi.fn(() => glow)}))
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let reactRoot: Root
let host: HTMLDivElement
const consoleRoot = createRef<HTMLDivElement>()
const screen = createRef<HTMLDivElement>()

function state(patch: Partial<MachineAgentControl> = {}): MachineAgentControl {
	return {
		agent: {tokenId: 'claude', label: 'Claude Code', agentType: 'claude-code'},
		lastInputAt: 10_000,
		observedAt: 10_000,
		sequence: 1,
		pointer: {x: 200, y: 100, width: 800, height: 600},
		...patch,
	}
}

function render(control: MachineAgentControl) {
	act(() =>
		reactRoot.render(
			<>
				<AgentPointer control={control} root={consoleRoot} screen={screen} />
			</>,
		),
	)
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.useFakeTimers({
		toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
	})
	vi.stubGlobal(
		'ResizeObserver',
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	)
	preferences.reducedMotion = false
	consoleRoot.current = document.createElement('div')
	screen.current = document.createElement('div')
	const canvas = document.createElement('canvas')
	screen.current.appendChild(canvas)
	consoleRoot.current.appendChild(screen.current)
	consoleRoot.current.getBoundingClientRect = () => ({left: 20, top: 30, width: 440, height: 340}) as DOMRect
	canvas.getBoundingClientRect = () => ({left: 40, top: 50, width: 400, height: 300}) as DOMRect
	host = document.createElement('div')
	consoleRoot.current.appendChild(host)
	document.body.appendChild(consoleRoot.current)
	reactRoot = createRoot(host)
})

afterEach(() => {
	act(() => reactRoot.unmount())
	vi.useRealTimers()
	vi.unstubAllGlobals()
	document.body.replaceChildren()
})

it('maps guest pixels onto the letterboxed canvas', () => {
	render(state({feedback: {action: 'left_click', phase: 'pressed', startedAt: 10_000}}))
	const pointer = host.querySelector<HTMLElement>('.machine-agent-pointer')!
	expect(pointer.style.transform).toBe('translate(120px, 70px)')
	expect(pointer.dataset.pressed).toBe('true')
})

it('does not replay a press or release that was already over when the snapshot arrived', () => {
	for (const phase of ['pressed', 'released'] as const) {
		render(state({observedAt: 20_000, feedback: {action: 'left_click', phase, startedAt: 10_000}}))
		expect(host.querySelector('.machine-agent-click')).toBeNull()
		expect(host.querySelector<HTMLElement>('.machine-agent-pointer')!.dataset.pressed).toBe('false')
	}
	// The click ring is a 240 ms flash, so even a recent release is over
	render(state({observedAt: 10_400, feedback: {action: 'left_click', phase: 'released', startedAt: 10_000}}))
	expect(host.querySelector('.machine-agent-click')).toBeNull()
})

it('retires transient feedback and does not replay it when the same sequence is refreshed', () => {
	const control = state({feedback: {action: 'key', phase: 'complete', startedAt: 10_000}})
	render(control)
	expect(host.querySelector<HTMLElement>('.machine-agent-pointer')!.dataset.typing).toBe('true')
	act(() => vi.advanceTimersByTime(750))
	expect(host.querySelector<HTMLElement>('.machine-agent-pointer')!.dataset.typing).toBe('false')
	render({...control, observedAt: 10_750})
	expect(host.querySelector<HTMLElement>('.machine-agent-pointer')!.dataset.typing).toBe('false')
	render({...control, sequence: 2, observedAt: 10_750, feedback: {...control.feedback!, startedAt: 10_750}})
	expect(host.querySelector<HTMLElement>('.machine-agent-pointer')!.dataset.typing).toBe('true')
})

it('joins an in-flight curve at its server-relative age even with a different browser clock', () => {
	const motion = {
		from: {x: 0, y: 100},
		to: {x: 800, y: 100},
		control: {x: 400, y: 140},
		startedAt: 9_800,
		durationMs: 400,
	}
	render(state({pointer: {x: 800, y: 100, width: 800, height: 600, motion}}))
	const pointer = host.querySelector<HTMLElement>('.machine-agent-pointer')!
	expect(pointer.style.transform).toBe(
		`translate(${20 + pointOnMotion(motion, 0.5).x / 2}px, ${20 + pointOnMotion(motion, 0.5).y / 2}px)`,
	)
	act(() => vi.advanceTimersByTime(240))
	expect(pointer.style.transform).toBe('translate(420px, 70px)')
	expect(pointer.dataset.moving).toBe('false')
})

it('keeps a long typing action visible until its actual completion', () => {
	const control = state({feedback: {action: 'type', phase: 'active', startedAt: 10_000}})
	render(control)
	act(() => vi.advanceTimersByTime(75_000))
	render({...control, observedAt: 85_000})
	expect(host.querySelector<HTMLElement>('.machine-agent-pointer')!.dataset.typing).toBe('true')
	render({
		...control,
		sequence: 2,
		observedAt: 85_000,
		feedback: {...control.feedback!, phase: 'complete', startedAt: 85_000},
	})
	act(() => vi.advanceTimersByTime(750))
	expect(host.querySelector<HTMLElement>('.machine-agent-pointer')!.dataset.typing).toBe('false')
})

it('keeps tracking with reduced motion without creating a WebGL trail', () => {
	preferences.reducedMotion = true
	const motion = {
		from: {x: 0, y: 100},
		to: {x: 800, y: 100},
		control: {x: 400, y: 140},
		startedAt: 9_800,
		durationMs: 400,
	}
	render(state({pointer: {x: 800, y: 100, width: 800, height: 600, motion}}))
	expect(host.querySelector<HTMLElement>('.machine-agent-pointer')!.style.transform).toBe(
		`translate(${20 + pointOnMotion(motion, 0.5).x / 2}px, ${20 + pointOnMotion(motion, 0.5).y / 2}px)`,
	)
	expect(createAgentGlowTrail).not.toHaveBeenCalled()
})

it('takes the accent from the agent and rebuilds the glow when it changes', () => {
	render(state())
	expect(
		host.querySelector<HTMLElement>('.machine-agent-pointer-layer')!.style.getPropertyValue('--agent-accent'),
	).toBe('#d97757')
	render(state({agent: {tokenId: 'codex', agentType: 'codex', label: 'Codex'}}))
	expect(
		host.querySelector<HTMLElement>('.machine-agent-pointer-layer')!.style.getPropertyValue('--agent-accent'),
	).toBe('#7168ff')
	expect(glow.dispose).toHaveBeenCalled()
})

it('holds contact for a drag and clears it on release, while showing scroll direction separately', () => {
	render(state({feedback: {action: 'left_click_drag', phase: 'pressed', startedAt: 10_000}}))
	expect(host.querySelector<HTMLElement>('.machine-agent-pointer')!.dataset.pressed).toBe('true')
	render(state({sequence: 2, feedback: {action: 'left_click_drag', phase: 'released', startedAt: 10_000}}))
	expect(host.querySelector<HTMLElement>('.machine-agent-pointer')!.dataset.pressed).toBe('false')
	// The scroll cue waits for the wheel input itself, not the approach
	render(state({sequence: 3, feedback: {action: 'scroll', phase: 'moving', startedAt: 10_000}}))
	expect(host.querySelector('.machine-agent-scroll')).toBeNull()
	render(state({sequence: 4, feedback: {action: 'scroll', phase: 'active', direction: 'left', startedAt: 10_000}}))
	expect(host.querySelector<HTMLElement>('.machine-agent-scroll')!.dataset.direction).toBe('left')
})

it('does not restart or advance a long-press ring when a snapshot refreshes the same phase', () => {
	const control = state({feedback: {action: 'long_press', phase: 'pressed', startedAt: 10_000, durationMs: 1000}})
	render(control)
	act(() => vi.advanceTimersByTime(200))
	render({...control, observedAt: 10_200})
	expect(host.querySelector<SVGCircleElement>('.machine-agent-hold circle')!.style.animationDelay).toBe('0ms')
})

it('anchors the flowing glow to the actual pointer and clears it during precision input', () => {
	const motion = {
		from: {x: 0, y: 100},
		to: {x: 800, y: 100},
		control: {x: 400, y: 140},
		startedAt: 9_800,
		durationMs: 400,
	}
	render(state({pointer: {x: 800, y: 100, width: 800, height: 600, motion}}))
	expect(glow.move).toHaveBeenLastCalledWith(
		20 + pointOnMotion(motion, 0.5).x / 2,
		20 + pointOnMotion(motion, 0.5).y / 2,
		440,
		340,
		true,
	)
	act(() => vi.advanceTimersByTime(300))
	expect(glow.move).toHaveBeenLastCalledWith(420, 70, 440, 340, false)
	render(state({sequence: 2, feedback: {action: 'left_click_drag', phase: 'pressed', startedAt: 10_000}}))
	expect(glow.clear).toHaveBeenCalled()
	glow.clear.mockClear()
	render(state({sequence: 3, feedback: {action: 'type', phase: 'active', startedAt: 10_000}}))
	expect(glow.clear).toHaveBeenCalled()
})

it('keeps the cursor usable without WebGL and recreates the glow after context restoration', () => {
	vi.mocked(createAgentGlowTrail).mockReturnValueOnce(undefined)
	render(state())
	expect(host.querySelector('.machine-agent-cursor svg')).not.toBeNull()
	expect(host.querySelector<HTMLElement>('.machine-agent-pointer')!.style.transform).toBe('translate(120px, 70px)')
	act(() => host.querySelector('.machine-agent-trail')!.dispatchEvent(new Event('webglcontextrestored')))
	expect(createAgentGlowTrail).toHaveBeenCalledTimes(2)
})

it.each([
	['codex', '@codex'],
	['claude-code', '@claude'],
	['unrecognized', '@agent'],
])('labels %s with %s', (agentType, handle) => {
	render(state({agent: {tokenId: 'agent', agentType, label: 'Custom connection name'}}))
	expect(host.querySelector('.machine-agent-name')?.textContent).toBe(handle)
})

it('tucks the name bubble inside the console at its edges, tail still pointing at the tip', () => {
	const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(74)
	const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(22)
	const bubble = () => host.querySelector<HTMLElement>('.machine-agent-name')!
	try {
		render(state())
		expect(bubble().style.transform).toBe('translate(24px, 28px)')
		expect(bubble().dataset.tail).toBe('tl')
		render(state({pointer: {x: 200, y: 600, width: 800, height: 600}}))
		expect(bubble().style.transform).toBe('translate(24px, -34px)')
		expect(bubble().dataset.tail).toBe('bl')
		render(state({pointer: {x: 800, y: 600, width: 800, height: 600}}))
		expect(bubble().style.transform).toBe('translate(-86px, -34px)')
		expect(bubble().dataset.tail).toBe('br')
	} finally {
		width.mockRestore()
		height.mockRestore()
	}
})
