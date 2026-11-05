import {constants as fsConstants} from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import nodePath from 'node:path'

// What a passthrough assignment remembers about a device. Bus and device
// numbers change every time a device is plugged in, so a device is recognised
// by its model, its serial number when it reports one, and the physical port
// it is plugged into.
export type UsbDeviceIdentity = {
	vendorId: string
	productId: string
	serial?: string
	port: string
}

// A model and serial number an assigned device has also shown up as
export type UsbDeviceAlias = Pick<UsbDeviceIdentity, 'vendorId' | 'productId' | 'serial'>

export type UsbDeviceAssignment = UsbDeviceIdentity & {
	// Kept so a disconnected device can still be shown by name
	name?: string
	// Some devices reconnect as a different model once the guest starts using
	// them. A USB NPU like the Coral does when its driver loads firmware onto it.
	// These are the models this one has come back as in its port while its
	// machine had it, so the machine keeps it in either form.
	aliases?: UsbDeviceAlias[]
	// The serial numbers of the disks inside a drive, when its enclosure passes
	// them on. Cheap enclosures often report no serial number of their own, or
	// the same one for every unit, so this is what tells two of them apart.
	diskSerials?: string[]
}

export type HostUsbDevice = UsbDeviceIdentity & {
	name?: string
	manufacturer?: string
	bus: number
	device: number
	hub: boolean
	sysfsPath: string
	diskSerials?: string[]
	// The host is still setting up the drive's disks, so their serial numbers
	// can't be read yet
	disksPending?: boolean
}

// Where libvirt finds the device right now
export type UsbAddress = {bus: number; device: number}

// Why the host can't simply give a device to a machine
export type UsbHostUse =
	// These disks on it are mounted, used as swap, or part of a pool or array
	| {reason: 'storage'; disks: string[]}
	// It is one of the host's network connections. Essential means the host
	// would be cut off without it: it's the only connection the host has, or
	// it's part of a bridge or bond.
	| {reason: 'network'; essential: boolean}
	// These processes hold its device nodes open. Through a kernel driver, like
	// a serial adapter's tty, QEMU can take the device from them and they see it
	// unplugged. Claimed means a program drives it directly through usbfs, as
	// libusb does, and the kernel won't let QEMU take it from that program.
	| {reason: 'in-use'; processes: number[]; claimed: boolean}

export type UsbAssignmentBinding<Assignment extends UsbDeviceIdentity = UsbDeviceIdentity> = {
	machineId: string
	assignment: Assignment
	device?: HostUsbDevice
}

const USB_HUB_CLASS = '09'

const USB_STORAGE_DRIVERS = new Set(['usb-storage', 'uas'])

// Where udev keeps what it knows about each device, by device number
const UDEV_DATA_ROOT = '/run/udev/data'

// How long the host can take to find a drive's disks once it's plugged in. A
// drive that has gone longer without them had them ejected, as Files does,
// rather than still being set up.
const DRIVE_SETUP_TIMEOUT_US = 30_000_000n

async function readAttribute(directory: string, name: string) {
	try {
		return (await fsp.readFile(nodePath.join(directory, name), 'utf8')).trim()
	} catch {
		return undefined
	}
}

// The physical port as the host controller's device path plus the hub port
// chain, e.g. pci0000:00/0000:00:14.0/1.4 for /sys/devices/pci0000:00/0000:00:14.0/usb3/3-1/3-1.4.
// Unlike a bus number this doesn't change when controllers enumerate in a
// different order, so it identifies the same socket across reboots.
export function usbPortIdentity(devicePath: string) {
	const match = /^(.+?)\/usb\d+\/(?:.+\/)?\d+-([\d.]+)$/.exec(devicePath)
	return match ? `${match[1]}/${match[2]}` : undefined
}

// The properties udev recorded for a device, such as the names it looked up
// in the USB ID database and a filesystem's label, and when it first saw the
// device, in microseconds of the monotonic clock, which udev reports as
// USEC_INITIALIZED
async function udevProperties(udevDataRoot: string, key: string) {
	const properties = new Map<string, string>()
	const data = await fsp.readFile(nodePath.join(udevDataRoot, key), 'utf8').catch(() => '')
	for (const line of data.split('\n')) {
		const match = /^E:([^=]+)=(.*)$/.exec(line)
		if (match) properties.set(match[1], match[2])
		const initialized = /^I:(\d+)$/.exec(line)
		if (initialized) properties.set('USEC_INITIALIZED', initialized[1])
	}
	return properties
}

// Whether the host's USB storage driver has the device, so its disks either
// exist or are about to
async function hasStorageDriver(sysfsPath: string) {
	const interfaces = (await fsp.readdir(sysfsPath).catch(() => [])).filter((name) => /:\d+\.\d+$/.test(name))
	const drivers = await Promise.all(
		interfaces.map((name) => fsp.readlink(nodePath.join(sysfsPath, name, 'driver')).catch(() => '')),
	)
	return drivers.some((driver) => USB_STORAGE_DRIVERS.has(nodePath.basename(driver)))
}

// What the host knows about the drive on each device: its first volume label,
// which is what Files calls the drive, and the serial numbers of its disks.
// udev asks a disk in a SATA enclosure for its own serial number through the
// enclosure. When it can't, it falls back to the enclosure's USB serial
// number, which the device's identity already has. Until udev has looked at
// every disk, the drive is still pending.
async function driveDetails(devices: HostUsbDevice[], sysfsRoot: string, udevDataRoot: string) {
	const drives = new Map<HostUsbDevice, {label?: string; diskSerials: string[]; disks: number; pending: boolean}>()
	const blockDirectory = nodePath.join(sysfsRoot, 'class/block')
	const names = (await fsp.readdir(blockDirectory).catch(() => [])).sort()
	for (const name of names) {
		const path = await fsp.realpath(nodePath.join(blockDirectory, name)).catch(() => undefined)
		const device = path && devices.find(({sysfsPath}) => path.startsWith(`${sysfsPath}/`))
		if (!device) continue
		const drive = drives.get(device) ?? {diskSerials: [], disks: 0, pending: false}
		drives.set(device, drive)
		const deviceNumber = await readAttribute(path, 'dev')
		const properties = deviceNumber ? await udevProperties(udevDataRoot, `b${deviceNumber}`) : new Map<string, string>()
		drive.label ??= properties.get('ID_FS_LABEL')
		if (await readAttribute(path, 'partition')) continue
		drive.disks++
		const serial = properties.get('ID_SERIAL')
		if (properties.size === 0) drive.pending = true
		else if (serial && properties.get('ID_BUS') !== 'usb') drive.diskSerials.push(serial)
	}
	return drives
}

// The monotonic clock udev times devices by, in microseconds
const monotonicMicroseconds = () => process.hrtime.bigint() / 1_000n

export async function listHostUsbDevices(
	sysfsRoot = '/sys',
	udevDataRoot = UDEV_DATA_ROOT,
	now = monotonicMicroseconds(),
): Promise<HostUsbDevice[]> {
	const devicesDirectory = nodePath.join(sysfsRoot, 'bus/usb/devices')
	const deviceRoot = await fsp.realpath(nodePath.join(sysfsRoot, 'devices')).catch(() => undefined)
	if (!deviceRoot) return []
	const names = await fsp.readdir(devicesDirectory).catch(() => [])
	const devices: HostUsbDevice[] = []
	const pluggedInAt = new Map<HostUsbDevice, bigint>()
	// Root hubs are named usbN and interfaces bus-port:config.interface, so
	// only actual devices match
	for (const name of names.filter((name) => /^\d+-[\d.]+$/.test(name))) {
		const sysfsPath = await fsp.realpath(nodePath.join(devicesDirectory, name)).catch(() => undefined)
		if (!sysfsPath) continue
		const [vendorId, productId, bus, device, deviceClass, serial, product, manufacturer, removable, deviceNumber] =
			await Promise.all(
				[
					'idVendor',
					'idProduct',
					'busnum',
					'devnum',
					'bDeviceClass',
					'serial',
					'product',
					'manufacturer',
					'removable',
					'dev',
				].map((attribute) => readAttribute(sysfsPath, attribute)),
			)
		const port = usbPortIdentity(nodePath.relative(deviceRoot, sysfsPath))
		// The device disappeared while being read
		if (!vendorId || !productId || !bus || !device || !port) continue
		// Leave out devices built into the computer, like a laptop's webcam or a
		// Wi-Fi card's Bluetooth, which nobody thinks of as plugged in and which
		// often can't be passed through anyway. Firmware marks the ports they're
		// wired to as fixed. Only trust that for the computer's own ports, since
		// some hubs wrongly report every port as fixed.
		const rootPort = !name.includes('.')
		if (removable === 'fixed' && rootPort) continue
		// Many devices don't report their own name, so fall back to the one udev
		// looked up in the USB ID database, the way lsusb does
		const database = deviceNumber ? await udevProperties(udevDataRoot, `c${deviceNumber}`) : new Map()
		const hostDevice: HostUsbDevice = {
			vendorId: vendorId.toLowerCase(),
			productId: productId.toLowerCase(),
			serial: serial || undefined,
			port,
			name: product || database.get('ID_MODEL_FROM_DATABASE') || undefined,
			manufacturer: manufacturer || database.get('ID_VENDOR_FROM_DATABASE') || undefined,
			bus: Number(bus),
			device: Number(device),
			hub: deviceClass === USB_HUB_CLASS,
			sysfsPath,
		}
		devices.push(hostDevice)
		const initialized = database.get('USEC_INITIALIZED')
		if (initialized) pluggedInAt.set(hostDevice, BigInt(initialized))
	}
	const drives = await driveDetails(devices, sysfsRoot, udevDataRoot)
	for (const device of devices) {
		const drive = drives.get(device)
		if (drive?.label) device.name = drive.label
		if (drive?.diskSerials.length) device.diskSerials = drive.diskSerials.sort()
		// A device passed through to a machine has no host driver, and its disks
		// are the guest's business
		const settingUp = now - (pluggedInAt.get(device) ?? now) < DRIVE_SETUP_TIMEOUT_US
		if ((drive?.pending || !drive?.disks) && settingUp && (await hasStorageDriver(device.sysfsPath))) {
			device.disksPending = true
		}
	}
	return devices
}

// The disks the host has on a drive, and which of them are removable but say
// they have no medium, or nothing when the host doesn't have the drive
export async function usbDriveDisks(device: HostUsbDevice, sysfsRoot = '/sys') {
	if (!(await hasStorageDriver(device.sysfsPath))) return undefined
	const {disks} = await usbDeviceChildren(device.sysfsPath)
	const withoutMedium: string[] = []
	for (const disk of disks) {
		const path = nodePath.join(sysfsRoot, 'class/block', disk)
		const [removable, size] = await Promise.all([readAttribute(path, 'removable'), readAttribute(path, 'size')])
		if (removable === '1' && size === '0') withoutMedium.push(disk)
	}
	return {disks, withoutMedium}
}

// Changes whenever a device is plugged in, removed, or replugged
export async function usbTopologyFingerprint(sysfsRoot = '/sys') {
	const devicesDirectory = nodePath.join(sysfsRoot, 'bus/usb/devices')
	const names = (await fsp.readdir(devicesDirectory).catch(() => [])).filter((name) => /^\d+-[\d.]+$/.test(name))
	const devices = await Promise.all(
		names.map(async (name) => `${name}#${await readAttribute(nodePath.join(devicesDirectory, name), 'devnum')}`),
	)
	return devices.sort().join(',')
}

export function sameUsbDevice(a: UsbDeviceIdentity, b: UsbDeviceIdentity) {
	return (
		a.vendorId === b.vendorId &&
		a.productId === b.productId &&
		a.port === b.port &&
		(a.serial ?? '') === (b.serial ?? '')
	)
}

const sameModelAndSerial = (a: UsbDeviceAlias, b: UsbDeviceAlias) =>
	a.vendorId === b.vendorId && a.productId === b.productId && a.serial === b.serial

// A drive holding different disks from the ones assigned is a look-alike,
// however its enclosure identifies itself. Disks the host can't read, like
// those of a drive a machine already has, don't rule a drive out.
const sameDisks = (device: HostUsbDevice, assignment: UsbDeviceAssignment) =>
	!device.diskSerials || !assignment.diskSerials || device.diskSerials.join('\n') === assignment.diskSerials.join('\n')

// Whether a plugged in device is an assigned one in its assigned port, as the
// model it was assigned as or one it has come back as since
export function matchesUsbAssignment(device: HostUsbDevice, assignment: UsbDeviceAssignment) {
	if (!sameDisks(device, assignment)) return false
	if (sameUsbDevice(device, assignment)) return true
	return (
		device.port === assignment.port && (assignment.aliases ?? []).some((alias) => sameModelAndSerial(device, alias))
	)
}

// Match every assignment across all machines to at most one connected device,
// and every device to at most one assignment. A device in its assigned port is
// always found. One that moved port is only followed by its serial number when
// that can't be confused with another unit: identical models often share a
// serial, so it must be the only connected device with that serial and no
// other assignment may claim the same serial. A drive whose disks the host is
// still setting up waits until it can be told apart from a look-alike.
export function resolveUsbAssignments<Assignment extends UsbDeviceAssignment>(
	assignments: Array<{machineId: string; assignment: Assignment}>,
	devices: HostUsbDevice[],
): UsbAssignmentBinding<Assignment>[] {
	const candidates = devices.filter((device) => !device.hub && !device.disksPending)
	const bindings: UsbAssignmentBinding<Assignment>[] = assignments.map((entry) => ({...entry}))
	const claimed = new Set<HostUsbDevice>()

	for (const binding of bindings) {
		const device = candidates.find((device) => !claimed.has(device) && matchesUsbAssignment(device, binding.assignment))
		if (!device) continue
		binding.device = device
		claimed.add(device)
	}

	for (const binding of bindings) {
		const {assignment} = binding
		if (binding.device || !assignment.serial) continue
		const sharedSerial = assignments.some(
			(other) => other.assignment !== assignment && sameModelAndSerial(other.assignment, assignment),
		)
		const matches = candidates.filter(
			(device) => sameModelAndSerial(device, assignment) && sameDisks(device, assignment),
		)
		if (sharedSerial || matches.length !== 1 || claimed.has(matches[0])) continue
		binding.device = matches[0]
		claimed.add(matches[0])
	}

	return bindings
}

// Validate a requested set of assignments for one machine. Devices it already
// has are kept as they are, even while disconnected. New ones must be connected
// right now and not belong to another machine. The caller still has to check
// the returned new devices aren't in use by the host.
export function planUsbAssignments({
	machineId,
	current = [],
	requested,
	others,
	devices,
}: {
	machineId: string
	current?: UsbDeviceAssignment[]
	requested: UsbDeviceIdentity[]
	others: Array<{machineId: string; assignment: UsbDeviceAssignment}>
	devices: HostUsbDevice[]
}) {
	const bindings = resolveUsbAssignments(others, devices)
	const assignments: UsbDeviceAssignment[] = []
	const added: HostUsbDevice[] = []
	for (const [index, identity] of requested.entries()) {
		if (requested.findIndex((other) => sameUsbDevice(other, identity)) !== index) {
			throw new Error('[machine-usb-device-duplicate]')
		}
		const existing = current.find((assignment) => sameUsbDevice(assignment, identity))
		if (existing) {
			assignments.push(existing)
			continue
		}
		if (others.some(({assignment}) => sameUsbDevice(assignment, identity))) {
			throw new Error('[machine-usb-device-assigned]')
		}
		const device = devices.find((device) => !device.hub && sameUsbDevice(device, identity))
		if (!device) throw new Error('[machine-usb-device-not-found]')
		// Another machine may be following this device to a new port by serial
		const owner = bindings.find((binding) => binding.device === device)
		if (owner && owner.machineId !== machineId) throw new Error('[machine-usb-device-assigned]')
		const {vendorId, productId, serial, port, name, diskSerials} = device
		assignments.push({vendorId, productId, serial, port, name, ...(diskSerials ? {diskSerials} : {})})
		added.push(device)
	}
	return {assignments, added}
}

function isLinkLocal(address: os.NetworkInterfaceInfo) {
	return address.family === 'IPv4' ? address.address.startsWith('169.254.') : /^fe[89ab]/i.test(address.address)
}

const hasAddress = (addresses: os.NetworkInterfaceInfo[] = []) =>
	addresses.some((address) => !address.internal && !isLinkLocal(address))

// Everything the host exposes through a device: its disks, network
// interfaces, and device nodes (tty, hidraw, usbfs...), found by walking its
// sysfs tree, and whether a program has claimed any of its interfaces
async function usbDeviceChildren(sysfsPath: string) {
	const children = {disks: [] as string[], interfaces: [] as string[], deviceNumbers: [] as string[], claimed: false}
	const walk = async (directory: string, depth: number): Promise<void> => {
		const entries = await fsp.readdir(directory, {withFileTypes: true}).catch(() => [])
		for (const entry of entries) {
			const path = nodePath.join(directory, entry.name)
			if (entry.isFile() && entry.name === 'dev') {
				const deviceNumber = await readAttribute(directory, 'dev')
				if (deviceNumber) children.deviceNumbers.push(deviceNumber)
			}
			// Interfaces are named bus-port:config.interface. A program claiming one
			// through usbfs shows up as it being bound to the usbfs driver.
			if (depth === 0 && /:\d+\.\d+$/.test(entry.name)) {
				const driver = await fsp.readlink(nodePath.join(path, 'driver')).catch(() => '')
				if (nodePath.basename(driver) === 'usbfs') children.claimed = true
			}
			// Class links such as subsystem and driver are symlinks, so this only
			// descends into the device's own children
			if (!entry.isDirectory() || depth >= 12) continue
			const parent = nodePath.basename(directory)
			if (parent === 'block') children.disks.push(entry.name)
			if (parent === 'net') children.interfaces.push(entry.name)
			await walk(path, depth + 1)
		}
	}
	await walk(sysfsPath, 0)
	return children
}

// The kernel refuses an exclusive open of a disk that is mounted, used as swap,
// or claimed by ZFS, RAID, or device mapper, including through any partition
async function blockDeviceBusy(name: string) {
	try {
		const handle = await fsp.open(nodePath.join('/dev', name), fsConstants.O_RDONLY | fsConstants.O_EXCL)
		await handle.close()
		return false
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EBUSY'
	}
}

// Split a device number the way glibc's major() and minor() do
export function deviceNumberKey(rdev: bigint) {
	const major = ((rdev & 0xfff00n) >> 8n) | ((rdev & 0xfffff00000000000n) >> 32n)
	const minor = (rdev & 0xffn) | ((rdev & 0xffffff00000n) >> 12n)
	return `${major}:${minor}`
}

// Every device node some process on the host holds open, by device number,
// with the processes holding it, including processes inside app containers
async function openDeviceNodes(procRoot = '/proc') {
	const open = new Map<string, number[]>()
	const processes = (await fsp.readdir(procRoot).catch(() => [])).filter((name) => /^\d+$/.test(name))
	for (const pid of processes) {
		const fdDirectory = nodePath.join(procRoot, pid, 'fd')
		const descriptors = await fsp.readdir(fdDirectory).catch(() => [])
		await Promise.all(
			descriptors.map(async (descriptor) => {
				const path = nodePath.join(fdDirectory, descriptor)
				// Only follow links to device nodes. Following an open file on a network
				// share could block on an unreachable server. Containers keep their
				// device nodes under /dev too, even when they rename them.
				const target = await fsp.readlink(path).catch(() => '')
				if (!target.startsWith('/dev/')) return
				const stats = await fsp.stat(path, {bigint: true}).catch(() => undefined)
				if (!stats || !(stats.isCharacterDevice() || stats.isBlockDevice())) return
				const key = deviceNumberKey(stats.rdev)
				const processes = open.get(key) ?? []
				if (!processes.includes(Number(pid))) processes.push(Number(pid))
				open.set(key, processes)
			}),
		)
	}
	return open
}

// Host services that open devices without using them. systemd-logind and
// acpid hold every keyboard open, USB ones included, to watch for power and
// sleep key presses. udev's workers open a drive for a moment to look at it
// again whenever it changes, as it does when Files ejects it. They drop a
// device that goes away without fuss, so they don't count as using it.
const PASSIVE_HOLDERS = new Set(['systemd-logind', 'acpid', '(udev-worker)'])

async function isPassiveHolder(pid: number, procRoot: string) {
	const name = await fsp.readFile(nodePath.join(procRoot, String(pid), 'comm'), 'utf8').catch(() => '')
	return PASSIVE_HOLDERS.has(name.trim())
}

// Find which devices the host is using. QEMU detaches a passed-through device
// from its host drivers, so giving one away pulls it out from under whatever
// on the host was using it, exactly like unplugging it.
export async function usbHostUse(
	devices: HostUsbDevice[],
	{
		isBlockDeviceBusy = blockDeviceBusy,
		listOpenDeviceNodes = openDeviceNodes,
		networkInterfaces = os.networkInterfaces(),
		sysfsRoot = '/sys',
		procRoot = '/proc',
	}: {
		isBlockDeviceBusy?: (name: string) => Promise<boolean>
		listOpenDeviceNodes?: () => Promise<Map<string, number[]>>
		networkInterfaces?: NodeJS.Dict<os.NetworkInterfaceInfo[]>
		sysfsRoot?: string
		procRoot?: string
	} = {},
) {
	const uses = new Map<HostUsbDevice, UsbHostUse>()
	if (devices.length === 0) return uses
	const children = await Promise.all(devices.map((device) => usbDeviceChildren(device.sysfsPath)))
	let open: Map<string, number[]> | undefined
	for (const [index, device] of devices.entries()) {
		const {disks, interfaces, deviceNumbers, claimed} = children[index]
		const busy = await Promise.all(disks.map((disk) => isBlockDeviceBusy(disk)))
		if (busy.some(Boolean)) {
			uses.set(device, {reason: 'storage', disks: disks.filter((_, index) => busy[index])})
			continue
		}
		const connected = interfaces.filter((name) => hasAddress(networkInterfaces[name]))
		const enslaved = await Promise.all(
			interfaces.map((name) =>
				fsp
					.lstat(nodePath.join(sysfsRoot, 'class/net', name, 'master'))
					.then(() => true)
					.catch(() => false),
			),
		)
		if (connected.length > 0 || enslaved.some(Boolean)) {
			// Only hardware counts as somewhere else for the host to connect
			// through. Bridges, VPNs, and container links have no device behind them
			// and ride on top of the hardware ones anyway.
			const otherConnections = await Promise.all(
				Object.entries(networkInterfaces)
					.filter(([name, addresses]) => !interfaces.includes(name) && hasAddress(addresses))
					.map(([name]) =>
						fsp
							.stat(nodePath.join(sysfsRoot, 'class/net', name, 'device'))
							.then(() => true)
							.catch(() => false),
					),
			)
			uses.set(device, {reason: 'network', essential: enslaved.some(Boolean) || !otherConnections.some(Boolean)})
			continue
		}
		open ??= await listOpenDeviceNodes()
		const holders = [...new Set(deviceNumbers.flatMap((deviceNumber) => open!.get(deviceNumber) ?? []))]
		const processes = []
		for (const pid of holders) if (!(await isPassiveHolder(pid, procRoot))) processes.push(pid)
		if (processes.length > 0) uses.set(device, {reason: 'in-use', processes, claimed})
	}
	return uses
}

// Whether a block device, such as sda, is a disk on one of these USB devices
export async function isBlockDeviceOnUsbDevice(name: string, sysfsPaths: string[], sysfsRoot = '/sys') {
	if (sysfsPaths.length === 0) return false
	const path = await fsp.realpath(nodePath.join(sysfsRoot, 'class/block', name)).catch(() => undefined)
	return !!path && sysfsPaths.some((sysfsPath) => path.startsWith(`${sysfsPath}/`))
}

// The device that took the place of one a machine had, when the machine's
// device disconnected and something else showed up in the same port straight
// after. That is how a device reconnecting as a different model looks, but a
// device assigned in its own right is never taken for one.
export function usbDeviceReplacing(
	port: string,
	devices: HostUsbDevice[],
	bindings: UsbAssignmentBinding<UsbDeviceAssignment>[],
) {
	return devices.find(
		(device) =>
			!device.hub &&
			!device.disksPending &&
			device.port === port &&
			!bindings.some((binding) => binding.device === device),
	)
}

// A udev pattern for whatever is plugged into a port, on whichever bus the
// controller got. An xHCI controller has a bus for USB 2 and one for USB 3
// devices, and bus numbers can change between boots, so this matches any one
// or two digit bus number rather than the current one.
function usbPortDevicePattern(port: string) {
	const separator = port.lastIndexOf('/')
	const controller = port.slice(0, separator)
	const hops = port
		.slice(separator + 1)
		.split('.')
		.map((_, index, ports) => ports.slice(0, index + 1).join('.'))
	return ['?', '??']
		.map((bus) => `/devices/${controller}/usb${bus}/${hops.map((hop) => `${bus}-${hop}`).join('/')}`)
		.flatMap((path) => [path, `${path}/*`])
		.join('|')
}

// Characters safe to put in a udev match unquoted by anything but the rule's
// own double quotes, and that aren't glob syntax
const safeUdevValue = (value: string) => /^[\w .:-]+$/.test(value)

// udev rules that make the host's own services ignore the devices assigned to
// machines, even while their machine is off or before it has started.
// NetworkManager would otherwise bring up a machine's network adapter on the
// host, and ModemManager would probe a Zigbee or Thread adapter's serial port
// with modem commands. Each rule matches the assigned model in its port, so
// it holds for a device plugged in later and doesn't catch a different one
// plugged into the same port.
export function usbReservationRules(bindings: UsbAssignmentBinding<UsbDeviceAssignment>[]) {
	const rules = new Set<string>()
	const reserve = (port: string, {vendorId, productId, serial}: UsbDeviceAlias) => {
		const keys = [
			'ACTION!="remove"',
			`DEVPATH=="${usbPortDevicePattern(port)}"`,
			`ATTRS{idVendor}=="${vendorId}"`,
			`ATTRS{idProduct}=="${productId}"`,
			// A serial number that can't be written safely is left out, and the
			// model and port still pick out the device
			...(serial && safeUdevValue(serial) ? [`ATTRS{serial}=="${serial}"`] : []),
			'ENV{NM_UNMANAGED}="1"',
			'ENV{ID_MM_DEVICE_IGNORE}="1"',
		]
		rules.add(keys.join(', '))
	}
	for (const {assignment, device} of bindings) {
		for (const identity of [assignment, ...(assignment.aliases ?? [])]) reserve(assignment.port, identity)
		// A device followed to another port by its serial number
		if (device && device.port !== assignment.port) reserve(device.port, device)
	}
	if (rules.size === 0) return ''
	return ['# Written by umbreld. USB devices assigned to machines, which the host leaves alone.', ...rules, ''].join(
		'\n',
	)
}

export function buildUsbHostdevXml({bus, device}: UsbAddress) {
	return `<hostdev mode='subsystem' type='usb'><source><address bus='${bus}' device='${device}'/></source></hostdev>`
}

// Host addresses of the USB devices in a live domain's XML
export function parseUsbHostdevAddresses(xml: string): UsbAddress[] {
	return [...xml.matchAll(/<hostdev\b[^>]*\btype='usb'[^>]*>([\s\S]*?)<\/hostdev>/g)].flatMap(([, body]) => {
		const address = /<source\b[^>]*>[\s\S]*?<address\s+bus='(\d+)'\s+device='(\d+)'\s*\/>/.exec(body)
		return address ? [{bus: Number(address[1]), device: Number(address[2])}] : []
	})
}

export const sameUsbAddress = (a: UsbAddress, b: UsbAddress) => a.bus === b.bus && a.device === b.device
