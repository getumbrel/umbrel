// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import type {Machine} from '@/features/machines/types'

import {MachineUsbDevices, supportsUsbPassthrough, type UsbDeviceIdentity} from './machine-usb-devices'

const devices = vi.hoisted(() => ({current: [] as unknown[]}))

vi.mock('@/trpc/trpc', () => ({
	trpcReact: {
		machines: {
			usbDevices: {useQuery: () => ({data: devices.current, isSuccess: true})},
		},
	},
}))
vi.mock('@/utils/i18n', () => ({
	t: (key: string, options?: Record<string, string>) => (options ? `${key} ${JSON.stringify(options)}` : key),
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const machine = {id: 'miner', name: 'Miner', platformProfile: 'modern-x86', usbDevices: []} as unknown as Machine
const other = {id: 'home-assistant', name: 'Home Assistant', platformProfile: 'modern-x86'} as unknown as Machine

const device = (port: string, overrides: Record<string, unknown> = {}) => ({
	vendorId: '10c4',
	productId: 'ea60',
	serial: '0001',
	port,
	name: `Adapter ${port}`,
	manufacturer: 'Silicon Labs',
	connected: true,
	...overrides,
})
const identity = (port: string): UsbDeviceIdentity => ({vendorId: '10c4', productId: 'ea60', serial: '0001', port})

describe('MachineUsbDevices', () => {
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
		devices.current = []
	})

	function render(selected: UsbDeviceIdentity[], onChange = vi.fn()) {
		act(() =>
			root.render(
				<MachineUsbDevices
					machine={machine}
					machines={[machine, other]}
					selected={selected}
					onChange={onChange}
					disabled={false}
				/>,
			),
		)
		return onChange
	}

	const row = (name: string) =>
		[...container.querySelectorAll('label')].find((label) => label.textContent?.includes(name))!
	const toggle = (name: string) => row(name).querySelector<HTMLButtonElement>('[role="switch"]')!
	// Dialogs render outside the component, at the end of the page
	const button = (text: string) =>
		[...document.body.querySelectorAll('button')].find((button) => button.textContent === text)!

	test("lists plugged in devices and this machine's unplugged ones, but not other machines' unplugged ones", () => {
		devices.current = [
			device('1'),
			device('2', {connected: false, machineId: 'miner'}),
			device('3', {connected: false, machineId: 'home-assistant'}),
		]
		render([identity('2')])

		const names = [...container.querySelectorAll('label')].map((label) => label.querySelector('span')?.textContent)
		expect(names).toEqual(['Adapter 1', 'Adapter 2'])
		expect(row('Adapter 1').textContent).toContain('Silicon Labs · 10c4:ea60')
		expect(row('Adapter 2').textContent).toContain('machines.usb-device-not-connected')
	})

	test('passes an available device through when switched on', () => {
		devices.current = [device('1'), device('2')]
		const onChange = render([identity('1')])

		expect(toggle('Adapter 1').getAttribute('aria-checked')).toBe('true')
		act(() => toggle('Adapter 2').click())

		expect(onChange).toHaveBeenCalledWith([identity('1'), identity('2')])
	})

	test('keeps devices another machine has or Umbrel is using switched off', () => {
		devices.current = [
			device('1', {machineId: 'home-assistant'}),
			device('2', {hostUse: {reason: 'storage', takeable: false}}),
			device('3', {hostUse: {reason: 'in-use', takeable: false}}),
			device('4', {hostUse: {reason: 'in-use', apps: [{id: 'frigate', name: 'Frigate'}], takeable: false}}),
		]
		render([])

		expect(toggle('Adapter 1').disabled).toBe(true)
		expect(row('Adapter 1').textContent).toContain('machines.usb-device-assigned-to {"machineName":"Home Assistant"}')
		expect(toggle('Adapter 2').disabled).toBe(true)
		expect(row('Adapter 2').textContent).toContain('machines.usb-device-host-storage')
		expect(toggle('Adapter 3').disabled).toBe(true)
		expect(row('Adapter 3').textContent).toContain('machines.usb-device-host-in-use')
		// An app driving the device directly has to be stopped first
		expect(toggle('Adapter 4').disabled).toBe(true)
		expect(row('Adapter 4').textContent).toContain('machines.usb-device-host-app-claimed {"apps":"Frigate"}')
	})

	test('asks before taking a device from the apps using it', () => {
		const apps = [
			{id: 'home-assistant', name: 'Home Assistant'},
			{id: 'zigbee2mqtt', name: 'Zigbee2MQTT'},
		]
		devices.current = [device('1', {hostUse: {reason: 'in-use', apps, takeable: true}})]
		const onChange = render([])

		expect(row('Adapter 1').textContent).toContain(
			'machines.usb-device-host-app {"apps":"Home Assistant, Zigbee2MQTT"}',
		)
		act(() => toggle('Adapter 1').click())
		expect(onChange).not.toHaveBeenCalled()
		expect(document.body.textContent).toContain('machines.usb-take-device-title')

		act(() => button('machines.usb-take-device').click())
		expect(onChange).toHaveBeenCalledWith([identity('1')])
	})

	test('asks before ejecting a drive from Files, and leaves it alone when cancelled', () => {
		devices.current = [device('1', {name: 'Prestige', hostUse: {reason: 'storage', takeable: true}})]
		const onChange = render([])

		expect(row('Prestige').textContent).toContain('machines.usb-device-host-files')
		act(() => toggle('Prestige').click())
		expect(document.body.textContent).toContain('machines.usb-take-drive-title {"name":"Prestige"}')

		act(() => button('cancel').click())
		expect(onChange).not.toHaveBeenCalled()
		expect(document.body.textContent).not.toContain('machines.usb-take-drive-title')
	})

	test('asks before taking a network adapter Umbrel can do without, but never its only connection', () => {
		devices.current = [
			device('1', {name: 'USB Ethernet', hostUse: {reason: 'network', takeable: true}}),
			device('2', {name: 'Only Ethernet', hostUse: {reason: 'network', takeable: false}}),
		]
		const onChange = render([])

		expect(toggle('Only Ethernet').disabled).toBe(true)
		expect(row('Only Ethernet').textContent).toContain('machines.usb-device-host-network-only')
		expect(row('USB Ethernet').textContent).toContain('machines.usb-device-host-network')
		act(() => toggle('USB Ethernet').click())
		expect(document.body.textContent).toContain('machines.usb-take-network-title {"name":"USB Ethernet"}')
		expect(document.body.textContent).toContain(
			'machines.usb-take-network-description {"name":"USB Ethernet","machineName":"Miner"}',
		)

		act(() => button('machines.usb-take-device').click())
		expect(onChange).toHaveBeenCalledWith([identity('1')])
	})

	test('lets the machine switch its own devices off and back on, even while unplugged or in use', () => {
		devices.current = [
			device('1', {connected: false, machineId: 'miner'}),
			device('2', {machineId: 'miner', hostUse: {reason: 'in-use', takeable: false}}),
			device('3', {
				machineId: 'miner',
				hostUse: {reason: 'in-use', apps: [{id: 'home-assistant', name: 'Home Assistant'}], takeable: true},
			}),
			device('4', {machineId: 'miner', hostUse: {reason: 'network', takeable: true}}),
			device('5', {machineId: 'miner', name: 'Prestige', hostUse: {reason: 'storage', takeable: true}}),
		]
		const onChange = render([])

		expect(toggle('Adapter 1').disabled).toBe(false)
		expect(toggle('Adapter 2').disabled).toBe(false)
		expect(row('Adapter 2').textContent).toContain('machines.usb-device-host-in-use')
		expect(row('Adapter 3').textContent).toContain('machines.usb-device-taken-on-start {"apps":"Home Assistant"}')
		expect(row('Adapter 4').textContent).toContain('machines.usb-device-network-taken-on-start')
		expect(row('Prestige').textContent).toContain('machines.usb-device-drive-taken-on-start')
		act(() => toggle('Adapter 1').click())
		expect(onChange).toHaveBeenCalledWith([identity('1')])
		// It already belongs to this machine, so there's nothing to agree to
		act(() => toggle('Adapter 3').click())
		expect(onChange).toHaveBeenLastCalledWith([identity('3')])
	})

	test('switches a device off by its identity', () => {
		devices.current = [device('1', {machineId: 'miner'}), device('2', {machineId: 'miner'})]
		const onChange = render([identity('1'), identity('2')])

		act(() => toggle('Adapter 1').click())

		expect(onChange).toHaveBeenCalledWith([identity('2')])
	})

	test('says when nothing is plugged in', () => {
		render([])
		expect(container.textContent).toContain('machines.usb-devices-empty')
	})

	test('is only offered to machines with a USB controller', () => {
		expect(supportsUsbPassthrough(machine)).toBe(true)
		for (const platformProfile of ['legacy-x86', 'windows-98-x86']) {
			expect(supportsUsbPassthrough({...machine, platformProfile} as Machine)).toBe(false)
		}
	})
})
