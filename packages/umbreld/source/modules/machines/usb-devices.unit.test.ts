import fsp from 'node:fs/promises'
import os from 'node:os'
import nodePath from 'node:path'

import fse from 'fs-extra'
import {afterEach, describe, expect, test, vi} from 'vitest'

import {
	buildUsbHostdevXml,
	deviceNumberKey,
	type HostUsbDevice,
	isBlockDeviceOnUsbDevice,
	listHostUsbDevices,
	parseUsbHostdevAddresses,
	planUsbAssignments,
	resolveUsbAssignments,
	usbDeviceReplacing,
	usbHostUse,
	usbPortIdentity,
	usbDriveDisks,
	usbReservationRules,
	usbTopologyFingerprint,
} from './usb-devices.ts'

const roots: string[] = []

afterEach(async () => Promise.all(roots.splice(0).map((root) => fse.remove(root))))

async function createSysfs() {
	const root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'usb-sysfs-'))
	roots.push(root)
	await fse.ensureDir(nodePath.join(root, 'devices'))
	await fse.ensureDir(nodePath.join(root, 'bus/usb/devices'))
	return root
}

// Lay a device out the way the kernel does: a directory under its host
// controller (nested inside any hubs it sits behind) linked from the USB bus
async function addUsbDevice(
	root: string,
	{
		controller = 'pci0000:00/0000:00:14.0',
		bus = 3,
		chain,
		device = 2,
		attributes = {},
		children = {},
	}: {
		controller?: string
		bus?: number
		chain: string
		device?: number
		attributes?: Record<string, string>
		children?: Record<string, string>
	},
) {
	const hops = chain.split('.').map((_, index, ports) => `${bus}-${ports.slice(0, index + 1).join('.')}`)
	const rootHub = nodePath.join(root, 'devices', controller, `usb${bus}`)
	const path = nodePath.join(rootHub, ...hops)
	const files = {
		idVendor: '0403',
		idProduct: '6001',
		busnum: String(bus),
		devnum: String(device),
		bDeviceClass: '00',
		...attributes,
		...children,
	}
	for (const [file, contents] of Object.entries(files)) {
		await fse.outputFile(nodePath.join(path, file), `${contents}\n`)
	}
	const link = async (name: string, target: string) => {
		await fse.remove(nodePath.join(root, 'bus/usb/devices', name))
		await fsp.symlink(target, nodePath.join(root, 'bus/usb/devices', name))
	}
	// The root hub and the device's interfaces are listed alongside it
	await fse.ensureDir(rootHub)
	await link(`usb${bus}`, rootHub)
	await fse.ensureDir(nodePath.join(path, `${bus}-${chain}:1.0`))
	await link(`${bus}-${chain}:1.0`, nodePath.join(path, `${bus}-${chain}:1.0`))
	await link(`${bus}-${chain}`, path)
	return path
}

function hostDevice(overrides: Partial<HostUsbDevice> = {}): HostUsbDevice {
	return {
		vendorId: '10c4',
		productId: 'ea60',
		serial: '0001',
		port: 'pci0000:00/0000:00:14.0/1',
		bus: 3,
		device: 2,
		hub: false,
		sysfsPath: '/sys/devices/pci0000:00/0000:00:14.0/usb3/3-1',
		...overrides,
	}
}

const identity = ({vendorId, productId, serial, port}: HostUsbDevice) => ({vendorId, productId, serial, port})

describe('host USB device discovery', () => {
	test('lists plugged in devices by model, serial, and physical port', async () => {
		const root = await createSysfs()
		await addUsbDevice(root, {
			chain: '2',
			device: 4,
			attributes: {
				idVendor: '10C4',
				idProduct: 'EA60',
				serial: 'A1B2C3',
				product: 'CP2102 USB to UART Bridge Controller',
				manufacturer: 'Silicon Labs',
			},
		})

		const devices = await listHostUsbDevices(root)

		// Root hubs and interfaces are not devices of their own
		expect(devices).toHaveLength(1)
		expect(devices[0]).toEqual({
			vendorId: '10c4',
			productId: 'ea60',
			serial: 'A1B2C3',
			port: 'pci0000:00/0000:00:14.0/2',
			name: 'CP2102 USB to UART Bridge Controller',
			manufacturer: 'Silicon Labs',
			bus: 3,
			device: 4,
			hub: false,
			sysfsPath: await fsp.realpath(nodePath.join(root, 'bus/usb/devices/3-2')),
		})
	})

	test('identifies devices behind hubs by their full port chain and flags the hubs', async () => {
		const root = await createSysfs()
		await addUsbDevice(root, {chain: '1', device: 2, attributes: {bDeviceClass: '09', product: 'USB2.0 Hub'}})
		await addUsbDevice(root, {chain: '1.4', device: 3})

		const devices = await listHostUsbDevices(root)

		expect(devices.map(({port, hub}) => ({port, hub}))).toEqual([
			{port: 'pci0000:00/0000:00:14.0/1', hub: true},
			{port: 'pci0000:00/0000:00:14.0/1.4', hub: false},
		])
		// Devices without strings or a serial number are still listed
		expect(devices[1]).toMatchObject({serial: undefined, name: undefined, manufacturer: undefined})
	})

	test('keeps the same port identity when controllers enumerate in a different order', async () => {
		const first = await createSysfs()
		const second = await createSysfs()
		await addUsbDevice(first, {bus: 3, chain: '2'})
		await addUsbDevice(second, {bus: 5, chain: '2'})

		const [before] = await listHostUsbDevices(first)
		const [after] = await listHostUsbDevices(second)

		expect(before.bus).not.toBe(after.bus)
		expect(after.port).toBe(before.port)
	})

	test('derives ports for platform controllers such as the Raspberry Pi 5', () => {
		expect(usbPortIdentity('platform/axi/1000120000.pcie/1f00200000.usb/xhci-hcd.0/usb1/1-2')).toBe(
			'platform/axi/1000120000.pcie/1f00200000.usb/xhci-hcd.0/2',
		)
		expect(usbPortIdentity('pci0000:00/0000:00:14.0/usb3')).toBeUndefined()
	})

	test('finds no devices on hosts without USB', async () => {
		const root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'usb-sysfs-'))
		roots.push(root)
		await expect(listHostUsbDevices(root)).resolves.toEqual([])
		await expect(usbTopologyFingerprint(root)).resolves.toBe('')
	})

	test("leaves out devices built into the computer, but trusts only the computer's own ports for that", async () => {
		const root = await createSysfs()
		// Bluetooth on a Wi-Fi card, wired to an internal port
		await addUsbDevice(root, {chain: '10', device: 3, attributes: {idVendor: '8087', removable: 'fixed'}})
		await addUsbDevice(root, {chain: '2', device: 4, attributes: {removable: 'removable'}})
		await addUsbDevice(root, {chain: '3', device: 5, attributes: {removable: 'unknown'}})
		// A hub that wrongly reports its ports as fixed
		await addUsbDevice(root, {chain: '1', device: 6, attributes: {bDeviceClass: '09'}})
		await addUsbDevice(root, {chain: '1.2', device: 7, attributes: {removable: 'fixed'}})

		const ports = (await listHostUsbDevices(root)).map(({port}) => port.split('/').at(-1)).sort()

		expect(ports).toEqual(['1', '1.2', '2', '3'])
	})

	test('names devices that report no name from the USB ID database, and drives by their volume label', async () => {
		const root = await createSysfs()
		const udev = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'usb-udev-'))
		roots.push(udev)
		await addUsbDevice(root, {chain: '4', device: 2, attributes: {idVendor: '1a6e', idProduct: '089a', dev: '189:257'}})
		await fse.outputFile(
			nodePath.join(udev, 'c189:257'),
			'E:ID_VENDOR=1a6e\nE:ID_VENDOR_FROM_DATABASE=Global Unichip Corp.\nE:ID_MODEL_FROM_DATABASE=Coral USB Accelerator\n',
		)
		// A device's own name wins over the database's
		await addUsbDevice(root, {
			chain: '5',
			device: 3,
			attributes: {product: 'Sonoff Zigbee 3.0 USB Dongle Plus', dev: '189:258'},
		})
		await fse.outputFile(nodePath.join(udev, 'c189:258'), 'E:ID_MODEL_FROM_DATABASE=CP210x UART Bridge\n')
		// A thumb drive with a labelled partition, and a second one without a label
		const drive = await addUsbDevice(root, {
			chain: '2',
			device: 4,
			attributes: {idVendor: '346d', idProduct: '5678', product: 'Disk 2.0', manufacturer: 'USB'},
			children: {
				'3-2:1.0/host2/target2:0:0/2:0:0:0/block/sda/dev': '8:0',
				'3-2:1.0/host2/target2:0:0/2:0:0:0/block/sda/sda1/dev': '8:1',
			},
		})
		await addUsbDevice(root, {
			chain: '3',
			device: 5,
			attributes: {product: 'Flash Disk'},
			children: {'3-3:1.0/host3/target3:0:0/3:0:0:0/block/sdb/dev': '8:16'},
		})
		const blockDevices = nodePath.join(drive, '3-2:1.0/host2/target2:0:0/2:0:0:0/block')
		await fse.ensureDir(nodePath.join(root, 'class/block'))
		await fsp.symlink(nodePath.join(blockDevices, 'sda'), nodePath.join(root, 'class/block/sda'))
		await fsp.symlink(nodePath.join(blockDevices, 'sda/sda1'), nodePath.join(root, 'class/block/sda1'))
		await fse.outputFile(nodePath.join(udev, 'b8:1'), 'E:ID_FS_TYPE=exfat\nE:ID_FS_LABEL=Prestige\n')

		const devices = await listHostUsbDevices(root, udev)
		const named = (chain: string) => devices.find(({port}) => port.endsWith(`/${chain}`))

		expect(named('4')).toMatchObject({name: 'Coral USB Accelerator', manufacturer: 'Global Unichip Corp.'})
		expect(named('5')?.name).toBe('Sonoff Zigbee 3.0 USB Dongle Plus')
		expect(named('2')).toMatchObject({name: 'Prestige', manufacturer: 'USB'})
		expect(named('3')?.name).toBe('Flash Disk')
	})

	test('knows a drive by the serial numbers of the disks inside, once the host has read them', async () => {
		const root = await createSysfs()
		const udev = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'usb-udev-'))
		roots.push(udev)
		const storageDriver = nodePath.join(root, 'bus/usb/drivers/usb-storage')
		await fse.ensureDir(storageDriver)
		const addDrive = async (chain: string, disks: Record<string, string | undefined>) => {
			const interfacePath = nodePath.join(
				await addUsbDevice(root, {chain, device: Number(chain) + 1, attributes: {idVendor: '152d', idProduct: '0578'}}),
				`3-${chain}:1.0`,
			)
			await fsp.symlink(storageDriver, nodePath.join(interfacePath, 'driver'))
			for (const [name, udevData] of Object.entries(disks)) {
				const disk = nodePath.join(interfacePath, `host${chain}/target${chain}:0:0/${chain}:0:0:0/block`, name)
				const deviceNumber = `8:${Number(chain) * 16}`
				await fse.outputFile(nodePath.join(disk, 'dev'), `${deviceNumber}\n`)
				await fse.ensureDir(nodePath.join(root, 'class/block'))
				await fsp.symlink(disk, nodePath.join(root, 'class/block', name))
				if (udevData) await fse.outputFile(nodePath.join(udev, `b${deviceNumber}`), udevData)
			}
			return interfacePath
		}
		// udev read the serial number of the disk inside through the enclosure
		await addDrive('1', {sdb: 'E:ID_BUS=ata\nE:ID_SERIAL=Samsung_SSD_870_EVO_1TB_S6PUNX0R123456\n'})
		// A thumb drive only has the serial number of its USB device
		await addDrive('2', {sdc: 'E:ID_BUS=usb\nE:ID_SERIAL=VendorCo_ProductCode_5107791050040029471-0:0\n'})
		// Plugged in a moment ago, and udev hasn't finished with the disk
		await addDrive('3', {sdd: undefined})
		// The driver is still looking for the disk
		await addDrive('4', {})
		// Passed through to a machine, so the host has no driver for it
		const passedThrough = await addDrive('5', {})
		await fse.remove(nodePath.join(passedThrough, 'driver'))
		// Plugged in a minute ago, and its disk has since been ejected in Files
		await addDrive('6', {})
		await fse.outputFile(nodePath.join(root, 'bus/usb/devices/3-6/dev'), '189:262\n')
		await fse.outputFile(nodePath.join(udev, 'c189:262'), 'I:1000000000\nE:ID_BUS=usb\n')
		// Plugged in a few seconds ago, and the driver is still looking for the disk
		await addDrive('7', {})
		await fse.outputFile(nodePath.join(root, 'bus/usb/devices/3-7/dev'), '189:263\n')
		await fse.outputFile(nodePath.join(udev, 'c189:263'), 'I:1055000000\nE:ID_BUS=usb\n')

		const devices = await listHostUsbDevices(root, udev, 1_060_000_000n)
		const drive = (chain: string) => {
			const {diskSerials, disksPending} = devices.find(({port}) => port.endsWith(`/${chain}`))!
			return {diskSerials, disksPending}
		}

		expect(drive('1')).toEqual({diskSerials: ['Samsung_SSD_870_EVO_1TB_S6PUNX0R123456'], disksPending: undefined})
		expect(drive('2')).toEqual({diskSerials: undefined, disksPending: undefined})
		expect(drive('3')).toEqual({diskSerials: undefined, disksPending: true})
		expect(drive('4')).toEqual({diskSerials: undefined, disksPending: true})
		expect(drive('5')).toEqual({diskSerials: undefined, disksPending: undefined})
		expect(drive('6')).toEqual({diskSerials: undefined, disksPending: undefined})
		expect(drive('7')).toEqual({diskSerials: undefined, disksPending: true})
	})

	test('finds the disks on a drive that say they have no medium', async () => {
		const root = await createSysfs()
		const storageDriver = nodePath.join(root, 'bus/usb/drivers/usb-storage')
		await fse.ensureDir(storageDriver)
		await fse.ensureDir(nodePath.join(root, 'class/block'))
		const addDrive = async (chain: string, disks: Record<string, {removable: string; size: string}>) => {
			const path = await addUsbDevice(root, {chain, device: Number(chain) + 1})
			await fsp.symlink(storageDriver, nodePath.join(path, `3-${chain}:1.0`, 'driver'))
			for (const [name, attributes] of Object.entries(disks)) {
				const disk = nodePath.join(path, `3-${chain}:1.0/host${chain}/target${chain}:0:0/${chain}:0:0:0/block`, name)
				for (const [attribute, value] of Object.entries(attributes)) {
					await fse.outputFile(nodePath.join(disk, attribute), `${value}\n`)
				}
				await fsp.symlink(disk, nodePath.join(root, 'class/block', name))
			}
			return hostDevice({sysfsPath: path})
		}
		// A thumb drive a guest ejected, and one that still has its medium
		const ejected = await addDrive('1', {sda: {removable: '1', size: '0'}})
		const loaded = await addDrive('2', {sdb: {removable: '1', size: '15728640'}})
		// A card reader with one slot empty, and a hard drive
		const reader = await addDrive('3', {sdc: {removable: '1', size: '0'}, sdd: {removable: '1', size: '62333952'}})
		const hardDrive = await addDrive('4', {sde: {removable: '0', size: '1953525168'}})
		// Passed through to a machine, so the host has no driver for it
		const passedThrough = await addDrive('5', {})
		await fse.remove(nodePath.join(passedThrough.sysfsPath, '3-5:1.0', 'driver'))

		expect(await usbDriveDisks(ejected, root)).toEqual({disks: ['sda'], withoutMedium: ['sda']})
		expect(await usbDriveDisks(loaded, root)).toEqual({disks: ['sdb'], withoutMedium: []})
		expect((await usbDriveDisks(reader, root))?.withoutMedium).toEqual(['sdc'])
		expect(await usbDriveDisks(hardDrive, root)).toEqual({disks: ['sde'], withoutMedium: []})
		expect(await usbDriveDisks(passedThrough, root)).toBeUndefined()
	})

	test('notices devices being plugged in and replugged', async () => {
		const root = await createSysfs()
		const empty = await usbTopologyFingerprint(root)
		await addUsbDevice(root, {chain: '2', device: 4})
		const plugged = await usbTopologyFingerprint(root)
		expect(plugged).not.toBe(empty)

		// Replugging into the same port only changes the device number
		await addUsbDevice(root, {chain: '2', device: 5})
		const replugged = await usbTopologyFingerprint(root)
		expect(replugged).not.toBe(plugged)
		await expect(usbTopologyFingerprint(root)).resolves.toBe(replugged)
	})
})

describe('USB assignment resolution', () => {
	test('finds an assigned device in its port', () => {
		const device = hostDevice()
		const [binding] = resolveUsbAssignments([{machineId: 'miner', assignment: identity(device)}], [device])
		expect(binding.device).toBe(device)
	})

	test('tells identical devices apart by the port they are plugged into', () => {
		const left = hostDevice({port: 'pci0000:00/0000:00:14.0/1', device: 2})
		const right = hostDevice({port: 'pci0000:00/0000:00:14.0/2', device: 3})

		const bindings = resolveUsbAssignments(
			[
				{machineId: 'right-machine', assignment: identity(right)},
				{machineId: 'left-machine', assignment: identity(left)},
			],
			[left, right],
		)

		expect(bindings.map(({machineId, device}) => [machineId, device])).toEqual([
			['right-machine', right],
			['left-machine', left],
		])
	})

	test("never hands an unplugged device's identical twin to its machine", () => {
		const left = hostDevice({port: 'pci0000:00/0000:00:14.0/1'})
		const right = hostDevice({port: 'pci0000:00/0000:00:14.0/2'})

		const bindings = resolveUsbAssignments(
			[
				{machineId: 'left-machine', assignment: identity(left)},
				{machineId: 'right-machine', assignment: identity(right)},
			],
			// The right one is unplugged
			[left],
		)

		expect(bindings.map(({device}) => device)).toEqual([left, undefined])
	})

	test('follows a device with a unique serial number to another port', () => {
		const assigned = hostDevice({serial: 'ZIGBEE-8812'})
		const moved = hostDevice({serial: 'ZIGBEE-8812', port: 'pci0000:00/0000:00:14.0/4', device: 9})

		const [binding] = resolveUsbAssignments([{machineId: 'home-assistant', assignment: identity(assigned)}], [moved])

		expect(binding.device).toBe(moved)
	})

	test('does not follow a moved device whose serial number another unit also reports', () => {
		const assigned = hostDevice({serial: '0001'})
		const moved = hostDevice({serial: '0001', port: 'pci0000:00/0000:00:14.0/4', device: 9})
		const twin = hostDevice({serial: '0001', port: 'pci0000:00/0000:00:14.0/5', device: 10})

		const [binding] = resolveUsbAssignments([{machineId: 'miner', assignment: identity(assigned)}], [moved, twin])

		expect(binding.device).toBeUndefined()
	})

	test('does not follow a moved device when several assignments share its serial number', () => {
		const first = hostDevice({serial: '0001', port: 'pci0000:00/0000:00:14.0/1'})
		const second = hostDevice({serial: '0001', port: 'pci0000:00/0000:00:14.0/2'})
		// Only one of the two units is plugged in, in neither assigned port
		const moved = hostDevice({serial: '0001', port: 'pci0000:00/0000:00:14.0/3'})

		const bindings = resolveUsbAssignments(
			[
				{machineId: 'first-miner', assignment: identity(first)},
				{machineId: 'second-miner', assignment: identity(second)},
			],
			[moved],
		)

		expect(bindings.map(({device}) => device)).toEqual([undefined, undefined])
	})

	test('does not follow a moved device without a serial number', () => {
		const assigned = hostDevice({serial: undefined})
		const moved = hostDevice({serial: undefined, port: 'pci0000:00/0000:00:14.0/4'})

		const [binding] = resolveUsbAssignments([{machineId: 'miner', assignment: identity(assigned)}], [moved])

		expect(binding.device).toBeUndefined()
	})

	test('never follows a serial number to a device another assignment occupies by port', () => {
		const claimed = hostDevice({serial: 'UNIQUE', port: 'pci0000:00/0000:00:14.0/1'})
		const [, binding] = resolveUsbAssignments(
			[
				{machineId: 'owner', assignment: identity(claimed)},
				{machineId: 'other', assignment: {...identity(claimed), port: 'pci0000:00/0000:00:14.0/9'}},
			],
			[claimed],
		)
		expect(binding.device).toBeUndefined()
	})

	test('tells a drive from a look-alike in the same port by the disks inside', () => {
		const disk = ['Samsung_SSD_870_EVO_1TB_S6PUNX0R123456']
		// Cheap enclosures often report no serial number of their own
		const assigned = hostDevice({vendorId: '152d', productId: '0578', serial: undefined, diskSerials: disk})
		const assignment = {...identity(assigned), diskSerials: disk}
		const lookAlike = hostDevice({...assigned, diskSerials: ['WDC_WD40EFRX-68N32N0_WD-WCC7K1234567'], device: 7})
		// A machine that has its drive leaves the host nothing to read
		const passedThrough = hostDevice({...assigned, diskSerials: undefined})

		const resolve = (device: HostUsbDevice) => resolveUsbAssignments([{machineId: 'nas', assignment}], [device])[0]

		expect(resolve(assigned).device).toBe(assigned)
		expect(resolve(lookAlike).device).toBeUndefined()
		expect(resolve(passedThrough).device).toBe(passedThrough)
	})

	test('does not follow a moved drive whose enclosure shares the serial number but not the disks', () => {
		const assigned = hostDevice({serial: '0123456789ABCDEF', diskSerials: ['DISK-A']})
		const lookAlike = hostDevice({...assigned, port: 'pci0000:00/0000:00:14.0/4', diskSerials: ['DISK-B']})
		const moved = hostDevice({...lookAlike, diskSerials: ['DISK-A']})
		const assignment = {...identity(assigned), diskSerials: ['DISK-A']}

		expect(resolveUsbAssignments([{machineId: 'nas', assignment}], [lookAlike])[0].device).toBeUndefined()
		expect(resolveUsbAssignments([{machineId: 'nas', assignment}], [moved])[0].device).toBe(moved)
	})

	test('waits for the host to read a drive before deciding whether it is the assigned one', () => {
		const pending = hostDevice({disksPending: true})
		const [binding] = resolveUsbAssignments([{machineId: 'nas', assignment: identity(pending)}], [pending])
		expect(binding.device).toBeUndefined()
		expect(usbDeviceReplacing(pending.port, [pending], [])).toBeUndefined()
	})

	test('never binds a hub', () => {
		const hub = hostDevice({hub: true})
		const [binding] = resolveUsbAssignments([{machineId: 'machine', assignment: identity(hub)}], [hub])
		expect(binding.device).toBeUndefined()
	})

	test('finds a device that came back as another model, but only in its own port', () => {
		// A Coral NPU reconnects as a Google device once its firmware loads
		const coral = hostDevice({vendorId: '1a6e', productId: '089a', serial: undefined})
		const assignment = {...identity(coral), aliases: [{vendorId: '18d1', productId: '9302'}]}
		const loaded = hostDevice({vendorId: '18d1', productId: '9302', serial: undefined, device: 5})
		const elsewhere = hostDevice({...loaded, port: 'pci0000:00/0000:00:14.0/2'})

		expect(resolveUsbAssignments([{machineId: 'frigate', assignment}], [coral])[0].device).toBe(coral)
		expect(resolveUsbAssignments([{machineId: 'frigate', assignment}], [loaded])[0].device).toBe(loaded)
		expect(resolveUsbAssignments([{machineId: 'frigate', assignment}], [elsewhere])[0].device).toBeUndefined()
	})

	test('takes the device that showed up in a port another one just left for it reconnecting', () => {
		const coral = hostDevice({vendorId: '1a6e', productId: '089a', serial: undefined})
		const loaded = hostDevice({vendorId: '18d1', productId: '9302', serial: undefined, device: 5})
		const port = coral.port

		expect(usbDeviceReplacing(port, [loaded], [])).toBe(loaded)
		expect(usbDeviceReplacing(port, [], [])).toBeUndefined()
		expect(usbDeviceReplacing(port, [hostDevice({...loaded, port: 'pci0000:00/0000:00:14.0/2'})], [])).toBeUndefined()
		expect(usbDeviceReplacing(port, [hostDevice({...loaded, hub: true})], [])).toBeUndefined()
		// Never a device another assignment has
		const other = {machineId: 'assistant', assignment: identity(loaded), device: loaded}
		expect(usbDeviceReplacing(port, [loaded], [other])).toBeUndefined()
	})
})

describe('USB assignment changes', () => {
	test('assigns a plugged in device and remembers its name for when it is unplugged', () => {
		const device = hostDevice({name: 'CP2102 USB to UART Bridge Controller'})

		const plan = planUsbAssignments({machineId: 'miner', requested: [identity(device)], others: [], devices: [device]})

		expect(plan.assignments).toEqual([{...identity(device), name: 'CP2102 USB to UART Bridge Controller'}])
		expect(plan.added).toEqual([device])
	})

	test('remembers the disks inside a drive', () => {
		const drive = hostDevice({diskSerials: ['DISK-A', 'DISK-B']})

		const plan = planUsbAssignments({machineId: 'nas', requested: [identity(drive)], others: [], devices: [drive]})

		expect(plan.assignments).toEqual([{...identity(drive), diskSerials: ['DISK-A', 'DISK-B']}])
	})

	test('keeps assignments the machine already has, even while they are unplugged', () => {
		const unplugged = {...identity(hostDevice()), name: 'Old name'}

		const plan = planUsbAssignments({
			machineId: 'miner',
			current: [unplugged],
			requested: [identity(hostDevice())],
			others: [],
			devices: [],
		})

		expect(plan.assignments).toEqual([unplugged])
		expect(plan.added).toEqual([])
	})

	test('only accepts devices that are plugged in right now', () => {
		expect(() =>
			planUsbAssignments({machineId: 'miner', requested: [identity(hostDevice())], others: [], devices: []}),
		).toThrow('[machine-usb-device-not-found]')
	})

	test('rejects a hub', () => {
		const hub = hostDevice({hub: true})
		expect(() =>
			planUsbAssignments({machineId: 'miner', requested: [identity(hub)], others: [], devices: [hub]}),
		).toThrow('[machine-usb-device-not-found]')
	})

	test('rejects the same device twice', () => {
		const device = hostDevice()
		expect(() =>
			planUsbAssignments({
				machineId: 'miner',
				requested: [identity(device), identity(device)],
				others: [],
				devices: [device],
			}),
		).toThrow('[machine-usb-device-duplicate]')
	})

	test('rejects a device assigned to another machine, plugged in or not', () => {
		const device = hostDevice()
		for (const devices of [[device], []]) {
			expect(() =>
				planUsbAssignments({
					machineId: 'miner',
					requested: [identity(device)],
					others: [{machineId: 'other', assignment: identity(device)}],
					devices,
				}),
			).toThrow('[machine-usb-device-assigned]')
		}
	})

	test('rejects a device another machine is following to a new port', () => {
		const moved = hostDevice({serial: 'ZIGBEE-8812', port: 'pci0000:00/0000:00:14.0/4'})
		expect(() =>
			planUsbAssignments({
				machineId: 'miner',
				requested: [identity(moved)],
				others: [{machineId: 'home-assistant', assignment: {...identity(moved), port: 'pci0000:00/0000:00:14.0/1'}}],
				devices: [moved],
			}),
		).toThrow('[machine-usb-device-assigned]')
	})

	test('assigns an identical twin of a device another machine has', () => {
		const left = hostDevice({port: 'pci0000:00/0000:00:14.0/1'})
		const right = hostDevice({port: 'pci0000:00/0000:00:14.0/2'})

		const plan = planUsbAssignments({
			machineId: 'right-machine',
			requested: [identity(right)],
			others: [{machineId: 'left-machine', assignment: identity(left)}],
			devices: [left, right],
		})

		expect(plan.added).toEqual([right])
	})
})

describe('host use of USB devices', () => {
	test('refuses devices whose disks the host has mounted or otherwise claimed', async () => {
		const root = await createSysfs()
		const path = await addUsbDevice(root, {
			chain: '2',
			children: {
				'3-2:1.0/host0/target0:0:0/0:0:0:0/block/sda/dev': '8:0',
				'3-2:1.0/host0/target0:0:0/0:0:0:0/block/sda/sda1/dev': '8:1',
			},
		})
		const device = hostDevice({sysfsPath: path})
		const isBlockDeviceBusy = vi.fn(async (name: string) => name === 'sda')

		const uses = await usbHostUse([device], {isBlockDeviceBusy, listOpenDeviceNodes: async () => new Map()})

		expect(uses.get(device)).toEqual({reason: 'storage', disks: ['sda']})
		// Claiming a partition makes the whole disk busy, so only disks are checked
		expect(isBlockDeviceBusy.mock.calls).toEqual([['sda']])
		const idle = await usbHostUse([device], {
			isBlockDeviceBusy: async () => false,
			listOpenDeviceNodes: async () => new Map(),
		})
		expect(idle.get(device)).toBeUndefined()
	})

	test("tells network adapters the host can do without from ones it can't", async () => {
		const root = await createSysfs()
		const path = await addUsbDevice(root, {chain: '2', children: {'3-2:1.0/net/enx001122334455/address': '00:11:22'}})
		const device = hostDevice({sysfsPath: path})
		// The computer's own Ethernet port has a device behind it, Docker's bridge doesn't
		await fse.outputFile(nodePath.join(root, 'class/net/enp1s0/device/vendor'), '0x8086\n')
		await fse.ensureDir(nodePath.join(root, 'class/net/docker0'))
		const check = (networkInterfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>) =>
			usbHostUse([device], {sysfsRoot: root, networkInterfaces, listOpenDeviceNodes: async () => new Map()})
		const address = (address: string, family: 'IPv4' | 'IPv6') =>
			({address, family, internal: false, netmask: '', mac: '', cidr: null}) as os.NetworkInterfaceInfo
		const adapter = {enx001122334455: [address('192.168.1.20', 'IPv4')]}

		// The host's only connection
		expect((await check(adapter)).get(device)).toEqual({reason: 'network', essential: true})
		expect((await check({enx001122334455: [address('2001:db8::20', 'IPv6')]})).get(device)).toEqual({
			reason: 'network',
			essential: true,
		})
		expect((await check({...adapter, docker0: [address('172.17.0.1', 'IPv4')]})).get(device)).toEqual({
			reason: 'network',
			essential: true,
		})
		// The host stays connected through its own port without it
		expect((await check({...adapter, enp1s0: [address('192.168.1.10', 'IPv4')]})).get(device)).toEqual({
			reason: 'network',
			essential: false,
		})
		// Link-local addresses come up on any plugged in adapter
		expect(
			(await check({enx001122334455: [address('169.254.3.9', 'IPv4'), address('fe80::1', 'IPv6')]})).get(device),
		).toBeUndefined()
		expect((await check({})).get(device)).toBeUndefined()

		// A bridge or bond may be carrying the host's connection through it
		await fse.ensureDir(nodePath.join(root, 'class/net/enx001122334455'))
		await fsp.symlink('../br0', nodePath.join(root, 'class/net/enx001122334455/master'))
		expect((await check({enp1s0: [address('192.168.1.10', 'IPv4')]})).get(device)).toEqual({
			reason: 'network',
			essential: true,
		})
	})

	test('finds the processes holding a device open, with one scan for all devices', async () => {
		const root = await createSysfs()
		const serial = hostDevice({
			sysfsPath: await addUsbDevice(root, {chain: '2', children: {'3-2:1.0/ttyUSB0/tty/ttyUSB0/dev': '188:0'}}),
		})
		const raw = hostDevice({sysfsPath: await addUsbDevice(root, {chain: '3', children: {dev: '189:258'}})})
		const idle = hostDevice({
			sysfsPath: await addUsbDevice(root, {
				chain: '4',
				children: {'3-4:1.0/0003:1234:5678.0001/hidraw/hidraw0/dev': '240:0'},
			}),
		})
		const listOpenDeviceNodes = vi.fn(
			async () =>
				new Map([
					['188:0', [1200, 1201]],
					['189:258', [1300]],
				]),
		)

		const uses = await usbHostUse([serial, raw, idle], {listOpenDeviceNodes})

		expect(uses.get(serial)).toEqual({reason: 'in-use', processes: [1200, 1201], claimed: false})
		// A program using the device directly through usbfs counts too
		expect(uses.get(raw)).toEqual({reason: 'in-use', processes: [1300], claimed: false})
		expect(uses.get(idle)).toBeUndefined()
		expect(listOpenDeviceNodes).toHaveBeenCalledTimes(1)
	})

	test("doesn't count system services watching a keyboard or looking a drive over as using them", async () => {
		const root = await createSysfs()
		const path = await addUsbDevice(root, {
			chain: '2',
			children: {'3-2:1.0/0003:0627:0001.0001/input/input3/event3/dev': '13:67'},
		})
		const device = hostDevice({sysfsPath: path})
		const proc = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'usb-proc-'))
		roots.push(proc)
		await fse.outputFile(nodePath.join(proc, '412/comm'), 'systemd-logind\n')
		await fse.outputFile(nodePath.join(proc, '588/comm'), 'acpid\n')
		await fse.outputFile(nodePath.join(proc, '601/comm'), '(udev-worker)\n')
		await fse.outputFile(nodePath.join(proc, '977/comm'), 'python3\n')
		const check = (holders: number[]) =>
			usbHostUse([device], {procRoot: proc, listOpenDeviceNodes: async () => new Map([['13:67', holders]])})

		expect((await check([412, 588, 601])).get(device)).toBeUndefined()
		expect((await check([412, 588, 977])).get(device)).toEqual({reason: 'in-use', processes: [977], claimed: false})
	})

	test('tells a device a program has claimed through usbfs from one it uses through a driver', async () => {
		const root = await createSysfs()
		const path = await addUsbDevice(root, {
			chain: '2',
			children: {dev: '189:258', '3-2:1.1/ttyUSB0/tty/ttyUSB0/dev': '188:0'},
		})
		const device = hostDevice({sysfsPath: path})
		const bind = async (usbInterface: string, driver: string) => {
			await fse.ensureDir(nodePath.join(root, 'bus/usb/drivers', driver))
			await fse.remove(nodePath.join(path, usbInterface, 'driver'))
			await fsp.symlink(nodePath.join(root, 'bus/usb/drivers', driver), nodePath.join(path, usbInterface, 'driver'))
		}
		const listOpenDeviceNodes = async () => new Map([['189:258', [1300]]])
		await bind('3-2:1.1', 'ftdi_sio')

		await bind('3-2:1.0', 'usb-storage')
		expect((await usbHostUse([device], {listOpenDeviceNodes})).get(device)).toMatchObject({claimed: false})

		await bind('3-2:1.0', 'usbfs')
		expect((await usbHostUse([device], {listOpenDeviceNodes})).get(device)).toMatchObject({claimed: true})
	})

	test('checks nothing when there are no devices', async () => {
		const listOpenDeviceNodes = vi.fn(async () => new Map<string, number[]>())
		await expect(usbHostUse([], {listOpenDeviceNodes})).resolves.toEqual(new Map())
		expect(listOpenDeviceNodes).not.toHaveBeenCalled()
	})

	test('finds which USB device a disk is on', async () => {
		const root = await createSysfs()
		// Device paths come from realpath, as listHostUsbDevices resolves them
		const drive = await fsp.realpath(await addUsbDevice(root, {chain: '2'}))
		const other = await fsp.realpath(await addUsbDevice(root, {chain: '3'}))
		const disk = nodePath.join(drive, '3-2:1.0/host0/target0:0:0/0:0:0:0/block/sda')
		await fse.ensureDir(disk)
		await fse.ensureDir(nodePath.join(root, 'class/block'))
		await fsp.symlink(disk, nodePath.join(root, 'class/block/sda'))

		expect(await isBlockDeviceOnUsbDevice('sda', [other, drive], root)).toBe(true)
		expect(await isBlockDeviceOnUsbDevice('sda', [other], root)).toBe(false)
		// A sibling port whose path starts the same, like 3-2 and 3-20, doesn't count
		expect(await isBlockDeviceOnUsbDevice('sda', [nodePath.join(nodePath.dirname(drive), '3-20')], root)).toBe(false)
		expect(await isBlockDeviceOnUsbDevice('sdb', [drive], root)).toBe(false)
		expect(await isBlockDeviceOnUsbDevice('sda', [], root)).toBe(false)
	})

	test('splits device numbers the way the kernel encodes them', () => {
		expect(deviceNumberKey(0x801n)).toBe('8:1')
		// USB device nodes past the first 256 use the extended minor bits
		expect(deviceNumberKey(0x10bd02n)).toBe('189:258')
		// Majors past 4095 keep their high bits above the 32-bit boundary
		expect(deviceNumberKey(0x1000_0000_0005n)).toBe('4096:5')
	})
})

describe('host reservation of assigned USB devices', () => {
	const rule = (pattern: string, attributes: string) =>
		`ACTION!="remove", DEVPATH=="${pattern}", ${attributes}, ENV{NM_UNMANAGED}="1", ENV{ID_MM_DEVICE_IGNORE}="1"`

	test('has no rules while nothing is assigned', () => {
		expect(usbReservationRules([])).toBe('')
	})

	test('matches each assigned model in its port on any bus, plugged in or not', () => {
		const adapter = hostDevice({vendorId: '0bda', productId: '8153', serial: '000001'})
		const coral = {
			...identity(hostDevice({vendorId: '1a6e', productId: '089a', serial: undefined})),
			port: 'pci0000:00/0000:00:14.0/1.4',
			aliases: [{vendorId: '18d1', productId: '9302'}],
		}

		const rules = usbReservationRules([
			{machineId: 'router', assignment: identity(adapter), device: adapter},
			{machineId: 'frigate', assignment: coral},
		])

		const port = (bus: string, ...hops: string[]) =>
			`/devices/pci0000:00/0000:00:14.0/usb${bus}/${hops.map((hop) => `${bus}-${hop}`).join('/')}`
		const ports = (...hops: string[]) =>
			[port('?', ...hops), `${port('?', ...hops)}/*`, port('??', ...hops), `${port('??', ...hops)}/*`].join('|')
		expect(rules.split('\n')).toEqual([
			'# Written by umbreld. USB devices assigned to machines, which the host leaves alone.',
			rule(ports('1'), 'ATTRS{idVendor}=="0bda", ATTRS{idProduct}=="8153", ATTRS{serial}=="000001"'),
			rule(ports('1', '1.4'), 'ATTRS{idVendor}=="1a6e", ATTRS{idProduct}=="089a"'),
			rule(ports('1', '1.4'), 'ATTRS{idVendor}=="18d1", ATTRS{idProduct}=="9302"'),
			'',
		])
	})

	test('follows a device moved to another port, and leaves out serial numbers udev would misread', () => {
		const assignment = identity(hostDevice({serial: 'A"*1'}))
		const moved = hostDevice({serial: 'A"*1', port: 'pci0000:00/0000:00:14.0/3'})

		const rules = usbReservationRules([{machineId: 'miner', assignment, device: moved}]).split('\n')

		expect(rules).toHaveLength(4)
		expect(rules[1]).toContain('/usb?/?-1|')
		expect(rules[2]).toContain('/usb?/?-3|')
		expect(rules.join('\n')).not.toContain('serial')
	})
})

describe('libvirt USB hostdev XML', () => {
	test('passes a device through by its current address', () => {
		expect(buildUsbHostdevXml({bus: 3, device: 7})).toBe(
			"<hostdev mode='subsystem' type='usb'><source><address bus='3' device='7'/></source></hostdev>",
		)
	})

	test("reads the host addresses of a live domain's USB devices", () => {
		const xml = `<domain type='kvm' id='7'>
  <devices>
    <disk type='file' device='disk'>
      <address type='drive' controller='0' bus='0' target='0' unit='0'/>
    </disk>
    <hostdev mode='subsystem' type='usb' managed='no'>
      <source>
        <address bus='3' device='2'/>
      </source>
      <alias name='hostdev0'/>
      <address type='usb' bus='0' port='1'/>
    </hostdev>
    <hostdev mode='subsystem' type='pci' managed='yes'>
      <source>
        <address domain='0x0000' bus='0x01' slot='0x00' function='0x0'/>
      </source>
    </hostdev>
    <hostdev mode='subsystem' type='usb' managed='no'>
      <source>
        <address bus='1' device='14'/>
      </source>
      <alias name='hostdev1'/>
      <address type='usb' bus='0' port='2'/>
    </hostdev>
  </devices>
</domain>`

		expect(parseUsbHostdevAddresses(xml)).toEqual([
			{bus: 3, device: 2},
			{bus: 1, device: 14},
		])
		expect(parseUsbHostdevAddresses("<domain type='kvm'><devices/></domain>")).toEqual([])
	})
})
