import {randomUUID} from 'node:crypto'
import fsp from 'node:fs/promises'
import os from 'node:os'
import nodePath from 'node:path'

import fse from 'fs-extra'
import yaml from 'js-yaml'
import {afterEach, describe, expect, test} from 'vitest'

import type {MachineDefinition} from './domain.ts'
import MachineStore from './machine-store.ts'

const roots: string[] = []

afterEach(async () => Promise.all(roots.splice(0).map((root) => fse.remove(root))))

function definition(id = randomUUID()): MachineDefinition {
	return {
		version: 1,
		id,
		name: 'Persistent machine',
		osId: 'custom',
		osName: 'Custom',
		osVersion: 'Custom disk image',
		arch: 'amd64',
		platformProfile: 'modern-x86',
		machineType: 'pc-q35-9.2',
		firmware: 'uefi',
		uuid: randomUUID(),
		macAddress: '02:00:00:00:00:01',
		diskSizeGb: 32,
		cores: 2,
		memoryMb: 4_096,
		autostart: true,
		pinned: false,
		createdAt: Date.now(),
		portForwards: [],
	}
}

describe('MachineStore', () => {
	test('round trips a machine definition from its self-contained directory', async () => {
		const root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'machine-store-'))
		roots.push(root)
		const store = new MachineStore(root)
		await store.start()
		const machine = definition()
		machine.firstBootSetup = {startedAt: 123, tokenHash: 'a'.repeat(64), manual: true}
		machine.installMedia = 'media/install.img'

		await store.write(machine)

		await expect(store.read(machine.id)).resolves.toEqual(machine)
		await expect(store.list()).resolves.toEqual([machine])
	})

	test('persists the network mode and rejects unknown modes', async () => {
		const root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'machine-store-'))
		roots.push(root)
		const store = new MachineStore(root)
		await store.start()
		const bridged = {...definition(), networkMode: 'bridged' as const}

		await store.write(bridged)
		await expect(store.read(bridged.id)).resolves.toEqual(bridged)

		await expect(store.write({...definition(), networkMode: 'host' as any})).rejects.toThrow()
		const invalid = definition()
		await fse.ensureDir(store.directory(invalid.id))
		await fsp.writeFile(store.definitionPath(invalid.id), yaml.dump({...invalid, networkMode: 'host'}))
		await expect(store.read(invalid.id)).rejects.toThrow()
	})

	test('ignores hidden staging and invalid directories during recovery', async () => {
		const root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'machine-store-'))
		roots.push(root)
		const store = new MachineStore(root)
		await store.start()
		await fse.ensureDir(nodePath.join(store.root, '.interrupted.creating'))
		await fse.ensureDir(nodePath.join(store.root, 'invalid'))
		await fsp.writeFile(nodePath.join(store.root, 'invalid', 'machine.yaml'), 'not: a machine')

		await expect(store.list()).resolves.toEqual([])
	})

	test('loads pre-MiB machine definitions from before the schema migration', async () => {
		const root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'machine-store-'))
		roots.push(root)
		const store = new MachineStore(root)
		await store.start()
		const machine = definition()
		const {memoryMb: _memoryMb, ...legacy} = machine
		await fse.ensureDir(store.directory(machine.id))
		await fsp.writeFile(store.definitionPath(machine.id), yaml.dump({...legacy, memoryGb: 4}))

		await expect(store.read(machine.id)).resolves.toMatchObject({memoryMb: 4_096})
	})

	test('loads an address from an older VM subnet so startup can migrate it', async () => {
		const root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'machine-store-'))
		roots.push(root)
		const store = new MachineStore(root)
		await store.start()
		const machine = {...definition(), ipAddress: '100.101.102.2'}

		await store.write(machine)

		await expect(store.read(machine.id)).resolves.toMatchObject({ipAddress: '100.101.102.2'})
	})

	test('drops the retired host/LAN bind scope when loading existing forwards', async () => {
		const root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'machine-store-'))
		roots.push(root)
		const store = new MachineStore(root)
		await store.start()
		const machine = definition()
		await fse.ensureDir(store.directory(machine.id))
		await fsp.writeFile(
			store.definitionPath(machine.id),
			yaml.dump({
				...machine,
				portForwards: [{id: 'ssh', protocol: 'tcp', hostPort: 40_022, guestPort: 22, bind: 'host'}],
			}),
		)

		const restored = await store.read(machine.id)
		expect(restored.portForwards).toEqual([{id: 'ssh', protocol: 'tcp', hostPort: 40_022, guestPort: 22}])
	})

	test('round trips USB passthrough assignments and leaves them out until there are some', async () => {
		const root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'machine-store-'))
		roots.push(root)
		const store = new MachineStore(root)
		await store.start()
		const machine = definition()
		await store.write(machine)
		expect(await fsp.readFile(store.definitionPath(machine.id), 'utf8')).not.toContain('usbDevices')

		machine.usbDevices = [
			{vendorId: '10c4', productId: 'ea60', serial: 'A1B2C3', port: 'pci0000:00/0000:00:14.0/2', name: 'CP2102'},
			{vendorId: '1a86', productId: '7523', port: 'pci0000:00/0000:00:14.0/1.4'},
			// A Coral NPU, which reconnects as a Google device once its firmware loads
			{
				vendorId: '1a6e',
				productId: '089a',
				port: 'pci0000:00/0000:00:14.0/3',
				aliases: [{vendorId: '18d1', productId: '9302'}],
			},
			// A SATA enclosure, known by the disk inside it
			{
				vendorId: '152d',
				productId: '0578',
				serial: '0123456789ABCDEF',
				port: 'pci0000:00/0000:00:14.0/4',
				diskSerials: ['Samsung_SSD_870_EVO_1TB_S6PUNX0R123456'],
			},
		]
		await store.write(machine)

		await expect(store.read(machine.id)).resolves.toEqual(machine)
	})

	test('rejects malformed USB device identities', async () => {
		const root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'machine-store-'))
		roots.push(root)
		const store = new MachineStore(root)
		await store.start()
		const machine = definition()
		await fse.ensureDir(store.directory(machine.id))
		await fsp.writeFile(
			store.definitionPath(machine.id),
			yaml.dump({
				...machine,
				usbDevices: [{vendorId: 'not-hex', productId: 'ea60', port: 'pci0000:00/0000:00:14.0/2'}],
			}),
		)

		await expect(store.read(machine.id)).rejects.toThrow()
	})

	test('rejects external disk paths that escape Files-managed storage', async () => {
		const root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'machine-store-'))
		roots.push(root)
		const store = new MachineStore(root)
		await store.start()
		const machine = {...definition(), diskPath: '/External/drive/../../Home/important.qcow2'}
		await fse.ensureDir(store.directory(machine.id))
		await fsp.writeFile(store.definitionPath(machine.id), yaml.dump(machine))

		await expect(store.read(machine.id)).rejects.toThrow('[machine-external-disk-location-invalid]')
	})
})
