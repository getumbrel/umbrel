// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {MachineNetworkModeRow, type MachineNetworkMode} from './machine-network-mode'

const capabilities = vi.hoisted(() => ({current: undefined as unknown, isLoading: false}))

vi.mock('@/features/machines/hooks/use-machines', () => ({
	useMachineCapabilities: () => ({capabilities: capabilities.current, isLoading: capabilities.isLoading}),
}))
vi.mock('@/utils/i18n', () => ({t: (key: string) => key}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

describe('MachineNetworkModeRow', () => {
	let container: HTMLDivElement
	let root: ReturnType<typeof createRoot>

	beforeEach(() => {
		container = document.createElement('div')
		document.body.appendChild(container)
		root = createRoot(container)
	})

	afterEach(() => {
		act(() => root.unmount())
		container.remove()
		capabilities.current = undefined
		capabilities.isLoading = false
	})

	function render(
		value: MachineNetworkMode,
		{onChange = vi.fn(), savedMode}: {onChange?: () => void; savedMode?: MachineNetworkMode} = {},
	) {
		act(() => root.render(<MachineNetworkModeRow value={value} onChange={onChange} savedMode={savedMode} />))
		const [nat, bridged] = [...container.querySelectorAll<HTMLButtonElement>('[role=radio]')]
		return {nat, bridged, text: container.textContent ?? '', onChange}
	}

	test('lets a machine join the LAN when Umbrel is wired', () => {
		capabilities.current = {lanBridge: {available: true, interface: 'enp1s0'}}
		const {nat, bridged, text, onChange} = render('nat')

		expect(nat.getAttribute('aria-checked')).toBe('true')
		expect(bridged.disabled).toBe(false)
		expect(text).not.toContain('machines.network-lan-reconnect-note')

		act(() => bridged.click())
		expect(onChange).toHaveBeenCalledWith('bridged')
		expect(render('bridged').text).toContain('machines.network-lan-reconnect-note')
	})

	test("doesn't repeat the reconnect note for a machine that's already on the LAN", () => {
		capabilities.current = {lanBridge: {available: true, interface: 'enp1s0'}}
		expect(render('bridged', {savedMode: 'bridged'}).text).not.toContain('machines.network-lan-reconnect-note')
	})

	test('says Ethernet is needed when Umbrel is on Wi-Fi or unwired', () => {
		for (const reason of ['wifi', 'no-ethernet']) {
			capabilities.current = {lanBridge: {available: false, reason}}
			const {nat, bridged} = render('nat')

			expect(nat.disabled).toBe(false)
			expect(bridged.disabled).toBe(true)
			expect(bridged.textContent).toContain('machines.network-needs-ethernet')
		}
	})

	test('waits for the Ethernet check before offering the LAN', () => {
		capabilities.isLoading = true
		expect(render('nat').bridged.disabled).toBe(true)
	})

	test('keeps a bridged machine switchable on Wi-Fi and warns it cannot start', () => {
		capabilities.current = {lanBridge: {available: false, reason: 'wifi'}}
		const {nat, bridged, text, onChange} = render('bridged', {savedMode: 'bridged'})

		expect(bridged.getAttribute('aria-checked')).toBe('true')
		expect(bridged.disabled).toBe(false)
		expect(text).toContain('machines.network-lan-cant-start-wifi')
		act(() => nat.click())
		expect(onChange).toHaveBeenCalledWith('nat')
	})
})
