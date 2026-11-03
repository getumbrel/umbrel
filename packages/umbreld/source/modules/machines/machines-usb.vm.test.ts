import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, test} from 'vitest'
import pRetry from 'p-retry'

import {waitForExternalStorage} from '../backups/backups.vm-test-helpers.ts'
import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import runGitServer from '../test-utilities/run-git-server.ts'

type UsbDevice = Awaited<
	ReturnType<Awaited<ReturnType<typeof createTestVm>>['client']['machines']['usbDevices']['query']>
>[number]

// QEMU's emulated FTDI adapter, USB drive, and USB Ethernet adapter, and the
// keyboard a serial adapter is swapped for to model a device that reconnects
// as a different model
const SERIAL_ADAPTER = {vendorId: '0403', productId: '6001'}
const USB_DRIVE = {vendorId: '46f4', productId: '0001'}
const USB_ETHERNET = {vendorId: '0525', productId: 'a4a2'}
const KEYBOARD = {vendorId: '0627', productId: '0001'}
// A privileged app that opens every serial adapter it finds when it starts
const USB_APP = {id: 'sparkles-usb', name: 'USB Test'}

describe('Umbrel Machines USB passthrough', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let gitServer: Awaited<ReturnType<typeof runGitServer>>
	let failed = false
	// Slot 1 has a serial number of its own, slots 2 and 3 are identical twins
	let adapter: UsbDevice
	let leftTwin: UsbDevice
	let rightTwin: UsbDevice
	let drive: UsbDevice
	const miner = 'usb-miner'
	const assistant = 'usb-assistant'

	const identity = ({vendorId, productId, serial, port}: UsbDevice) => ({vendorId, productId, serial, port})
	const findDevice = (devices: UsbDevice[], {port}: UsbDevice) => devices.find((device) => device.port === port)

	// Where the kernel has the serial adapter in a slot right now, and which host
	// driver owns it. QEMU unbinds ftdi_sio while a machine has it.
	async function serialAdapter(slot: number) {
		const output = await umbreld.vm.sshAsRoot(`
for device in /sys/bus/usb/devices/*-${slot}; do
	[ "$(cat "$device/idVendor" 2>/dev/null)" = 0403 ] || continue
	driver=$(readlink "$device/$(basename "$device"):1.0/driver" 2>/dev/null || true)
	echo "$(cat "$device/busnum") $(cat "$device/devnum") $(basename "\${driver:-none}")"
done`)
		const [bus, device, driver] = output.split(' ')
		return {bus: Number(bus), device: Number(device), driver}
	}

	// The host USB devices passed through to a machine's live domain
	async function passedThrough(id: string) {
		const xml = await umbreld.vm.sshAsRoot(`virsh --connect qemu:///system dumpxml umbrel-machine-${id}`)
		return [...xml.matchAll(/<hostdev[^>]*type='usb'[^>]*>\s*<source[^>]*>\s*<address bus='(\d+)' device='(\d+)'\/>/g)]
			.map(([, bus, device]) => ({bus: Number(bus), device: Number(device)}))
			.sort((a, b) => a.bus - b.bus || a.device - b.device)
	}

	// Where the kernel has the USB drive right now, and which host driver owns it
	async function usbDrive() {
		const output = await umbreld.vm.sshAsRoot(`
for device in /sys/bus/usb/devices/*; do
	[ "$(cat "$device/idVendor" 2>/dev/null)" = ${USB_DRIVE.vendorId} ] || continue
	driver=$(readlink "$device/$(basename "$device"):1.0/driver" 2>/dev/null || true)
	echo "$(cat "$device/busnum") $(cat "$device/devnum") $(basename "\${driver:-none}")"
done`)
		const [bus, device, driver] = output.split(' ')
		return {bus: Number(bus), device: Number(device), driver}
	}

	// A shell glob for a port as umbreld identifies it, on either of its
	// controller's buses
	const sysfsPort = (port: string) => {
		const separator = port.lastIndexOf('/')
		return `/sys/devices/${port.slice(0, separator)}/usb*/*-${port.slice(separator + 1)}`
	}

	// Whatever is plugged into a port right now
	async function deviceInPort(port: string) {
		const output = await umbreld.vm.sshAsRoot(`
for device in ${sysfsPort(port)}; do
	[ -f "$device/idVendor" ] && echo "$(cat "$device/busnum") $(cat "$device/devnum") $(cat "$device/idVendor")"
done`)
		const [bus, device, vendorId] = output.split(' ')
		return {bus: Number(bus), device: Number(device), vendorId}
	}

	// The host's network interface for the adapter in a port, whether
	// NetworkManager manages it, and the IPv4 address it has
	async function networkAdapter(port: string) {
		const output = await umbreld.vm.sshAsRoot(`
for net in ${sysfsPort(port)}/*/net/*; do
	[ -e "$net" ] || continue
	name=$(basename "$net")
	echo "$name|$(nmcli -g GENERAL.STATE device show "$name" 2>/dev/null)|$(ip -4 -o addr show dev "$name" | awk '{print $4}')"
done`)
		const [name, state, address] = output.split('|')
		return {name, managed: !!state && !state.startsWith('10 '), state, address}
	}

	const externalMounts = async () =>
		(await umbreld.client.files.externalDevices.query()).flatMap((device) =>
			device.partitions.flatMap((partition) => partition.mountpoints),
		)

	const addresses = (...adapters: Array<{bus: number; device: number}>) =>
		adapters.map(({bus, device}) => ({bus, device})).sort((a, b) => a.bus - b.bus || a.device - b.device)

	async function waitForRunning(id: string) {
		await pRetry(
			async () => {
				const machine = (await umbreld.client.machines.list.query()).find((machine) => machine.id === id)
				expect(machine?.state).toBe('running')
			},
			{retries: 120, minTimeout: 500, maxTimeout: 500},
		)
	}

	beforeAll(async () => {
		const image = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../os/build/umbrelos-amd64.img')
		umbreld = await createTestVm({device: 'umbrel-home', image, memory: 4096})
		gitServer = await runGitServer({additionalApps: [USB_APP.id]})
		await umbreld.vm.addUsbSerial({slot: 1, serial: 'UMBREL-A'})
		await umbreld.vm.addUsbSerial({slot: 2, serial: 'TWIN'})
		await umbreld.vm.addUsbSerial({slot: 3, serial: 'TWIN'})
		await umbreld.vm.addUsbStorage({slot: 1, size: '8G'})
		await umbreld.vm.addUsbNet({slot: 1})
		await umbreld.vm.powerOn()
		await umbreld.registerAndLogin()
	})

	afterAll(async () => {
		await umbreld?.cleanup()
		await gitServer?.close()
	})
	afterEach(async ({task}) => {
		if (task.result?.state !== 'fail' || failed) return
		failed = true
		// What umbreld made of the USB devices, and what on the host holds them
		const diagnostics = await umbreld.vm
			.sshAsRoot(
				`journalctl -u umbrel --no-pager | grep -iE 'usb|machines' | tail -80
echo '--- device nodes held open'
for fd in /proc/[0-9]*/fd/*; do
	target=$(readlink "$fd" 2>/dev/null) || continue
	case "$target" in /dev/input/*|/dev/hidraw*|/dev/ttyUSB*|/dev/bus/usb/*) echo "$(cat "\${fd%/fd/*}/comm") $target" ;; esac
done | sort -u
echo '--- usb'
lsusb -t
echo '--- network'
nmcli device
ip -brief address`,
			)
			.catch((error) => String(error))
		console.log(diagnostics)
	})
	beforeEach(({skip}) => {
		if (failed) skip()
	})

	test('mounts the USB drive as external storage', async () => {
		const [device] = (await umbreld.client.files.externalDevices.query()).filter(({transport}) => transport === 'usb')
		await umbreld.client.files.formatExternalDevice.mutate({deviceId: device.id, filesystem: 'ext4', label: 'Drive'})
		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.login()
		await waitForExternalStorage(umbreld, {path: '/External/Drive'})
	})

	test('lists plugged in USB devices, with the drive in use by Files', async () => {
		const devices = await umbreld.client.machines.usbDevices.query()

		const adapters = devices.filter((device) => device.vendorId === SERIAL_ADAPTER.vendorId)
		expect(adapters).toHaveLength(3)
		for (const device of adapters) {
			expect(device).toMatchObject({...SERIAL_ADAPTER, name: 'QEMU USB SERIAL', connected: true})
			expect(device.machineId).toBeUndefined()
			expect(device.hostUse).toBeUndefined()
		}
		adapter = adapters.find(({serial}) => serial === 'UMBREL-A')!
		;[leftTwin, rightTwin] = adapters
			.filter(({serial}) => serial === 'TWIN')
			.sort((a, b) => a.port.localeCompare(b.port))
		// The twins only differ in the port they're plugged into
		expect(leftTwin.port).toMatch(/\/2$/)
		expect(rightTwin.port).toMatch(/\/3$/)

		drive = devices.find((device) => device.vendorId === USB_DRIVE.vendorId)!
		// Files can eject it for a machine
		expect(drive).toMatchObject({...USB_DRIVE, connected: true, hostUse: {reason: 'storage', takeable: true}})

		expect(devices.filter((device) => device.vendorId === USB_ETHERNET.vendorId)).toHaveLength(1)

		// Only USB devices themselves are listed, never root hubs
		expect(devices).toHaveLength(5)
	})

	test('keeps the USB device list private', async () => {
		await expect(umbreld.unauthenticatedClient.machines.usbDevices.query()).rejects.toThrow()
	})

	test('creates two running machines', async () => {
		// Machines activates libvirt in the background after boot, and capabilities waits for it
		await pRetry(async () => expect((await umbreld.client.machines.capabilities.query()).libvirtAvailable).toBe(true), {
			retries: 30,
			minTimeout: 1_000,
			maxTimeout: 1_000,
		})
		// A four-byte boot program that halts forever, as in the main Machines test
		const disk = Buffer.alloc(1024 * 1024)
		disk.set([0xfa, 0xf4, 0xeb, 0xfd])
		disk.set([0x55, 0xaa], 510)
		await umbreld.api.post('files/upload?path=/Home/usb-halt.img', {body: disk})
		for (const name of ['USB miner', 'USB assistant']) {
			await umbreld.client.machines.create.mutate({
				name,
				imagePath: '/Home/usb-halt.img',
				arch: 'amd64',
				firmware: 'bios',
				diskSizeGb: 1,
				cores: 1,
				memoryGb: 1,
			})
		}
		await waitForRunning(miner)
		await waitForRunning(assistant)
		expect(await passedThrough(miner)).toEqual([])
	})

	test('passes devices through to a running machine straight away', async () => {
		const machine = await umbreld.client.machines.updateSettings.mutate({
			id: miner,
			usbDevices: [identity(adapter), identity(leftTwin)],
		})
		expect(machine.usbDevices).toEqual([
			{...identity(adapter), name: 'QEMU USB SERIAL'},
			{...identity(leftTwin), name: 'QEMU USB SERIAL'},
		])

		// The guest has both, and the host's serial driver let go of them
		const [slot1, slot2] = [await serialAdapter(1), await serialAdapter(2)]
		expect(await passedThrough(miner)).toEqual(addresses(slot1, slot2))
		expect(await passedThrough(assistant)).toEqual([])
		expect(slot1.driver).not.toBe('ftdi_sio')
		expect(slot2.driver).not.toBe('ftdi_sio')
		expect((await serialAdapter(3)).driver).toBe('ftdi_sio')
		const usb = await umbreld.vm.sshAsRoot(
			`virsh --connect qemu:///system qemu-monitor-command umbrel-machine-${miner} --hmp 'info usb'`,
		)
		expect(usb.match(/QEMU USB SERIAL/g)).toHaveLength(2)

		const devices = await umbreld.client.machines.usbDevices.query()
		// The machine's QEMU holds them now, which doesn't count as Umbrel using them
		for (const assigned of [adapter, leftTwin]) {
			expect(findDevice(devices, assigned)?.machineId).toBe(miner)
			expect(findDevice(devices, assigned)?.hostUse).toBeUndefined()
		}
		expect(findDevice(devices, rightTwin)?.machineId).toBeUndefined()
	})

	test('refuses devices that Umbrel, a program, or another machine is using', async () => {
		await expect(
			umbreld.client.machines.updateSettings.mutate({id: assistant, usbDevices: [identity(adapter)]}),
		).rejects.toThrow('[machine-usb-device-assigned]')
		await expect(
			umbreld.client.machines.updateSettings.mutate({
				id: assistant,
				usbDevices: [{vendorId: 'dead', productId: 'beef', port: 'pci0000:00/0000:00:1d.0/9'}],
			}),
		).rejects.toThrow('[machine-usb-device-not-found]')

		// Hold the right twin's serial port open on the host, as an app talking to
		// a Zigbee adapter would
		await umbreld.vm.sshAsRoot(`
tty=$(ls /sys/bus/usb/devices/*-3/*:1.0/ | grep -m1 '^ttyUSB')
systemd-run --quiet --unit=umbrel-test-serial-holder python3 -c "import os, time; os.open('/dev/$tty', os.O_RDWR | os.O_NONBLOCK | os.O_NOCTTY); time.sleep(3600)"
sleep 1`)
		try {
			// Only apps can be made to give a device up, never anything else on Umbrel
			expect(findDevice(await umbreld.client.machines.usbDevices.query(), rightTwin)?.hostUse).toEqual({
				reason: 'in-use',
				takeable: false,
			})
			await expect(
				umbreld.client.machines.updateSettings.mutate({id: assistant, usbDevices: [identity(rightTwin)]}),
			).rejects.toThrow('[machine-usb-device-in-use] in-use')
		} finally {
			await umbreld.vm.sshAsRoot('systemctl stop umbrel-test-serial-holder')
		}

		// Nothing was assigned along the way
		const machines = await umbreld.client.machines.list.query()
		expect(machines.find(({id}) => id === assistant)?.usbDevices).toEqual([])
		expect(await passedThrough(assistant)).toEqual([])
	})

	test('takes a twin from the app using it, leaving the first machine alone', async () => {
		// The app opens the only adapter Umbrel still has, the right twin
		await umbreld.client.appStore.addRepository.mutate({url: gitServer.url.replace('localhost', '10.0.2.2')})
		await pRetry(
			async () => {
				const registry = await umbreld.client.appStore.registry.query()
				expect(registry.some((repository) => repository.apps.some((app) => app.id === USB_APP.id))).toBe(true)
			},
			{retries: 60, minTimeout: 1_000, maxTimeout: 1_000},
		)
		await umbreld.client.apps.install.mutate({appId: USB_APP.id})
		await pRetry(
			async () =>
				expect(findDevice(await umbreld.client.machines.usbDevices.query(), rightTwin)?.hostUse).toEqual({
					reason: 'in-use',
					apps: [USB_APP],
					takeable: true,
				}),
			{retries: 120, minTimeout: 1_000, maxTimeout: 1_000},
		)

		await umbreld.client.machines.updateSettings.mutate({id: assistant, usbDevices: [identity(rightTwin)]})

		expect(await passedThrough(assistant)).toEqual(addresses(await serialAdapter(3)))
		expect(await passedThrough(miner)).toEqual(addresses(await serialAdapter(1), await serialAdapter(2)))
		expect((await serialAdapter(3)).driver).not.toBe('ftdi_sio')
		// The app lost the adapter as if it were unplugged, and carries on
		expect(await umbreld.vm.sshAsRoot(`docker inspect --format '{{.State.Running}}' ${USB_APP.id}_server_1`)).toBe(
			'true',
		)
		// Agreeing is never remembered with the assignment
		const machines = await umbreld.client.machines.list.query()
		expect(machines.find(({id}) => id === assistant)?.usbDevices).toEqual([
			{...identity(rightTwin), name: 'QEMU USB SERIAL'},
		])
	})

	test("gives a replugged device back to its own machine, never to its twin's", async () => {
		const before = await serialAdapter(2)
		await umbreld.vm.disconnectUsbSerial({slot: 2})

		// The unplugged twin's stale entry is dropped and it's listed as unplugged
		await pRetry(
			async () => {
				expect(await passedThrough(miner)).toEqual(addresses(await serialAdapter(1)))
				const devices = await umbreld.client.machines.usbDevices.query()
				expect(findDevice(devices, leftTwin)).toMatchObject({connected: false, machineId: miner})
			},
			{retries: 30, minTimeout: 1_000, maxTimeout: 1_000},
		)

		await umbreld.vm.connectUsbSerial({slot: 2})
		await pRetry(
			async () => {
				const after = await serialAdapter(2)
				expect(after.device).not.toBe(before.device)
				expect(await passedThrough(miner)).toEqual(addresses(await serialAdapter(1), after))
			},
			{retries: 30, minTimeout: 1_000, maxTimeout: 1_000},
		)
		expect(await passedThrough(assistant)).toEqual(addresses(await serialAdapter(3)))
	})

	// Apps start before machines, so the app grabs every adapter again on the
	// way up and the machines take theirs back
	test('keeps passthrough across an Umbrel reboot', async () => {
		const definition = await umbreld.vm.sshAsRoot(`cat /home/umbrel/umbrel/machines/${miner}/machine.yaml`)
		expect(definition).toContain('usbDevices:')
		expect(definition).toContain(`port: ${adapter.port}`)

		await umbreld.vm.powerOff()
		await umbreld.vm.powerOn()
		await umbreld.login()
		await waitForRunning(miner)
		await waitForRunning(assistant)

		await pRetry(
			async () => {
				expect(await passedThrough(miner)).toEqual(addresses(await serialAdapter(1), await serialAdapter(2)))
				expect(await passedThrough(assistant)).toEqual(addresses(await serialAdapter(3)))
			},
			{retries: 30, minTimeout: 1_000, maxTimeout: 1_000},
		)
	})

	test('starts a machine without an unplugged device and passes it through once plugged in', async () => {
		await umbreld.vm.disconnectUsbSerial({slot: 1})
		// The minimal guest ignores ACPI shutdown
		await umbreld.client.machines.forceStop.mutate({id: miner})
		await umbreld.client.machines.start.mutate({id: miner})
		expect(await passedThrough(miner)).toEqual(addresses(await serialAdapter(2)))

		await umbreld.vm.connectUsbSerial({slot: 1})
		await pRetry(
			async () => expect(await passedThrough(miner)).toEqual(addresses(await serialAdapter(1), await serialAdapter(2))),
			{retries: 30, minTimeout: 1_000, maxTimeout: 1_000},
		)
	})

	test('takes its devices back from an app when it starts', async () => {
		await umbreld.client.machines.forceStop.mutate({id: miner})
		await pRetry(
			async () => {
				expect((await serialAdapter(1)).driver).toBe('ftdi_sio')
				expect((await serialAdapter(2)).driver).toBe('ftdi_sio')
			},
			{retries: 20, minTimeout: 500, maxTimeout: 500},
		)
		// The app grabs both adapters while the machine is off
		await umbreld.client.apps.restart.mutate({appId: USB_APP.id})
		await pRetry(
			async () => {
				const devices = await umbreld.client.machines.usbDevices.query()
				for (const assigned of [adapter, leftTwin]) {
					expect(findDevice(devices, assigned)).toMatchObject({
						machineId: miner,
						hostUse: {reason: 'in-use', apps: [USB_APP], takeable: true},
					})
				}
			},
			{retries: 60, minTimeout: 1_000, maxTimeout: 1_000},
		)

		await umbreld.client.machines.start.mutate({id: miner})
		expect(await passedThrough(miner)).toEqual(addresses(await serialAdapter(1), await serialAdapter(2)))
	})

	test('follows a device that reconnects as a different model in its port, as a USB NPU does once its firmware loads', async () => {
		await umbreld.vm.swapUsbSerial({slot: 1})

		// The machine has the device in its new form straight away, even though
		// systemd-logind and acpid hold every keyboard open on the host
		await pRetry(
			async () => {
				const keyboard = await deviceInPort(adapter.port)
				expect(keyboard.vendorId).toBe(KEYBOARD.vendorId)
				const listed = findDevice(await umbreld.client.machines.usbDevices.query(), adapter)
				expect(listed).toMatchObject({...identity(adapter), connected: true, machineId: miner})
				expect(listed?.hostUse).toBeUndefined()
				expect(await passedThrough(miner)).toEqual(addresses(keyboard, await serialAdapter(2)))
			},
			{retries: 30, minTimeout: 1_000, maxTimeout: 1_000},
		)

		// It remembers the new model, so it keeps the device across restarts
		const definition = await umbreld.vm.sshAsRoot(`cat /home/umbrel/umbrel/machines/${miner}/machine.yaml`)
		expect(definition).toContain('aliases:')
		expect(definition).toContain(KEYBOARD.vendorId)
		await umbreld.client.machines.forceStop.mutate({id: miner})
		await umbreld.client.machines.start.mutate({id: miner})
		expect(await passedThrough(miner)).toEqual(addresses(await deviceInPort(adapter.port), await serialAdapter(2)))

		// And in its first form again
		await umbreld.vm.swapUsbSerial({slot: 1})
		await pRetry(
			async () => expect(await passedThrough(miner)).toEqual(addresses(await serialAdapter(1), await serialAdapter(2))),
			{retries: 30, minTimeout: 1_000, maxTimeout: 1_000},
		)
	})

	test('ejects the drive from Files for a machine', async () => {
		await umbreld.client.machines.updateSettings.mutate({
			id: assistant,
			usbDevices: [identity(rightTwin), identity(drive)],
		})

		expect(await passedThrough(assistant)).toEqual(addresses(await serialAdapter(3), await usbDrive()))
		expect((await usbDrive()).driver).not.toBe('usb-storage')
		expect(await externalMounts()).not.toContain('/External/Drive')
	})

	test('keeps a drive out of Files while its machine is off, and gives it back once unassigned', async () => {
		await umbreld.client.machines.forceStop.mutate({id: assistant})
		await pRetry(async () => expect((await usbDrive()).driver).toBe('usb-storage'), {
			retries: 20,
			minTimeout: 500,
			maxTimeout: 500,
		})
		// The host has the drive back but leaves it alone for the machine, and
		// Files doesn't offer it
		await new Promise((resolve) => setTimeout(resolve, 5_000))
		expect(await umbreld.vm.sshAsRoot(`lsblk --noheadings --output MOUNTPOINTS /dev/disk/by-label/Drive`)).toBe('')
		expect((await umbreld.client.files.externalDevices.query()).filter(({transport}) => transport === 'usb')).toEqual(
			[],
		)

		// Unassigning it while the machine is off mounts it again
		await umbreld.client.machines.updateSettings.mutate({id: assistant, usbDevices: [identity(rightTwin)]})
		await waitForExternalStorage(umbreld, {path: '/External/Drive'})

		// And the machine has it again whenever it runs
		await umbreld.client.machines.updateSettings.mutate({
			id: assistant,
			usbDevices: [identity(rightTwin), identity(drive)],
		})
		await umbreld.client.machines.start.mutate({id: assistant})
		expect(await passedThrough(assistant)).toEqual(addresses(await serialAdapter(3), await usbDrive()))
		expect(await externalMounts()).not.toContain('/External/Drive')
	})

	test('ejects its drive from Files when it starts, if Files mounted it just as the machine was given it', async () => {
		await umbreld.client.machines.forceStop.mutate({id: assistant})
		await pRetry(async () => expect((await usbDrive()).driver).toBe('usb-storage'), {
			retries: 20,
			minTimeout: 500,
			maxTimeout: 500,
		})
		// Mount it where Files would have, as if Files had decided to mount the
		// drive just before the machine was given it
		await umbreld.vm.sshAsRoot(`
dev=$(readlink -f /dev/disk/by-label/Drive)
mkdir -p /home/umbrel/umbrel/external/Drive
mount "$dev" /home/umbrel/umbrel/external/Drive`)
		expect(await externalMounts()).toContain('/External/Drive')
		expect(findDevice(await umbreld.client.machines.usbDevices.query(), drive)).toMatchObject({
			machineId: assistant,
			hostUse: {reason: 'storage', takeable: true},
		})

		await umbreld.client.machines.start.mutate({id: assistant})

		// udev looking the drive over once it's unmounted doesn't hold the machine up
		expect(await passedThrough(assistant)).toEqual(addresses(await serialAdapter(3), await usbDrive()))
		expect(await externalMounts()).not.toContain('/External/Drive')
	})

	test('hands a device back to Umbrel when it is removed from a running machine', async () => {
		await umbreld.client.machines.updateSettings.mutate({id: miner, usbDevices: [identity(leftTwin)]})

		expect(await passedThrough(miner)).toEqual(addresses(await serialAdapter(2)))
		await pRetry(async () => expect((await serialAdapter(1)).driver).toBe('ftdi_sio'), {
			retries: 20,
			minTimeout: 500,
			maxTimeout: 500,
		})
		expect(findDevice(await umbreld.client.machines.usbDevices.query(), adapter)?.machineId).toBeUndefined()

		// A drive goes straight back to Files
		await umbreld.client.machines.updateSettings.mutate({id: assistant, usbDevices: [identity(rightTwin)]})
		expect(await passedThrough(assistant)).toEqual(addresses(await serialAdapter(3)))
		await waitForExternalStorage(umbreld, {path: '/External/Drive'})
	})

	test('passes through a drive that was ejected in Files', async () => {
		// Ejecting a drive in Files leaves the host's USB storage driver with no
		// disks, just as it has while it's still finding the disks of a drive
		// plugged in a moment ago
		const ejected = (await umbreld.client.files.externalDevices.query()).find(({transport}) => transport === 'usb')!
		await umbreld.client.files.unmountExternalDevice.mutate({deviceId: ejected.id})
		expect(await externalMounts()).not.toContain('/External/Drive')

		await umbreld.client.machines.updateSettings.mutate({
			id: assistant,
			usbDevices: [identity(rightTwin), identity(drive)],
		})
		expect(await passedThrough(assistant)).toEqual(addresses(await serialAdapter(3), await usbDrive()))
		expect(findDevice(await umbreld.client.machines.usbDevices.query(), drive)).toMatchObject({
			machineId: assistant,
			connected: true,
		})

		// And it's back in Files once unassigned
		await umbreld.client.machines.updateSettings.mutate({id: assistant, usbDevices: [identity(rightTwin)]})
		await waitForExternalStorage(umbreld, {path: '/External/Drive'})
	})

	test('takes a network adapter Umbrel can do without, and keeps Umbrel off it', async () => {
		// QEMU's adapter has the USB ID of a server management link, which udev
		// marks as link-local only, so give it the DHCP connection a real adapter
		// gets from NetworkManager by default. That also gives NetworkManager a
		// connection it would bring back up whenever it could.
		let ethernet = (await umbreld.client.machines.usbDevices.query()).find(
			({vendorId}) => vendorId === USB_ETHERNET.vendorId,
		)!
		const {name} = await pRetry(
			async () => {
				const adapter = await networkAdapter(ethernet.port)
				expect(adapter.name).toBeTruthy()
				return adapter
			},
			{retries: 30, minTimeout: 1_000, maxTimeout: 1_000},
		)
		await umbreld.vm.sshAsRoot(`
nmcli connection add type ethernet ifname ${name} con-name usb-ethernet ipv4.method auto ipv6.method disabled connection.autoconnect-priority 10
nmcli connection up usb-ethernet`)

		// The host is using it now, but stays connected through its own port
		// without it
		await pRetry(
			async () => {
				ethernet = (await umbreld.client.machines.usbDevices.query()).find(
					({vendorId}) => vendorId === USB_ETHERNET.vendorId,
				)!
				expect(ethernet.hostUse).toEqual({reason: 'network', takeable: true})
			},
			{retries: 60, minTimeout: 1_000, maxTimeout: 1_000},
		)
		expect((await networkAdapter(ethernet.port)).address).toMatch(/^10\.0\.11\./)

		await umbreld.client.machines.updateSettings.mutate({
			id: assistant,
			usbDevices: [identity(rightTwin), identity(ethernet)],
		})
		expect(await passedThrough(assistant)).toEqual(addresses(await serialAdapter(3), await deviceInPort(ethernet.port)))

		// While the machine is off the host has the adapter back, but
		// NetworkManager leaves it alone for the machine, even when it's replugged
		const leftAlone = async () => {
			await pRetry(async () => expect(await networkAdapter(ethernet.port)).toMatchObject({managed: false}), {
				retries: 30,
				minTimeout: 1_000,
				maxTimeout: 1_000,
			})
			await new Promise((resolve) => setTimeout(resolve, 10_000))
			expect(await networkAdapter(ethernet.port)).toMatchObject({managed: false, address: ''})
		}
		await umbreld.client.machines.forceStop.mutate({id: assistant})
		await leftAlone()
		expect(findDevice(await umbreld.client.machines.usbDevices.query(), ethernet)?.hostUse).toBeUndefined()
		await umbreld.vm.disconnectUsbNet({slot: 1})
		await umbreld.vm.connectUsbNet({slot: 1})
		await leftAlone()

		await umbreld.client.machines.start.mutate({id: assistant})
		expect(await passedThrough(assistant)).toEqual(addresses(await serialAdapter(3), await deviceInPort(ethernet.port)))

		// Once it's unassigned the host uses it again
		await umbreld.client.machines.updateSettings.mutate({id: assistant, usbDevices: [identity(rightTwin)]})
		await pRetry(async () => expect((await networkAdapter(ethernet.port)).address).toMatch(/^10\.0\.11\./), {
			retries: 60,
			minTimeout: 1_000,
			maxTimeout: 1_000,
		})
	})

	test('releases every device when the machines are uninstalled', async () => {
		await umbreld.client.machines.uninstall.mutate({id: miner})
		await umbreld.client.machines.uninstall.mutate({id: assistant})

		await pRetry(
			async () => {
				for (const slot of [1, 2, 3]) expect((await serialAdapter(slot)).driver).toBe('ftdi_sio')
			},
			{retries: 20, minTimeout: 500, maxTimeout: 500},
		)
		const devices = await umbreld.client.machines.usbDevices.query()
		expect(devices.filter(({machineId}) => machineId)).toEqual([])
		expect(devices.filter(({connected}) => !connected)).toEqual([])
	})
})
