import * as execa from 'execa'
import fse from 'fs-extra'
import {afterEach, describe, expect, test, vi} from 'vitest'

import {
	applyGpuAccelerationToService,
	getGpuAcceleration,
	getGpuInfo,
	parsePciGraphicsControllers,
	removeGpuAccelerationFromService,
	removeLegacyDriDeviceMappingsFromService,
	type ComposeService,
	type GpuAcceleration,
} from './gpu.ts'

vi.mock('execa')
vi.mock('fs-extra')

afterEach(() => {
	vi.resetAllMocks()
})

function mockHost({
	nvidiaRuntime = false,
	nvidiaGpus = '',
	kfd = false,
	dri = false,
}: {
	nvidiaRuntime?: boolean
	nvidiaGpus?: string
	kfd?: boolean
	dri?: boolean
}) {
	vi.mocked(execa.execa).mockImplementation((async (command: string) => {
		if (command === 'docker') {
			return {stdout: JSON.stringify(nvidiaRuntime ? {nvidia: {path: 'nvidia-container-runtime'}} : {})}
		}
		if (command === 'nvidia-smi') {
			if (!nvidiaGpus) throw new Error('No NVIDIA GPU')
			return {stdout: nvidiaGpus}
		}
		throw new Error(`Unexpected command: ${command}`)
	}) as typeof execa.execa)
	vi.mocked(fse.pathExists).mockImplementation((async (path: string) => {
		if (path === '/dev/kfd') return kfd
		if (path === '/dev/dri') return dri
		return false
	}) as typeof fse.pathExists)
	vi.mocked(fse.readdir).mockImplementation((async (path: string) => {
		if (path === '/dev/dri' && dri) return ['card0', 'renderD128']
		throw new Error('ENOENT')
	}) as typeof fse.readdir)
	vi.mocked(fse.stat).mockImplementation((async (path: string) => {
		if (path === '/dev/kfd' && kfd) return {gid: 993}
		if (path === '/dev/dri/card0' && dri) return {gid: 44}
		if (path === '/dev/dri/renderD128' && dri) return {gid: 990}
		throw new Error('ENOENT')
	}) as typeof fse.stat)
}

describe('getGpuAcceleration', () => {
	test('detects Vulkan, ROCm, and NVIDIA support simultaneously', async () => {
		mockHost({
			nvidiaRuntime: true,
			nvidiaGpus: 'GPU 0: NVIDIA GeForce RTX 3060',
			kfd: true,
			dri: true,
		})

		await expect(getGpuAcceleration()).resolves.toStrictEqual({
			dri: true,
			rocm: true,
			nvidia: true,
			deviceGroupIds: [44, 990, 993],
		})
	})

	test('initializes lazily-created NVIDIA device nodes while probing an eGPU', async () => {
		mockHost({nvidiaRuntime: true, nvidiaGpus: 'GPU 0: NVIDIA GeForce RTX 3060'})

		expect((await getGpuAcceleration()).nvidia).toBe(true)
		expect(execa.execa).toHaveBeenCalledWith('docker', ['info', '--format', '{{json .Runtimes}}'], {timeout: 5_000})
		expect(execa.execa).toHaveBeenCalledWith('nvidia-smi', ['--list-gpus'], {timeout: 15_000})
		expect(fse.pathExists).not.toHaveBeenCalledWith('/dev/nvidiactl')
	})

	test('preserves existing Intel DRI acceleration without optional runtimes', async () => {
		mockHost({dri: true})
		await expect(getGpuAcceleration()).resolves.toStrictEqual({
			dri: true,
			rocm: false,
			nvidia: false,
			deviceGroupIds: [44, 990],
		})
	})

	test('does not advertise NVIDIA when the runtime is configured but the GPU is unavailable', async () => {
		mockHost({nvidiaRuntime: true, dri: true})
		expect((await getGpuAcceleration()).nvidia).toBe(false)
	})

	test('does not advertise NVIDIA when the GPU exists but the runtime is unavailable', async () => {
		mockHost({nvidiaGpus: 'GPU 0: NVIDIA GeForce RTX 3060', dri: true})
		expect((await getGpuAcceleration()).nvidia).toBe(false)
	})

	test('reports no acceleration on systems without GPU devices', async () => {
		mockHost({})
		await expect(getGpuAcceleration()).resolves.toStrictEqual({
			dri: false,
			rocm: false,
			nvidia: false,
			deviceGroupIds: [],
		})
	})

	test('coalesces concurrent probes while apps start together', async () => {
		mockHost({nvidiaRuntime: true, nvidiaGpus: 'GPU 0: NVIDIA GeForce RTX 3060', dri: true})
		await Promise.all([getGpuAcceleration(), getGpuAcceleration(), getGpuAcceleration()])
		expect(execa.execa).toHaveBeenCalledTimes(2)
	})
})

describe('parsePciGraphicsControllers', () => {
	test('includes VGA, 3D, and other display controllers', () => {
		const output = [
			'0000:63:00.0 "VGA compatible controller [0300]" "NVIDIA Corporation [10de]" "GA104 [GeForce RTX 3060] [2487]"',
			'0000:c7:00.0 "Display controller [0380]" "Advanced Micro Devices, Inc. [AMD/ATI] [1002]" "Strix Halo [Radeon Graphics / Radeon 8060S Graphics] [1586]"',
			'0000:03:00.0 "3D controller [0302]" "Intel Corporation [8086]" "Arc Graphics [56a0]"',
		].join('\n')

		expect(parsePciGraphicsControllers(output)).toStrictEqual([
			{vendor: 'NVIDIA Corporation', model: 'GA104 [GeForce RTX 3060]'},
			{
				vendor: 'Advanced Micro Devices, Inc. [AMD/ATI]',
				model: 'Strix Halo [Radeon Graphics / Radeon 8060S Graphics]',
			},
			{vendor: 'Intel Corporation', model: 'Arc Graphics'},
		])
	})

	test('ignores malformed and non-display entries', () => {
		const output = [
			'0000:63:00.1 "Audio device [0403]" "NVIDIA Corporation [10de]" "GA104 Audio [228b]"',
			'not lspci output',
		].join('\n')
		expect(parsePciGraphicsControllers(output)).toStrictEqual([])
	})
})

describe('getGpuInfo', () => {
	test('reports graphics controllers without inferring backend support', async () => {
		vi.mocked(execa.execa).mockImplementation((async (command: string) => {
			if (command !== 'lspci') throw new Error(`Unexpected command: ${command}`)
			return {
				stdout:
					'0000:c7:00.0 "Display controller [0380]" "Advanced Micro Devices, Inc. [AMD/ATI] [1002]" "Strix Halo [Radeon Graphics / Radeon 8060S Graphics] [1586]"',
			}
		}) as typeof execa.execa)

		await expect(getGpuInfo()).resolves.toStrictEqual({
			gpus: [
				{
					vendor: 'Advanced Micro Devices, Inc. [AMD/ATI]',
					model: 'Strix Halo [Radeon Graphics / Radeon 8060S Graphics]',
				},
			],
		})
		expect(execa.execa).toHaveBeenCalledOnce()
		expect(execa.execa).toHaveBeenCalledWith('lspci', ['-D', '-mm', '-nn', '-d', '::03xx'])
	})
})

describe('applyGpuAccelerationToService', () => {
	const mixedAcceleration: GpuAcceleration = {
		dri: true,
		rocm: true,
		nvidia: true,
		deviceGroupIds: [44, 990, 993],
	}

	test('adds every mixed-vendor acceleration path to one service', () => {
		const service: ComposeService = {}
		applyGpuAccelerationToService(service, mixedAcceleration)

		expect(service.devices).toStrictEqual(['/dev/dri', '/dev/kfd'])
		expect(service.group_add).toStrictEqual([44, 990, 993])
		expect(service.deploy?.resources?.reservations?.devices).toStrictEqual([
			{driver: 'nvidia', count: 'all', capabilities: ['gpu']},
		])
		expect(service.environment).toStrictEqual({
			NVIDIA_VISIBLE_DEVICES: 'all',
			NVIDIA_DRIVER_CAPABILITIES: 'all',
		})
	})

	test('keeps the existing Intel DRI compose contract', () => {
		const service: ComposeService = {}
		applyGpuAccelerationToService(service, {dri: true, rocm: false, nvidia: false, deviceGroupIds: [44, 990]})
		expect(service.devices).toStrictEqual(['/dev/dri'])
		expect(service.group_add).toStrictEqual([44, 990])
	})

	test('preserves app-defined devices, groups, deployment settings, and environment', () => {
		const service: ComposeService = {
			devices: ['/dev/ttyUSB0', '/dev/dri:/dev/dri'],
			group_add: ['dialout', '44'],
			deploy: {resources: {limits: {memory: '1g'}}},
			environment: {NVIDIA_VISIBLE_DEVICES: '0', APP_SETTING: 'value'},
		}

		applyGpuAccelerationToService(service, mixedAcceleration)

		expect(service.devices).toStrictEqual(['/dev/ttyUSB0', '/dev/dri:/dev/dri', '/dev/kfd'])
		expect(service.group_add).toStrictEqual(['dialout', '44', 990, 993])
		expect(service.deploy?.resources?.limits).toStrictEqual({memory: '1g'})
		expect(service.environment).toMatchObject({
			NVIDIA_VISIBLE_DEVICES: '0',
			NVIDIA_DRIVER_CAPABILITIES: 'all',
			APP_SETTING: 'value',
		})
	})

	test('supports list-form environment without replacing app values', () => {
		const service: ComposeService = {environment: ['NVIDIA_DRIVER_CAPABILITIES=compute,utility', 'APP_SETTING=value']}
		applyGpuAccelerationToService(service, mixedAcceleration)
		expect(service.environment).toStrictEqual([
			'NVIDIA_DRIVER_CAPABILITIES=compute,utility',
			'APP_SETTING=value',
			'NVIDIA_VISIBLE_DEVICES=all',
		])
	})

	test('does not duplicate framework settings when compose is patched repeatedly', () => {
		const service: ComposeService = {}
		applyGpuAccelerationToService(service, mixedAcceleration)
		applyGpuAccelerationToService(service, mixedAcceleration)

		expect(service.devices).toStrictEqual(['/dev/dri', '/dev/kfd'])
		expect(service.group_add).toStrictEqual([44, 990, 993])
		expect(service.deploy?.resources?.reservations?.devices).toHaveLength(1)
		expect(service.environment).toStrictEqual({
			NVIDIA_VISIBLE_DEVICES: 'all',
			NVIDIA_DRIVER_CAPABILITIES: 'all',
		})
	})

	test('removes framework settings before applying a changed hardware inventory', () => {
		const service: ComposeService = {}
		const applied = applyGpuAccelerationToService(service, mixedAcceleration)

		removeGpuAccelerationFromService(service, applied)
		applyGpuAccelerationToService(service, {
			dri: true,
			rocm: false,
			nvidia: false,
			deviceGroupIds: [44, 990],
		})

		expect(service).toStrictEqual({devices: ['/dev/dri'], group_add: [44, 990]})
	})

	test('does not remove equivalent GPU settings supplied by the app', () => {
		const service: ComposeService = {
			devices: ['/dev/dri', '/dev/ttyUSB0'],
			group_add: [44, 'dialout'],
			deploy: {
				resources: {
					limits: {memory: '1g'},
					reservations: {devices: [{driver: 'nvidia', count: 'all', capabilities: ['gpu']}]},
				},
			},
			environment: {NVIDIA_VISIBLE_DEVICES: 'all', APP_SETTING: 'value'},
		}
		const applied = applyGpuAccelerationToService(service, mixedAcceleration)

		removeGpuAccelerationFromService(service, applied)

		expect(service).toStrictEqual({
			devices: ['/dev/dri', '/dev/ttyUSB0'],
			group_add: [44, 'dialout'],
			deploy: {
				resources: {
					limits: {memory: '1g'},
					reservations: {devices: [{driver: 'nvidia', count: 'all', capabilities: ['gpu']}]},
				},
			},
			environment: {NVIDIA_VISIBLE_DEVICES: 'all', APP_SETTING: 'value'},
		})
	})

	test('leaves services unchanged when the host has no acceleration devices', () => {
		const service: ComposeService = {image: 'example/image'}
		applyGpuAccelerationToService(service, {dri: false, rocm: false, nvidia: false, deviceGroupIds: []})
		expect(service).toStrictEqual({image: 'example/image'})
	})
})

describe('removeLegacyDriDeviceMappingsFromService', () => {
	test('removes untracked legacy DRI mappings while preserving other devices', () => {
		const service: ComposeService = {
			devices: ['/dev/dri', '/dev/dri:/dev/dri', '/dev/ttyUSB0'],
		}

		removeLegacyDriDeviceMappingsFromService(service)

		expect(service.devices).toStrictEqual(['/dev/ttyUSB0'])
	})

	test('removes the devices property when it contained only legacy DRI mappings', () => {
		const service: ComposeService = {devices: ['/dev/dri']}

		removeLegacyDriDeviceMappingsFromService(service)

		expect(service).toStrictEqual({})
	})
})
