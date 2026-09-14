import fsp from 'node:fs/promises'
import os from 'node:os'
import nodePath from 'node:path'

import fse from 'fs-extra'
import yaml from 'js-yaml'
import pWaitFor from 'p-wait-for'
import {afterEach, describe, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.js'

const downloadControls = vi.hoisted(
	() =>
		[] as Array<{
			resolve: () => Promise<void>
			reject: (error: Error) => void
		}>,
)
const preparedWindowsOptions = vi.hoisted(() => [] as Array<{licenseKey?: string}>)
const cloudInitUserData = vi.hoisted(() => [] as string[])
const downloadHooks = vi.hoisted(() => ({onStart: undefined as (() => void) | undefined}))
const guestApiControls = vi.hoisted(() => ({starts: 0, stops: 0}))
const displayControls = vi.hoisted(() => ({
	socketPath: '',
	failNextPointer: false,
	pointerEvents: [] as Array<[number, number, number]>,
}))
const libvirtControls = vi.hoisted(() => ({
	startCalls: [] as string[],
	stopCalls: [] as Array<{id: string; force: boolean}>,
	suspendedIds: new Set<string>(),
	resizeCalls: [] as Array<{id: string; disk: string; sizeGb: number}>,
	diskVirtualSizes: new Map<string, number>(),
	ejectCalls: [] as string[],
	ejectFailures: new Set<string>(),
	startBarrier: undefined as Promise<void> | undefined,
	reconcileNetworkFailures: 0,
	stateFailures: new Set<string>(),
	backupCommitFailures: new Set<string>(),
	waitForConvertAbort: false,
	convertSignals: [] as AbortSignal[],
}))

vi.mock('./safe-download.js', async () => {
	const fsp = await import('node:fs/promises')
	const nodePath = await import('node:path')
	return {
		safeDownload: vi.fn(
			({
				destination,
				onProgress,
				signal,
			}: {
				destination: string
				onProgress?: (value: any) => void
				signal?: AbortSignal
			}) =>
				new Promise<{size: number; sha256: string}>((resolve, reject) => {
					signal?.addEventListener('abort', () => reject(signal.reason), {once: true})
					downloadControls.push({
						resolve: async () => {
							await fsp.mkdir(nodePath.dirname(destination), {recursive: true})
							await fsp.writeFile(destination, Buffer.alloc(1024))
							onProgress?.({downloadedBytes: 1024, totalBytes: 1024, percent: 100})
							resolve({size: 1024, sha256: 'ab'.repeat(32)})
						},
						reject,
					})
					const onStart = downloadHooks.onStart
					downloadHooks.onStart = undefined
					onStart?.()
				}),
		),
	}
})

vi.mock('execa', async () => {
	const fsp = await import('node:fs/promises')
	return {
		execa: vi.fn(async (command: string, args: string[]) => {
			if (command === 'mkpasswd') return {stdout: '$6$test', exitCode: 0}
			if (command === 'chown') return {stdout: '', exitCode: 0}
			if (command === 'cloud-localds') {
				cloudInitUserData.push(await fsp.readFile(args[1], 'utf8'))
				await fsp.writeFile(args[0], 'seed')
				return {stdout: '', exitCode: 0}
			}
			throw new Error(`Unexpected command in machine install test: ${command}`)
		}),
	}
})

vi.mock('./windows-image.js', async () => {
	const fsp = await import('node:fs/promises')
	return {
		prepareWindowsInstallMedia: vi.fn(async (_source: string, destination: string, options: {licenseKey?: string}) => {
			preparedWindowsOptions.push(options)
			await fsp.writeFile(destination, `licenseKey=${options.licenseKey ?? ''}`)
		}),
	}
})

vi.mock('./guest-api.js', () => ({
	default: class FakeMachineGuestApi {
		async start() {
			guestApiControls.starts++
		}
		async stop() {
			guestApiControls.stops++
		}
	},
}))

vi.mock('./rfb-client.js', async () => ({
	...(await vi.importActual<typeof import('./rfb-client.js')>('./rfb-client.js')),
	default: class FakeRfbClient {
		width = 1280
		height = 800
		static async connect() {
			return new FakeRfbClient()
		}
		async keyEvent() {}
		async pointerEvent(x: number, y: number, buttonMask: number) {
			if (displayControls.failNextPointer) {
				displayControls.failNextPointer = false
				throw new Error('display interrupted')
			}
			displayControls.pointerEvents.push([x, y, buttonMask])
		}
		async captureFramebuffer() {
			return {width: this.width, height: this.height, rgb: Buffer.alloc(this.width * this.height * 3)}
		}
		close() {}
	},
}))

vi.mock('./machine-control.js', async () => {
	const actual = await vi.importActual<typeof import('./machine-control.js')>('./machine-control.js')
	return {
		...actual,
		encodeScreenshot: async (frame: {width: number; height: number}) => ({
			width: frame.width,
			height: frame.height,
			mimeType: 'image/jpeg',
			data: '',
		}),
	}
})

vi.mock('./libvirt.js', async () => {
	const fsp = await import('node:fs/promises')
	const nodePath = await import('node:path')
	return {
		MACHINE_GUEST_HOST_ADDRESS: '10.203.0.1',
		QEMU_GIBIBYTE_BYTES: 1_024 ** 3,
		qemuImageFormatForPath: (path: string) => {
			const extension = nodePath.extname(path).slice(1)
			return extension === 'img' ? 'raw' : extension === 'vhd' ? 'vpc' : extension
		},
		default: class FakeLibvirt {
			available = true
			kvmAvailable = false
			states = new Map<string, 'running' | 'stopped'>()

			async probe() {
				return {available: true, kvmAvailable: false}
			}

			async reconcileNetwork() {
				if (libvirtControls.reconcileNetworkFailures > 0) {
					libvirtControls.reconcileNetworkFailures--
					throw new Error('[machine-lan-interface-unavailable]')
				}
			}
			async leasedIpAddresses() {
				return []
			}
			async reconcileFirewall() {}
			async ensureFirewall() {}
			async cleanupNetwork() {}

			async state(id: string) {
				if (libvirtControls.stateFailures.has(id)) throw new Error('[machine-state-unavailable]')
				if (libvirtControls.suspendedIds.has(id)) return 'suspended'
				return this.states.get(id) ?? 'stopped'
			}

			async diskUsage() {
				return 0
			}

			displaySocket() {
				return displayControls.socketPath
			}

			async diskUsageBytes() {
				return 0
			}
			async diskVirtualSizeBytes(disk: string) {
				return libvirtControls.diskVirtualSizes.get(disk) ?? 1_024 ** 3
			}

			async resizeDisk(definition: {id: string}, disk: string, sizeGb: number) {
				libvirtControls.resizeCalls.push({id: definition.id, disk, sizeGb})
				libvirtControls.diskVirtualSizes.set(disk, sizeGb * 1_024 ** 3)
			}

			async convertDisk(
				source: string,
				destination: string,
				_size: number,
				_format: string,
				signal: AbortSignal,
				onProgress?: (value: number) => void,
			) {
				libvirtControls.convertSignals.push(signal)
				onProgress?.(50)
				if (libvirtControls.waitForConvertAbort) {
					await new Promise<never>((_resolve, reject) => {
						if (signal.aborted) return reject(signal.reason)
						signal.addEventListener('abort', () => reject(signal.reason), {once: true})
					})
				}
				await fsp.copyFile(source, destination)
				onProgress?.(100)
			}

			async createDisk(destination: string) {
				await fsp.writeFile(destination, 'disk')
			}

			async initializeNvram(_definition: unknown, directory: string) {
				await fsp.writeFile(nodePath.join(directory, 'nvram.fd'), 'nvram')
			}

			async start(definition: {
				id: string
				cores: number
				memoryMb: number
				firmware: 'uefi' | 'bios'
				diskBus?: 'virtio' | 'sata'
			}) {
				libvirtControls.startCalls.push(definition.id)
				await libvirtControls.startBarrier
				libvirtControls.suspendedIds.delete(definition.id)
				this.states.set(definition.id, 'running')
				return {acceleration: 'tcg' as const}
			}

			async stop(id: string, {force = false} = {}) {
				libvirtControls.stopCalls.push({id, force})
				libvirtControls.suspendedIds.delete(id)
				this.states.set(id, 'stopped')
			}
			async restart() {}

			async ejectInstallMedia(definition: {id: string}) {
				libvirtControls.ejectCalls.push(definition.id)
				if (libvirtControls.ejectFailures.has(definition.id)) {
					throw new Error('[machine-install-media-eject-failed]')
				}
			}

			async cleanupRuntime() {}
			async pause() {}
			async resume() {}
			async pivotToBackupOverlay(_definition: {id: string}, overlay: string) {
				await fsp.writeFile(overlay, 'overlay')
			}
			async commitBackupOverlay(definition: {id: string}, overlay: string) {
				if (libvirtControls.backupCommitFailures.has(definition.id)) throw new Error('simulated commit failure')
				await fsp.rm(overlay, {force: true})
			}
		},
	}
})

import Machines from './machines.js'

const roots: string[] = []
const instances: Machines[] = []

afterEach(async () => {
	await Promise.all(instances.splice(0).map((machines) => machines.stop()))
	downloadControls.splice(0)
	preparedWindowsOptions.splice(0)
	cloudInitUserData.splice(0)
	downloadHooks.onStart = undefined
	guestApiControls.starts = 0
	guestApiControls.stops = 0
	libvirtControls.startCalls.splice(0)
	libvirtControls.stopCalls.splice(0)
	libvirtControls.suspendedIds.clear()
	libvirtControls.resizeCalls.splice(0)
	libvirtControls.diskVirtualSizes.clear()
	libvirtControls.ejectCalls.splice(0)
	libvirtControls.ejectFailures.clear()
	libvirtControls.startBarrier = undefined
	libvirtControls.reconcileNetworkFailures = 0
	libvirtControls.stateFailures.clear()
	libvirtControls.backupCommitFailures.clear()
	libvirtControls.waitForConvertAbort = false
	libvirtControls.convertSignals.splice(0)
	await Promise.all(roots.splice(0).map((root) => fse.remove(root)))
})

async function createMachines() {
	const root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'machine-install-'))
	roots.push(root)
	const filesRoot = nodePath.join(root, 'files')
	await Promise.all([
		fse.ensureDir(nodePath.join(filesRoot, 'External')),
		fse.ensureDir(nodePath.join(filesRoot, 'Network')),
	])
	const virtualToSystemPath = async (virtualPath: string) => {
		const normalized = nodePath.posix.normalize(virtualPath)
		const segments = normalized.split('/').filter(Boolean)
		if (!['External', 'Network'].includes(segments[0])) throw new Error('[invalid-base]')
		return nodePath.join(filesRoot, ...segments)
	}
	const logger = {log: vi.fn(), error: vi.fn()}
	const eventBus = {emit: vi.fn()}
	const machines = new Machines({
		dataDirectory: root,
		port: 3_006,
		logger: {createChildLogger: () => logger},
		eventBus,
		files: {virtualToSystemPath, getAllowedOperations: async () => ['writable']},
		apps: {instances: []},
		mcp: {removeMachineGrant: vi.fn(async () => true)},
	} as unknown as Umbreld)
	instances.push(machines)
	await machines.start()
	return {machines, root, filesRoot, eventBus, logger}
}

describe('background machine installation', () => {
	const catalogOsId = process.arch === 'arm64' ? 'ubuntu-26.04-server-arm64' : 'ubuntu-26.04-server-amd64'
	const catalogCreate = {osId: catalogOsId, username: 'umbrel', password: 'password'}

	test('keeps umbreld startup alive when transient machine networking cannot be reconciled', async () => {
		libvirtControls.reconcileNetworkFailures = 1

		const {machines} = await createMachines()

		await expect(machines.capabilities()).resolves.toMatchObject({libvirtAvailable: true})
	})

	test('starts the guest-only callback listener after machine networking is ready', async () => {
		await createMachines()

		expect(guestApiControls.starts).toBe(1)
	})

	test('atomically deduplicates slug ids for concurrent same-name creates', async () => {
		const {machines} = await createMachines()

		const [first, second] = await Promise.all(
			[1, 2].map(() =>
				machines.create({
					name: 'Concurrent Machine',
					...catalogCreate,
					diskSizeGb: 1,
					cores: 1,
					memoryGb: 1,
				}),
			),
		)
		await pWaitFor(() => downloadControls.length === 1)

		expect(new Set([first.id, second.id])).toEqual(new Set(['concurrent-machine', 'concurrent-machine-2']))
		expect(first.name).toBe('Concurrent Machine')
		expect(second.name).toBe('Concurrent Machine')

		await downloadControls[0].resolve()
		await pWaitFor(async () => (await machines.list()).every(({state}) => state === 'running'))
	})

	test('creates visible machines immediately and shares one active image download', async () => {
		const {machines} = await createMachines()

		const first = await machines.create({
			name: 'First machine',
			...catalogCreate,
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
		})
		const second = await machines.create({
			name: 'Second machine',
			...catalogCreate,
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
		})
		await pWaitFor(() => downloadControls.length === 1)

		expect(first).toMatchObject({state: 'installing', installPending: true})
		expect(second).toMatchObject({state: 'installing', installPending: true})
		expect(downloadControls).toHaveLength(1)

		await downloadControls[0].resolve()
		await pWaitFor(async () => (await machines.list()).every(({state}) => state === 'running'))
		expect(await machines.list()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({id: first.id, installPending: false}),
				expect.objectContaining({id: second.id, installPending: false}),
			]),
		)
	})

	test('cleans up server cloud-init media after authenticated first-boot completion', async () => {
		const {machines, root} = await createMachines()
		const machine = await machines.create({
			name: 'Server setup cleanup',
			...catalogCreate,
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
		})
		await pWaitFor(() => downloadControls.length === 1)
		let releaseStart!: () => void
		libvirtControls.startBarrier = new Promise<void>((resolve) => (releaseStart = resolve))
		await downloadControls[0].resolve()
		await pWaitFor(() => libvirtControls.startCalls.includes(machine.id))
		expect((await machines.list()).find(({id}) => id === machine.id)).toMatchObject({
			state: 'starting',
			installationState: 'starting',
			installProgress: 100,
			installPending: false,
		})
		releaseStart()
		await pWaitFor(async () => (await machines.list()).some(({id, state}) => id === machine.id && state === 'running'))

		const machineDirectory = nodePath.join(root, 'machines', machine.id)
		const seedPath = nodePath.join(machineDirectory, 'media', 'seed.iso')
		const config = yaml.load(cloudInitUserData[0].replace(/^#cloud-config\n/, '')) as {
			phone_home: {url: string}
		}
		const token = new URL(config.phone_home.url).pathname.split('/').at(-1)!
		expect((await machines.list()).find(({id}) => id === machine.id)).toMatchObject({
			firstBootSetup: true,
			installationState: 'setting-up',
			installationMediaAttached: false,
		})
		await expect(fse.pathExists(seedPath)).resolves.toBe(true)

		await expect(machines.completeFirstBootSetup(machine.id, token)).resolves.toBe(true)

		expect(libvirtControls.ejectCalls).toContain(machine.id)
		expect((await machines.list()).find(({id}) => id === machine.id)).toMatchObject({
			firstBootSetup: false,
			installationState: undefined,
		})
		await expect(fse.pathExists(seedPath)).resolves.toBe(false)
		const persisted = yaml.load(await fsp.readFile(nodePath.join(machineDirectory, 'machine.yaml'), 'utf8')) as {
			firstBootSetup?: unknown
			installMedia?: unknown
		}
		expect(persisted).not.toHaveProperty('firstBootSetup')
		expect(persisted).not.toHaveProperty('installMedia')
	})

	test('preserves settings changed while a background install is running', async () => {
		const {machines} = await createMachines()
		const machine = await machines.create({
			name: 'Original name',
			...catalogCreate,
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
		})
		await pWaitFor(() => downloadControls.length === 1)

		await machines.updateSettings(machine.id, {
			name: 'Updated name',
			cores: 2,
			memoryGb: 2,
			autostart: true,
		})
		await downloadControls[0].resolve()
		await pWaitFor(async () => (await machines.list()).some(({id, state}) => id === machine.id && state === 'running'))

		expect((await machines.list()).find(({id}) => id === machine.id)).toMatchObject({
			name: 'Updated name',
			cores: 2,
			memoryGb: 2,
			autostart: true,
			installPending: false,
		})
	})

	test('validates a combined settings request before growing its disk', async () => {
		const {machines, root, filesRoot} = await createMachines()
		const imports = nodePath.join(filesRoot, 'External', 'imports')
		await fse.ensureDir(imports)
		await fsp.writeFile(nodePath.join(imports, 'source.img'), 'source')
		const create = (name: string) =>
			machines.create({
				name,
				imagePath: '/External/imports/source.img',
				diskSizeGb: 1,
				cores: 1,
				memoryGb: 1,
			})
		const [machine, portOwner] = await Promise.all([create('Resize validation'), create('Port owner')])
		await pWaitFor(async () => (await machines.list()).every(({state}) => state === 'running'))
		const forward = {id: 'ssh', protocol: 'tcp' as const, hostPort: 40_022, guestPort: 22}
		await machines.updateSettings(portOwner.id, {portForwards: [forward]})

		await expect(
			machines.updateSettings(machine.id, {
				diskSizeGb: 2,
				portForwards: [{...forward, id: 'conflicting-ssh'}],
			}),
		).rejects.toThrow('[machine-port-conflict]')

		expect(libvirtControls.resizeCalls).toEqual([])
		const persisted = yaml.load(
			await fsp.readFile(nodePath.join(root, 'machines', machine.id, 'machine.yaml'), 'utf8'),
		) as {diskSizeGb: number}
		expect(persisted.diskSizeGb).toBe(1)
	})

	test('refuses growth below the real disk capacity and repairs stale metadata without shrinking', async () => {
		const {machines, root, filesRoot} = await createMachines()
		const imports = nodePath.join(filesRoot, 'External', 'imports')
		await fse.ensureDir(imports)
		await fsp.writeFile(nodePath.join(imports, 'source.img'), 'source')
		const machine = await machines.create({
			name: 'Stale disk metadata',
			imagePath: '/External/imports/source.img',
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
		})
		await pWaitFor(async () => (await machines.list()).some(({id, state}) => id === machine.id && state === 'running'))
		const disk = nodePath.join(root, 'machines', machine.id, 'disk.qcow2')
		libvirtControls.diskVirtualSizes.set(disk, 3 * 1_024 ** 3)

		await expect(machines.updateSettings(machine.id, {diskSizeGb: 2})).rejects.toThrow(
			'[machine-disk-shrink-not-allowed]',
		)
		expect(libvirtControls.resizeCalls).toEqual([])

		await expect(machines.updateSettings(machine.id, {diskSizeGb: 3})).resolves.toMatchObject({diskSizeGb: 3})
		expect(libvirtControls.resizeCalls).toEqual([])
		const persisted = yaml.load(
			await fsp.readFile(nodePath.join(root, 'machines', machine.id, 'machine.yaml'), 'utf8'),
		) as {diskSizeGb: number}
		expect(persisted.diskSizeGb).toBe(3)
	})

	test('keeps a failed install visible and retries the same operation', async () => {
		const {machines} = await createMachines()
		const machine = await machines.create({
			name: 'Retry machine',
			...catalogCreate,
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
		})
		await pWaitFor(() => downloadControls.length === 1)

		downloadControls[0].reject(new Error('simulated download failure'))
		await pWaitFor(async () => (await machines.list()).some(({id, state}) => id === machine.id && state === 'error'))
		expect((await machines.list()).find(({id}) => id === machine.id)).toMatchObject({installPending: true})

		await machines.retryInstall(machine.id)
		await pWaitFor(() => downloadControls.length === 2)
		expect(machines.listOsImages().find(({id}) => id === catalogOsId)).toMatchObject({state: 'downloading'})
		expect(machines.listOsImages().find(({id}) => id === catalogOsId)?.errorMessage).toBeUndefined()
		await downloadControls[1].resolve()
		await pWaitFor(async () => (await machines.list()).some(({id, state}) => id === machine.id && state === 'running'))
		expect((await machines.list()).find(({id}) => id === machine.id)).toMatchObject({installPending: false})
	})

	test('only cancels a shared image download after its last consumer leaves', async () => {
		const {machines} = await createMachines()
		const first = await machines.create({
			name: 'Cancelled consumer',
			...catalogCreate,
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
		})
		const second = await machines.create({
			name: 'Remaining consumer',
			...catalogCreate,
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
		})
		await pWaitFor(() => downloadControls.length === 1)

		await machines.uninstall(first.id)
		expect(downloadControls).toHaveLength(1)
		expect((await machines.list()).map(({id}) => id)).toEqual([second.id])

		await downloadControls[0].resolve()
		await pWaitFor(async () => (await machines.list()).some(({id, state}) => id === second.id && state === 'running'))
		expect((await machines.list()).find(({id}) => id === second.id)).toMatchObject({installPending: false})
	})

	test('observes a download rejection when install aborts before its waiter attaches', async () => {
		const {machines} = await createMachines()
		let uninstall: Promise<boolean> | undefined
		downloadHooks.onStart = () => {
			uninstall = machines.uninstall('abort-before-download-waiter')
		}

		await machines.create({
			name: 'Abort before download waiter',
			...catalogCreate,
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
		})
		await pWaitFor(() => uninstall !== undefined)

		await expect(uninstall!).resolves.toBe(true)
		await expect(machines.list()).resolves.toEqual([])
	})

	test('contains a final install-state emission failure in the detached job', async () => {
		const {machines, eventBus, logger} = await createMachines()
		const machine = await machines.create({
			name: 'Final emit failure',
			...catalogCreate,
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
		})
		await pWaitFor(() => downloadControls.length === 1)
		eventBus.emit.mockImplementation((event: string, payload: unknown) => {
			if (
				event === 'machines:updated' &&
				Array.isArray(payload) &&
				payload.some(({id, state}: {id?: string; state?: string}) => id === machine.id && state === 'error')
			) {
				throw new Error('simulated event failure')
			}
		})

		downloadControls[0].reject(new Error('simulated download failure'))
		await pWaitFor(() =>
			logger.error.mock.calls.some(([message]) =>
				String(message).includes(`Failed emitting final machine install state for ${machine.id}`),
			),
		)

		expect((await machines.list()).find(({id}) => id === machine.id)).toMatchObject({state: 'error'})
	})

	test('force-stop cancels an in-flight disk conversion without auto-starting the machine', async () => {
		const {machines, filesRoot} = await createMachines()
		const imports = nodePath.join(filesRoot, 'External', 'imports')
		await fse.ensureDir(imports)
		await fsp.writeFile(nodePath.join(imports, 'slow.img'), 'source')
		libvirtControls.waitForConvertAbort = true
		const startsBefore = libvirtControls.startCalls.length

		const machine = await machines.create({
			name: 'Cancelled conversion',
			imagePath: '/External/imports/slow.img',
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
		})
		await pWaitFor(() => libvirtControls.convertSignals.length === 1)

		await expect(machines.forceStopMachine(machine.id)).resolves.toBe(true)

		expect(libvirtControls.convertSignals[0].aborted).toBe(true)
		expect(libvirtControls.startCalls).toHaveLength(startsBefore)
		expect((await machines.list()).find(({id}) => id === machine.id)).toMatchObject({
			state: 'error',
			installPending: true,
			errorMessage: '[machine-install-interrupted]',
		})
	})

	test('accepts ISOs and raw disk images but rejects structured custom images', async () => {
		const {machines, filesRoot} = await createMachines()
		const imports = nodePath.join(filesRoot, 'External', 'imports')
		await fse.ensureDir(imports)

		for (const extension of ['iso', 'img']) {
			const imagePath = `/External/imports/source.${extension}`
			await fsp.writeFile(nodePath.join(imports, `source.${extension}`), extension)
			const machine = await machines.create({
				name: `Imported ${extension}`,
				imagePath,
				diskSizeGb: 1,
				cores: 1,
				memoryGb: 1,
			})
			await pWaitFor(async () =>
				(await machines.list()).some(({id, state}) => id === machine.id && state === 'running'),
			)
			expect((await machines.list()).find(({id}) => id === machine.id)).toMatchObject({
				installationMediaAttached: extension === 'iso',
				installationState: extension === 'iso' ? 'ready-for-setup' : undefined,
			})
		}

		for (const extension of ['qcow2', 'vmdk', 'vdi', 'vhdx', 'vhd', 'ova']) {
			await expect(
				machines.create({
					name: `Rejected ${extension}`,
					imagePath: `/External/imports/source.${extension}`,
					diskSizeGb: 1,
					cores: 1,
					memoryGb: 1,
				}),
			).rejects.toThrow('[machine-image-invalid]')
		}
	})

	test('ejects custom ISO media from a running machine and persists the change', async () => {
		const {machines, filesRoot, root} = await createMachines()
		const imports = nodePath.join(filesRoot, 'External', 'imports')
		await fse.ensureDir(imports)
		await fsp.writeFile(nodePath.join(imports, 'installer.iso'), 'installer')
		const machine = await machines.create({
			name: 'ISO install',
			imagePath: '/External/imports/installer.iso',
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
		})
		await pWaitFor(async () => (await machines.list()).some(({id, state}) => id === machine.id && state === 'running'))
		const mediaPath = nodePath.join(root, 'machines', machine.id, 'media', 'install.iso')
		await expect(fse.pathExists(mediaPath)).resolves.toBe(true)

		await expect(machines.ejectInstallMedia(machine.id)).resolves.toBe(true)

		expect(libvirtControls.ejectCalls).toEqual([machine.id])
		expect((await machines.list()).find(({id}) => id === machine.id)).toMatchObject({
			installationMediaAttached: false,
			installationState: undefined,
		})
		await expect(fse.pathExists(mediaPath)).resolves.toBe(false)
		await expect(machines.ejectInstallMedia(machine.id)).resolves.toBe(true)
		expect(libvirtControls.ejectCalls).toEqual([machine.id])
	})

	test('keeps custom ISO media when live detachment fails', async () => {
		const {machines, filesRoot, root} = await createMachines()
		const imports = nodePath.join(filesRoot, 'External', 'imports')
		await fse.ensureDir(imports)
		await fsp.writeFile(nodePath.join(imports, 'busy.iso'), 'installer')
		const machine = await machines.create({
			name: 'Busy ISO',
			imagePath: '/External/imports/busy.iso',
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
		})
		await pWaitFor(async () => (await machines.list()).some(({id, state}) => id === machine.id && state === 'running'))
		libvirtControls.ejectFailures.add(machine.id)

		await expect(machines.ejectInstallMedia(machine.id)).rejects.toThrow('[machine-install-media-eject-failed]')

		expect((await machines.list()).find(({id}) => id === machine.id)).toMatchObject({
			installationMediaAttached: true,
		})
		await expect(fse.pathExists(nodePath.join(root, 'machines', machine.id, 'media', 'install.iso'))).resolves.toBe(
			true,
		)
	})

	test('serializes concurrent starts for the same machine', async () => {
		const {machines, filesRoot} = await createMachines()
		const imports = nodePath.join(filesRoot, 'External', 'imports')
		await fse.ensureDir(imports)
		await fsp.writeFile(nodePath.join(imports, 'source.img'), 'source')
		const machine = await machines.create({
			name: 'Serialized lifecycle',
			imagePath: '/External/imports/source.img',
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
		})
		await pWaitFor(async () => (await machines.list()).some(({id, state}) => id === machine.id && state === 'running'))
		await machines.stopMachine(machine.id)

		const startsBeforeRace = libvirtControls.startCalls.length
		let releaseStart!: () => void
		libvirtControls.startBarrier = new Promise<void>((resolve) => (releaseStart = resolve))
		const first = machines.startMachine(machine.id)
		await pWaitFor(() => libvirtControls.startCalls.length === startsBeforeRace + 1)
		const second = machines.startMachine(machine.id)
		await new Promise((resolve) => setImmediate(resolve))
		expect(libvirtControls.startCalls).toHaveLength(startsBeforeRace + 1)

		releaseStart()
		await expect(first).resolves.toBe(true)
		await expect(second).rejects.toThrow('[machine-not-stopped]')
		expect(libvirtControls.startCalls).toHaveLength(startsBeforeRace + 1)
	})

	test('destroys a power-management-suspended domain before starting it again', async () => {
		const {machines, filesRoot} = await createMachines()
		const imports = nodePath.join(filesRoot, 'External', 'imports')
		await fse.ensureDir(imports)
		await fsp.writeFile(nodePath.join(imports, 'source.img'), 'source')
		const machine = await machines.create({
			name: 'Suspended lifecycle',
			imagePath: '/External/imports/source.img',
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
		})
		await pWaitFor(async () => (await machines.list()).some(({id, state}) => id === machine.id && state === 'running'))
		libvirtControls.suspendedIds.add(machine.id)
		expect((await machines.list()).find(({id}) => id === machine.id)?.state).toBe('suspended')
		const startsBefore = libvirtControls.startCalls.length
		const stopsBefore = libvirtControls.stopCalls.length

		await expect(machines.startMachine(machine.id)).resolves.toBe(true)

		expect(libvirtControls.stopCalls.slice(stopsBefore)).toEqual([{id: machine.id, force: true}])
		expect(libvirtControls.startCalls).toHaveLength(startsBefore + 1)
		expect((await machines.list()).find(({id}) => id === machine.id)?.state).toBe('running')
	})

	test('force-stops a power-management-suspended domain', async () => {
		const {machines, filesRoot} = await createMachines()
		const imports = nodePath.join(filesRoot, 'External', 'imports')
		await fse.ensureDir(imports)
		await fsp.writeFile(nodePath.join(imports, 'source.img'), 'source')
		const machine = await machines.create({
			name: 'Suspended force stop',
			imagePath: '/External/imports/source.img',
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
		})
		await pWaitFor(async () => (await machines.list()).some(({id, state}) => id === machine.id && state === 'running'))
		libvirtControls.suspendedIds.add(machine.id)
		expect((await machines.list()).find(({id}) => id === machine.id)?.state).toBe('suspended')
		const stopsBefore = libvirtControls.stopCalls.length

		await expect(machines.forceStopMachine(machine.id)).resolves.toBe(true)

		expect(libvirtControls.stopCalls.slice(stopsBefore)).toEqual([{id: machine.id, force: true}])
		expect((await machines.list()).find(({id}) => id === machine.id)?.state).toBe('stopped')
	})

	test('remembers explicit lifecycle state for autostart', async () => {
		const {machines, filesRoot} = await createMachines()
		const imports = nodePath.join(filesRoot, 'External', 'imports')
		await fse.ensureDir(imports)
		await fsp.writeFile(nodePath.join(imports, 'source.img'), 'source')
		const machine = await machines.create({
			name: 'Remembered lifecycle',
			imagePath: '/External/imports/source.img',
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
		})
		await pWaitFor(async () => (await machines.list()).some(({id, state}) => id === machine.id && state === 'running'))

		expect((await machines.list()).find(({id}) => id === machine.id)?.autostart).toBe(true)
		await machines.updateSettings(machine.id, {autostart: false})
		await machines.restartMachine(machine.id)
		expect((await machines.list()).find(({id}) => id === machine.id)?.autostart).toBe(true)

		await machines.stopMachine(machine.id)
		expect((await machines.list()).find(({id}) => id === machine.id)?.autostart).toBe(false)

		await machines.startMachine(machine.id)
		expect((await machines.list()).find(({id}) => id === machine.id)?.autostart).toBe(true)

		await machines.forceStopMachine(machine.id)
		expect((await machines.list()).find(({id}) => id === machine.id)?.autostart).toBe(false)
	})

	test('serializes uninstall behind an in-flight start', async () => {
		const {machines, filesRoot} = await createMachines()
		const imports = nodePath.join(filesRoot, 'External', 'imports')
		await fse.ensureDir(imports)
		await fsp.writeFile(nodePath.join(imports, 'source.img'), 'source')
		const machine = await machines.create({
			name: 'Start uninstall race',
			imagePath: '/External/imports/source.img',
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
		})
		await pWaitFor(async () => (await machines.list()).some(({id, state}) => id === machine.id && state === 'running'))
		await machines.stopMachine(machine.id)

		let releaseStart!: () => void
		libvirtControls.startBarrier = new Promise<void>((resolve) => (releaseStart = resolve))
		const startsBeforeRace = libvirtControls.startCalls.length
		const start = machines.startMachine(machine.id)
		await pWaitFor(() => libvirtControls.startCalls.length === startsBeforeRace + 1)
		const uninstall = machines.uninstall(machine.id)
		releaseStart()

		await expect(start).resolves.toBe(true)
		await expect(uninstall).resolves.toBe(true)
		await expect(machines.list()).resolves.toEqual([])
	})

	test('preserves machine data when libvirt state cannot be determined during uninstall', async () => {
		const {machines, root, filesRoot} = await createMachines()
		const imports = nodePath.join(filesRoot, 'External', 'imports')
		await fse.ensureDir(imports)
		await fsp.writeFile(nodePath.join(imports, 'source.img'), 'source')
		const machine = await machines.create({
			name: 'Unknown runtime state',
			imagePath: '/External/imports/source.img',
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
		})
		await pWaitFor(async () => (await machines.list()).some(({id, state}) => id === machine.id && state === 'running'))
		libvirtControls.stateFailures.add(machine.id)

		await expect(machines.uninstall(machine.id)).rejects.toThrow('[machine-state-unavailable]')
		await expect(fse.pathExists(nodePath.join(root, 'machines', machine.id, 'machine.yaml'))).resolves.toBe(true)

		libvirtControls.stateFailures.delete(machine.id)
	})

	test('serializes backup preparation with an in-flight start', async () => {
		const {machines, root, filesRoot} = await createMachines()
		const imports = nodePath.join(filesRoot, 'External', 'imports')
		await fse.ensureDir(imports)
		await fsp.writeFile(nodePath.join(imports, 'source.img'), 'source')
		const machine = await machines.create({
			name: 'Backup start race',
			imagePath: '/External/imports/source.img',
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
		})
		await pWaitFor(async () => (await machines.list()).some(({id, state}) => id === machine.id && state === 'running'))
		await machines.stopMachine(machine.id)

		let releaseStart!: () => void
		libvirtControls.startBarrier = new Promise<void>((resolve) => (releaseStart = resolve))
		const startsBeforeRace = libvirtControls.startCalls.length
		const start = machines.startMachine(machine.id)
		await pWaitFor(() => libvirtControls.startCalls.length === startsBeforeRace + 1)
		const prepare = machines.prepareBackup()
		releaseStart()

		await expect(start).resolves.toBe(true)
		await expect(prepare).resolves.toBe(true)
		await expect(
			fse.pathExists(nodePath.join(root, 'machines', machine.id, 'operations', 'backup.yaml')),
		).resolves.toBe(true)
		await machines.releaseBackup()
	})

	test('continues releasing other machine snapshots when one commit fails', async () => {
		const {machines, root, filesRoot} = await createMachines()
		const imports = nodePath.join(filesRoot, 'External', 'imports')
		await fse.ensureDir(imports)
		await fsp.writeFile(nodePath.join(imports, 'source.img'), 'source')
		const created = await Promise.all(
			['First backup', 'Second backup'].map((name) =>
				machines.create({
					name,
					imagePath: '/External/imports/source.img',
					diskSizeGb: 1,
					cores: 1,
					memoryGb: 1,
				}),
			),
		)
		await pWaitFor(async () => (await machines.list()).every(({state}) => state === 'running'))
		await machines.prepareBackup()

		libvirtControls.backupCommitFailures.add(created[0].id)
		await expect(machines.releaseBackup()).rejects.toThrow('[machine-backup-release-failed]')
		const journal = (id: string) => nodePath.join(root, 'machines', id, 'operations', 'backup.yaml')
		await expect(fse.pathExists(journal(created[0].id))).resolves.toBe(true)
		await expect(fse.pathExists(journal(created[1].id))).resolves.toBe(false)
		await expect(machines.stopMachine(created[0].id)).rejects.toThrow('[machine-backup-in-progress]')
		const failedJournal = await fsp.readFile(journal(created[0].id), 'utf8')
		const failedOverlay = (yaml.load(failedJournal) as {overlay: string}).overlay
		expect(failedOverlay).toBeTruthy()
		await expect(fse.pathExists(failedOverlay!)).resolves.toBe(true)

		// A new backup first retries the unresolved transaction. If recovery still
		// fails, it must leave the original journal and live overlay untouched.
		await expect(machines.prepareBackup()).rejects.toThrow('[machine-backup-recovery-failed]')
		await expect(fsp.readFile(journal(created[0].id), 'utf8')).resolves.toBe(failedJournal)
		await expect(fse.pathExists(failedOverlay!)).resolves.toBe(true)

		libvirtControls.backupCommitFailures.clear()
		await expect(machines.prepareBackup()).resolves.toBe(true)
		const retryJournal = await fsp.readFile(journal(created[0].id), 'utf8')
		const retryOverlay = (yaml.load(retryJournal) as {overlay: string}).overlay
		expect(retryOverlay).toBeTruthy()
		expect(retryOverlay).not.toBe(failedOverlay)
		await expect(fse.pathExists(failedOverlay!)).resolves.toBe(false)
		await machines.releaseBackup()
	})

	test('stores only a custom disk on external storage and reports it unavailable when detached', async () => {
		const {machines, root, filesRoot} = await createMachines()
		const imports = nodePath.join(filesRoot, 'External', 'imports')
		const externalMachines = nodePath.join(filesRoot, 'External', 'machines')
		await Promise.all([fse.ensureDir(imports), fse.ensureDir(externalMachines)])
		await fsp.writeFile(nodePath.join(imports, 'source.img'), 'source')

		const created = await machines.create({
			name: 'External disk',
			imagePath: '/External/imports/source.img',
			diskDirectory: '/External/machines',
			firmware: 'bios',
			diskBus: 'sata',
			arch: 'amd64',
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
		})
		await pWaitFor(async () => (await machines.list()).some(({id, state}) => id === created.id && state === 'running'))

		const externalDisk = nodePath.join(externalMachines, `${created.id}.qcow2`)
		const machineDirectory = nodePath.join(root, 'machines', created.id)
		expect((await machines.list()).find(({id}) => id === created.id)).toMatchObject({
			diskPath: `/External/machines/${created.id}.qcow2`,
			firmware: 'bios',
			diskBus: 'sata',
		})
		await expect(fse.pathExists(externalDisk)).resolves.toBe(true)
		await expect(fse.pathExists(nodePath.join(machineDirectory, 'disk.qcow2'))).resolves.toBe(false)
		const definition = await fsp.readFile(nodePath.join(machineDirectory, 'machine.yaml'), 'utf8')
		expect(definition).toContain(`diskPath: /External/machines/${created.id}.qcow2`)
		await expect(machines.blockStoragePaths(['/External/machines'])).rejects.toThrow('[machine-external-disk-in-use]')

		await machines.prepareBackup()
		await expect(fse.pathExists(nodePath.join(machineDirectory, 'operations', 'backup.yaml'))).resolves.toBe(false)
		await machines.releaseBackup()

		await machines.stopMachine(created.id)
		await fse.remove(externalDisk)
		expect((await machines.list()).find(({id}) => id === created.id)).toMatchObject({
			state: 'error',
			errorMessage: '[machine-external-disk-unavailable]',
			storageUsedGb: 0,
		})
		await expect(machines.storageResourceUsage()).resolves.toEqual([expect.objectContaining({id: created.id, used: 0})])
		await expect(machines.startMachine(created.id)).rejects.toThrow('[machine-external-disk-unavailable]')
	})

	test.skipIf(process.arch === 'arm64')(
		'requires an XP key for creation without persisting or returning it',
		async () => {
			const {machines, root} = await createMachines()
			const input = {
				name: 'Windows XP',
				osId: 'windows-xp-professional-amd64',
				username: 'umbrel',
				password: 'password',
				diskSizeGb: 1,
				cores: 1,
				memoryGb: 1,
				arch: 'amd64' as const,
			}

			await expect(machines.create(input)).rejects.toThrow('[machine-windows-license-key-required]')
			const licenseKey = 'TEST1-TEST2-TEST3-TEST4-TEST5'
			const created = await machines.create({...input, licenseKey})
			await pWaitFor(() => downloadControls.length === 1)
			await downloadControls[0].resolve()
			await pWaitFor(async () =>
				(await machines.list()).some(({id, state}) => id === created.id && state === 'running'),
			)

			expect(preparedWindowsOptions).toEqual([expect.objectContaining({licenseKey})])
			const machineDirectory = nodePath.join(root, 'machines', created.id)
			const definition = await fsp.readFile(nodePath.join(machineDirectory, 'machine.yaml'), 'utf8')
			expect(definition).not.toContain(licenseKey)
			expect(JSON.stringify(await machines.list())).not.toContain(licenseKey)
			expect(await fsp.readFile(nodePath.join(machineDirectory, 'media', 'install.iso'), 'utf8')).toContain(licenseKey)
		},
	)
})

test('an agent at the console is announced with its pointer, kept alive by looking, and released when quiet', async () => {
	process.env.UMBREL_MACHINE_AGENT_CONTROL_TIMEOUT_MS = '2500'
	try {
		const {machines, filesRoot, eventBus} = await createMachines()
		displayControls.socketPath = nodePath.join(filesRoot, 'display.sock')
		await fsp.writeFile(displayControls.socketPath, '')
		displayControls.pointerEvents.length = 0
		const imports = nodePath.join(filesRoot, 'External', 'imports')
		await fse.ensureDir(imports)
		await fsp.writeFile(nodePath.join(imports, 'installer.iso'), 'installer')
		const machine = await machines.create({
			name: 'Agent driven',
			imagePath: '/External/imports/installer.iso',
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
		})
		await pWaitFor(async () => (await machines.list()).some(({id, state}) => id === machine.id && state === 'running'))
		const agent = {tokenId: 'a'.repeat(32), label: 'Claude Code', agentType: 'claude-code'}
		const controlEvents = () =>
			eventBus.emit.mock.calls.filter(([event]) => event === 'machines:agent-control').map(([, payload]) => payload)

		// A person's screenshot never claims the console, an agent's action does
		await machines.screenshot(machine.id)
		expect(machines.agentControls()).toStrictEqual({})
		await machines.control(machine.id, {action: 'left_click', coordinate: [640, 400]}, {agent})
		expect(machines.agentControls()[machine.id]).toMatchObject({
			agent,
			pointer: {x: 640, y: 400, width: 1280, height: 800},
		})
		expect(controlEvents().at(-1)).toMatchObject({machineId: machine.id, control: {agent, pointer: {x: 640, y: 400}}})

		// The next pointer action travels from where the last one ended
		displayControls.pointerEvents.length = 0
		await machines.control(machine.id, {action: 'mouse_move', coordinate: [680, 400]}, {agent})
		expect(displayControls.pointerEvents.length).toBeGreaterThan(1)
		expect(displayControls.pointerEvents.at(-1)).toStrictEqual([680, 400, 0])

		// Looking keeps the turn alive without moving the pointer: the last input
		// was over 2.5 s ago by the time this check runs, so only the screenshot
		// can explain the turn still being active
		await new Promise((resolve) => setTimeout(resolve, 1_000))
		await machines.screenshot(machine.id, {agent})
		await new Promise((resolve) => setTimeout(resolve, 1_600))
		expect(machines.agentControls()[machine.id]).toMatchObject({pointer: {x: 680, y: 400}})

		// Silence hands the console back, but the pointer is still where it was
		// left: the next action travels from there rather than starting over
		await pWaitFor(() => !(machine.id in machines.agentControls()), {interval: 50, timeout: 5_000})
		expect(controlEvents().at(-1)).toStrictEqual({machineId: machine.id, control: null})
		displayControls.pointerEvents.length = 0
		await machines.control(machine.id, {action: 'mouse_move', coordinate: [520, 400]}, {agent})
		expect(displayControls.pointerEvents.length).toBeGreaterThan(1)
		expect(displayControls.pointerEvents.at(-1)).toStrictEqual([520, 400, 0])

		// Stopping the machine is what forgets it
		await machines.stopMachine(machine.id)
		await machines.startMachine(machine.id)
		displayControls.pointerEvents.length = 0
		await machines.control(machine.id, {action: 'mouse_move', coordinate: [100, 100]}, {agent})
		expect(displayControls.pointerEvents).toStrictEqual([[100, 100, 0]])
	} finally {
		delete process.env.UMBREL_MACHINE_AGENT_CONTROL_TIMEOUT_MS
	}
}, 20_000)

test('agent input is serialized per machine, retains a held action, and snapshots do not replay it', async () => {
	process.env.UMBREL_MACHINE_AGENT_CONTROL_TIMEOUT_MS = '100'
	try {
		const {machines, filesRoot, eventBus} = await createMachines()
		displayControls.socketPath = nodePath.join(filesRoot, 'display.sock')
		await fsp.writeFile(displayControls.socketPath, '')
		await fse.ensureDir(nodePath.join(filesRoot, 'External', 'imports'))
		await fsp.writeFile(nodePath.join(filesRoot, 'External', 'imports', 'installer.iso'), 'installer')
		const machine = await machines.create({
			name: 'Input ordering',
			imagePath: '/External/imports/installer.iso',
			diskSizeGb: 1,
			cores: 1,
			memoryGb: 1,
		})
		await pWaitFor(async () => (await machines.list()).some(({id, state}) => id === machine.id && state === 'running'))
		const agent = {tokenId: 'a'.repeat(32), label: 'Claude Code'}
		const other = {tokenId: 'b'.repeat(32), label: 'Codex'}
		const first = machines.control(machine.id, {action: 'long_press', coordinate: [200, 300], duration: 0.4}, {agent})
		await pWaitFor(() => machines.agentControls()[machine.id]?.feedback?.phase === 'pressed', {
			interval: 10,
			timeout: 1_000,
		})
		const second = machines.control(machine.id, {action: 'left_click', coordinate: [700, 300]}, {agent: other})
		const held = machines.agentControls()[machine.id]
		await new Promise((resolve) => setTimeout(resolve, 200))
		const snapshot = machines.agentControls()[machine.id]
		expect(snapshot.agent).toEqual(agent)
		expect(snapshot.sequence).toBe(held.sequence)
		expect(snapshot.observedAt).toBeGreaterThan(held.observedAt)
		expect(snapshot.feedback).toEqual(held.feedback)
		// Another agent looking does not take over the identity of the operator.
		await machines.screenshot(machine.id, {agent: other})
		expect(machines.agentControls()[machine.id].agent).toEqual(agent)
		await Promise.all([first, second])
		const events = eventBus.emit.mock.calls.filter(
			([event, payload]) => event === 'machines:agent-control' && payload.control?.feedback,
		)
		const phases = events.map(([, {control}]) => ({
			sequence: control.sequence,
			agent: control.agent.label,
			phase: control.feedback.phase,
		}))
		const unique = phases.filter((event, index) => index === 0 || event.sequence !== phases[index - 1].sequence)
		expect(phases).toEqual(unique) // No extra broadcasts for ownership heartbeats.
		expect(unique.map(({agent, phase}) => `${agent}:${phase}`)).toEqual([
			'Claude Code:moving',
			'Claude Code:pressed',
			'Claude Code:released',
			'Codex:moving',
			'Codex:pressed',
			'Codex:released',
		])
		for (let i = 1; i < unique.length; i++) expect(unique[i].sequence).toBeGreaterThan(unique[i - 1].sequence)
		displayControls.failNextPointer = true
		await expect(
			machines.control(machine.id, {action: 'mouse_move', coordinate: [900, 500]}, {agent: other}),
		).rejects.toThrow('display interrupted')
		expect(machines.agentControls()[machine.id]).toMatchObject({
			feedback: {action: 'mouse_move', phase: 'complete'},
			pointer: {x: 700, y: 300},
		})
		expect(machines.agentControls()[machine.id].pointer?.motion).toBeUndefined()
	} finally {
		delete process.env.UMBREL_MACHINE_AGENT_CONTROL_TIMEOUT_MS
	}
})
