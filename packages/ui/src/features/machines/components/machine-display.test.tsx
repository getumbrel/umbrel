// @vitest-environment jsdom

import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, expect, it, vi} from 'vitest'

import type {Machine} from '@/features/machines/types'

import {FirstBootSetupOverlay, MachineDisplay} from './machine-display'

const {consoleProps} = vi.hoisted(() => ({consoleProps: vi.fn()}))
vi.mock('@/utils/i18n', () => ({
	t: (key: string) => key,
}))
vi.mock('@/features/machines/components/machine-console', () => ({
	MachineConsole: (props: {machineId: string; resizeSession: boolean}) => {
		consoleProps(props)
		return <div />
	},
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined

afterEach(() => {
	if (root) act(() => root?.unmount())
	document.body.replaceChildren()
	root = undefined
})

function renderDisplay(machine: Partial<Machine>) {
	if (root) act(() => root?.unmount())
	const container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
	const running = {id: 'test', name: 'Test', state: 'running', osId: 'custom', ...machine} as Machine
	act(() => root?.render(<MachineDisplay machine={running} />))
	return consoleProps.mock.lastCall?.[0] as {machineId: string; resizeSession: boolean}
}

function renderOverlay(delayed: boolean, onOpenConsole = vi.fn()) {
	const container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
	act(() => root?.render(<FirstBootSetupOverlay osName='Debian' delayed={delayed} onOpenConsole={onOpenConsole} />))
	return {container, onOpenConsole}
}

it('keeps the normal unattended setup overlay non-interactive', () => {
	const {container} = renderOverlay(false)

	expect(container.textContent).toContain('machines.completing-setup')
	expect(container.querySelector('button')).toBeNull()
})

it('offers an explicit console escape hatch when setup is delayed', () => {
	const {container, onOpenConsole} = renderOverlay(true)
	const button = container.querySelector('button')

	expect(container.textContent).toContain('machines.setup-taking-longer')
	expect(container.textContent).toContain('machines.setup-taking-longer-description')
	expect(button?.textContent).toBe('machines.open-console')
	act(() => button?.click())
	expect(onOpenConsole).toHaveBeenCalledOnce()
})

it('only lets guests that can follow the browser size resize their session', () => {
	expect(renderDisplay({osId: 'ubuntu', osVariant: 'Desktop'}).resizeSession).toBe(true)
	// Text consoles stay at fbcon's native framebuffer size
	expect(renderDisplay({osId: 'ubuntu', osVariant: 'Server'}).resizeSession).toBe(false)
	// Android keeps the phone-shaped scanout it booted with
	expect(renderDisplay({osId: 'android'}).resizeSession).toBe(false)
})
