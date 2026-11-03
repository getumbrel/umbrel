// @vitest-environment jsdom

import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import type {Machine} from '@/features/machines/types'

import {MachineUsbDevices, supportsUsbPassthrough, type UsbDeviceIdentity} from './machine-usb-devices'

const query = vi.hoisted(() => ({current: {data: [] as unknown[], isPending: false, isError: false}}))

vi.mock('@/trpc/trpc', () => ({
	trpcReact: {
		machines: {
			usbDevices: {useQuery: () => query.current},
		},
	},
}))
vi.mock('@/utils/i18n', () => ({
	t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key),
}))
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const running = {
	id: 'miner',
	name: 'Miner',
	state: 'running',
	platformProfile: 'modern-x86',
	usbDevices: [],
} as unknown as Machine
const stopped = {...running, state: 'stopped'} as Machine
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
const setDevices = (devices: unknown[]) => (query.current = {data: devices, isPending: false, isError: false})

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
		setDevices([])
	})

	function render(selected: UsbDeviceIdentity[], {machine = running, onChange = vi.fn()} = {}) {
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

	// Each row's switch is labelled with the device's name, and sits in the row
	const toggle = (name: string) =>
		[...container.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find((element) =>
			element.getAttribute('aria-label')?.includes(`"${name}"`),
		)!
	const row = (name: string) => toggle(name).parentElement!
	// Dialogs render outside the component, at the end of the page
	const button = (text: string) =>
		[...document.body.querySelectorAll('button')].find((button) => button.textContent === text)!

	test("lists plugged in devices and this machine's unplugged ones, but not other machines' unplugged ones", () => {
		setDevices([
			device('1'),
			device('2', {connected: false, machineId: 'miner'}),
			device('3', {connected: false, machineId: 'home-assistant'}),
		])
		render([identity('2')])

		const names = [...container.querySelectorAll('h3')].map((heading) => heading.textContent)
		// This machine's devices come first
		expect(names).toEqual(['Silicon Labs Adapter 2', 'Silicon Labs Adapter 1'])
		expect(row('Silicon Labs Adapter 1').textContent).toContain('machines.usb-status-available')
		expect(row('Silicon Labs Adapter 2').textContent).toContain('machines.usb-status-not-plugged-in')
	})

	test('names devices by manufacturer and product, without repeating the manufacturer', () => {
		setDevices([
			device('1', {name: 'Logitech USB Receiver', manufacturer: 'Logitech'}),
			device('2', {name: undefined, manufacturer: undefined}),
		])
		render([])

		const names = [...container.querySelectorAll('h3')].map((heading) => heading.textContent)
		expect(names).toEqual(['Logitech USB Receiver', 'machines.usb-device-unnamed'])
	})

	test('tells identical devices apart by port', () => {
		setDevices([device('1', {serial: undefined}), device('2', {serial: undefined, name: 'Adapter 1'})])
		render([])

		const statuses = [...container.querySelectorAll('h3 + div')].map((status) => status.textContent)
		expect(statuses).toEqual([
			'machines.usb-status-available · machines.usb-port {"port":"1"}',
			'machines.usb-status-available · machines.usb-port {"port":"2"}',
		])
	})

	test('connects an available device when switched on, and says Save will do it', () => {
		setDevices([device('1', {machineId: 'miner'}), device('2')])
		const onChange = render([identity('1')])

		expect(toggle('Silicon Labs Adapter 1').getAttribute('aria-checked')).toBe('true')
		expect(row('Silicon Labs Adapter 1').textContent).toContain(
			'machines.usb-status-connected-to {"machineName":"Miner"}',
		)
		act(() => toggle('Silicon Labs Adapter 2').click())
		expect(onChange).toHaveBeenCalledWith([identity('1'), identity('2')])

		render([identity('1'), identity('2')], {onChange})
		expect(row('Silicon Labs Adapter 2').textContent).toContain(
			'machines.usb-status-connects-on-save {"machineName":"Miner"}',
		)
	})

	test('keeps devices another machine has or Umbrel needs switched off', () => {
		setDevices([
			device('1', {machineId: 'home-assistant'}),
			device('2', {hostUse: {reason: 'storage', takeable: false}}),
			device('3', {hostUse: {reason: 'in-use', takeable: false}}),
			device('4', {hostUse: {reason: 'in-use', apps: [{id: 'frigate', name: 'Frigate'}], takeable: false}}),
			device('5', {hostUse: {reason: 'network', takeable: false}}),
		])
		render([])

		expect(toggle('Silicon Labs Adapter 1').disabled).toBe(true)
		expect(row('Silicon Labs Adapter 1').textContent).toContain(
			'machines.usb-status-connected-to {"machineName":"Home Assistant"}',
		)
		expect(toggle('Silicon Labs Adapter 2').disabled).toBe(true)
		expect(row('Silicon Labs Adapter 2').textContent).toContain('machines.usb-status-needs-drive')
		expect(toggle('Silicon Labs Adapter 3').disabled).toBe(true)
		expect(row('Silicon Labs Adapter 3').textContent).toContain('machines.usb-status-in-use-host')
		// An app driving the device directly has to be stopped first
		expect(toggle('Silicon Labs Adapter 4').disabled).toBe(true)
		expect(row('Silicon Labs Adapter 4').textContent).toContain(
			'machines.usb-status-stop-apps {"apps":"Frigate","count":1}',
		)
		expect(toggle('Silicon Labs Adapter 5').disabled).toBe(true)
		expect(row('Silicon Labs Adapter 5').textContent).toContain('machines.usb-status-needs-network')
		// Rows that can't be switched aren't labels, so clicking them does nothing
		expect(row('Silicon Labs Adapter 1').tagName).toBe('DIV')
	})

	test('asks before taking a device from the apps using it', () => {
		const apps = [
			{id: 'home-assistant', name: 'Home Assistant'},
			{id: 'zigbee2mqtt', name: 'Zigbee2MQTT'},
		]
		setDevices([device('1', {hostUse: {reason: 'in-use', apps, takeable: true}})])
		const onChange = render([])

		expect(row('Silicon Labs Adapter 1').textContent).toContain(
			'machines.usb-status-in-use-apps {"apps":"Home Assistant and Zigbee2MQTT"}',
		)
		act(() => toggle('Silicon Labs Adapter 1').click())
		expect(onChange).not.toHaveBeenCalled()
		expect(document.body.textContent).toContain(
			'machines.usb-connect-title {"name":"Silicon Labs Adapter 1","machineName":"Miner"}',
		)
		expect(document.body.textContent).toContain(
			'machines.usb-connect-apps-description {"apps":"Home Assistant and Zigbee2MQTT","machineName":"Miner"}',
		)

		act(() => button('machines.usb-connect').click())
		expect(onChange).toHaveBeenCalledWith([identity('1')])

		render([identity('1')], {onChange})
		expect(row('Silicon Labs Adapter 1').textContent).toContain(
			'machines.usb-status-moves-from-apps-on-save {"apps":"Home Assistant and Zigbee2MQTT","machineName":"Miner"}',
		)
	})

	test('asks before ejecting a drive from Files, and leaves it alone when cancelled', () => {
		setDevices([device('1', {name: 'Prestige', hostUse: {reason: 'storage', takeable: true}})])
		const onChange = render([])

		expect(row('Silicon Labs Prestige').textContent).toContain('machines.usb-status-in-use-files')
		act(() => toggle('Silicon Labs Prestige').click())
		expect(document.body.textContent).toContain('machines.usb-connect-drive-description {"machineName":"Miner"}')
		expect(button('machines.usb-eject-and-connect')).toBeTruthy()

		act(() => button('cancel').click())
		expect(onChange).not.toHaveBeenCalled()
		expect(document.body.textContent).not.toContain('machines.usb-connect-drive-description')
	})

	test('asks before taking a network adapter Umbrel can do without', () => {
		setDevices([device('1', {name: 'USB Ethernet', hostUse: {reason: 'network', takeable: true}})])
		const onChange = render([])

		expect(row('Silicon Labs USB Ethernet').textContent).toContain('machines.usb-status-in-use-network')
		act(() => toggle('Silicon Labs USB Ethernet').click())
		expect(document.body.textContent).toContain('machines.usb-connect-network-description {"machineName":"Miner"}')

		act(() => button('machines.usb-connect').click())
		expect(onChange).toHaveBeenCalledWith([identity('1')])
	})

	test('lets the machine switch its own devices off and back on, even while unplugged or in use', () => {
		setDevices([
			device('1', {connected: false, machineId: 'miner'}),
			device('2', {machineId: 'miner', hostUse: {reason: 'in-use', takeable: false}}),
			device('3', {
				machineId: 'miner',
				hostUse: {reason: 'in-use', apps: [{id: 'home-assistant', name: 'Home Assistant'}], takeable: true},
			}),
			device('4', {machineId: 'miner', hostUse: {reason: 'network', takeable: true}}),
			device('5', {machineId: 'miner', name: 'Prestige', hostUse: {reason: 'storage', takeable: true}}),
		])
		const all = ['1', '2', '3', '4', '5'].map(identity)
		const onChange = render(all, {machine: stopped})

		expect(row('Silicon Labs Adapter 1').textContent).toContain('machines.usb-status-not-plugged-in')
		expect(row('Silicon Labs Adapter 2').textContent).toContain('machines.usb-status-connects-when-free')
		expect(row('Silicon Labs Adapter 3').textContent).toContain(
			'machines.usb-status-in-use-apps-until-start {"apps":"Home Assistant","machineName":"Miner"}',
		)
		expect(row('Silicon Labs Adapter 4').textContent).toContain(
			'machines.usb-status-in-use-network-until-start {"machineName":"Miner"}',
		)
		expect(row('Silicon Labs Prestige').textContent).toContain(
			'machines.usb-status-in-use-files-until-start {"machineName":"Miner"}',
		)

		render([], {machine: stopped, onChange})
		for (const name of ['Adapter 1', 'Adapter 2', 'Adapter 3', 'Adapter 4', 'Prestige'])
			expect(toggle(`Silicon Labs ${name}`).disabled).toBe(false)
		expect(row('Silicon Labs Adapter 2').textContent).toContain('machines.usb-status-returns-on-save')
		act(() => toggle('Silicon Labs Adapter 1').click())
		expect(onChange).toHaveBeenCalledWith([identity('1')])
		// It already belongs to this machine, so there's nothing to agree to
		act(() => toggle('Silicon Labs Adapter 3').click())
		expect(onChange).toHaveBeenLastCalledWith([identity('3')])
	})

	test('says when switching a device off unplugs it from the running machine', () => {
		setDevices([device('1', {machineId: 'miner'}), device('2', {machineId: 'miner'})])
		const onChange = render([identity('2')])

		expect(row('Silicon Labs Adapter 1').textContent).toContain(
			'machines.usb-status-disconnects-on-save {"machineName":"Miner"}',
		)
		act(() => toggle('Silicon Labs Adapter 2').click())
		expect(onChange).toHaveBeenCalledWith([])
	})

	test('says when nothing is plugged in, and when the list fails to load', () => {
		render([])
		expect(container.textContent).toContain('machines.usb-devices-empty-title')

		query.current = {data: undefined as unknown as unknown[], isPending: false, isError: true}
		render([])
		expect(container.textContent).toContain('machines.usb-devices-load-error')
	})

	test('is only offered to machines with a USB controller', () => {
		expect(supportsUsbPassthrough(running)).toBe(true)
		for (const platformProfile of ['legacy-x86', 'windows-98-x86']) {
			expect(supportsUsbPassthrough({...running, platformProfile} as Machine)).toBe(false)
		}
	})
})
