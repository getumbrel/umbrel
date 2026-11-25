import path from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'

import {execa} from 'execa'
import fse from 'fs-extra'

const DRM_CLASS_PATH = '/sys/class/drm'
const DRM_DEBUG_PATH = '/sys/kernel/debug/dri'
const DRM_SAMPLE_INTERVAL_MS = 250
const COMMAND_TIMEOUT_MS = 3_000

type MemoryUsage = {
	total: number | null
	used: number
}

export type GpuProcessUsage = {
	pids: number[]
	used: number | null
	dedicatedMemoryUsed: number
	sharedMemoryUsed: number
}

export type GpuDeviceUsage = {
	id: string
	vendor: string
	model: string
	totalUsed: number | null
	dedicatedMemory: MemoryUsage | null
	sharedMemory: Omit<MemoryUsage, 'total'> | null
	processes: GpuProcessUsage[]
}

type PciController = {
	id: string
	vendor: string
	model: string
}

type DrmEngineSample = {
	busy: number
	capacity: number
}

type DrmCycleSample = DrmEngineSample & {
	total: number
}

export type DrmClientSample = {
	key: string
	deviceId: string
	pids: number[]
	engines: Record<string, DrmEngineSample>
	cycles: Record<string, DrmCycleSample>
	dedicatedMemoryUsed: number
	sharedMemoryUsed: number
}

type DrmDevice = Omit<GpuDeviceUsage, 'totalUsed' | 'processes'> & {
	// Kept internal to this module: the bound kernel driver decides whether an
	// idle device reports 0% or nothing at all (see driverHasIdleUtilization).
	driver: string
	sysfsTotalUsed: number | null
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0))
const clampBytes = (value: number) => Math.max(0, Number.isFinite(value) ? Math.round(value) : 0)

export function normalizePciAddress(value: string): string {
	const match = value
		.trim()
		.toLowerCase()
		.match(/(?:[0-9a-f]{8}:)?([0-9a-f]{4}:[0-9a-f]{2}:[0-9a-f]{2}\.[0-7])$/)
	return match?.[1] ?? value.trim().toLowerCase()
}

const stripPciId = (value: string) => value.replace(/\s+\[[0-9a-f]{4}\]$/i, '')

export function parsePciControllers(output: string): PciController[] {
	return output.split('\n').flatMap((line) => {
		const id = normalizePciAddress(line.split(/\s+/, 1)[0] ?? '')
		const fields = [...line.matchAll(/"([^"]*)"/g)].map((match) => match[1])
		if (!id || fields.length < 3 || !/\[03[0-9a-f]{2}\]$/i.test(fields[0])) return []
		return [{id, vendor: stripPciId(fields[1]), model: stripPciId(fields[2])}]
	})
}

async function getPciControllers(): Promise<PciController[]> {
	try {
		const {stdout} = await execa('lspci', ['-D', '-mm', '-nn', '-d', '::03xx'], {timeout: COMMAND_TIMEOUT_MS})
		return parsePciControllers(stdout)
	} catch {
		return []
	}
}

async function readText(filePath: string): Promise<string | null> {
	try {
		return await fse.readFile(filePath, 'utf8')
	} catch {
		return null
	}
}

async function readNumber(filePath: string): Promise<number | null> {
	const contents = await readText(filePath)
	if (contents === null) return null
	const value = Number(contents.trim())
	return Number.isFinite(value) && value >= 0 ? value : null
}

const vendorName = (id: string | undefined) => {
	if (id === '0x1002') return 'Advanced Micro Devices, Inc. [AMD/ATI]'
	if (id === '0x10de') return 'NVIDIA Corporation'
	if (id === '0x8086') return 'Intel Corporation'
	return id ?? 'Unknown'
}

async function getDrmDevices(controllers: PciController[]): Promise<DrmDevice[]> {
	let entries: string[] = []
	try {
		entries = await fse.readdir(DRM_CLASS_PATH)
	} catch {
		return []
	}

	const controllerById = new Map(controllers.map((controller) => [controller.id, controller]))
	const devices = await Promise.all(
		entries
			.filter((entry) => /^card\d+$/.test(entry))
			.map(async (entry): Promise<DrmDevice | null> => {
				const devicePath = path.join(DRM_CLASS_PATH, entry, 'device')
				const uevent = await readText(path.join(devicePath, 'uevent'))
				const deviceId = normalizePciAddress(uevent?.match(/^PCI_SLOT_NAME=(.+)$/m)?.[1] ?? '')
				if (!deviceId) return null

				let driver = 'unknown'
				try {
					driver = path.basename(await fse.realpath(path.join(devicePath, 'driver')))
				} catch {
					// A card without a bound driver cannot provide usage telemetry.
				}

				const [vendorId, totalUsed, dedicatedTotal, dedicatedUsed, sharedUsed] = await Promise.all([
					readText(path.join(devicePath, 'vendor')),
					readNumber(path.join(devicePath, 'gpu_busy_percent')),
					readNumber(path.join(devicePath, 'mem_info_vram_total')),
					readNumber(path.join(devicePath, 'mem_info_vram_used')),
					readNumber(path.join(devicePath, 'mem_info_gtt_used')),
				])
				const controller = controllerById.get(deviceId)

				return {
					id: deviceId,
					vendor: controller?.vendor ?? vendorName(vendorId?.trim()),
					model: controller?.model ?? `${driver} GPU`,
					driver,
					sysfsTotalUsed: totalUsed === null ? null : clampPercent(totalUsed),
					dedicatedMemory:
						dedicatedTotal !== null || dedicatedUsed !== null
							? {total: dedicatedTotal, used: clampBytes(dedicatedUsed ?? 0)}
							: null,
					sharedMemory: sharedUsed === null ? null : {used: clampBytes(sharedUsed)},
				}
			}),
	)

	return devices.filter((device): device is DrmDevice => device !== null)
}

function parseValueWithUnit(value: string): number | null {
	const match = value.trim().match(/^(\d+)(?:\s+(B|KiB|MiB|GiB|ns|us|ms|s))?$/i)
	if (!match) return null
	const amount = Number(match[1])
	const unit = match[2]?.toLowerCase()
	const multiplier =
		unit === 'kib'
			? 1024
			: unit === 'mib'
				? 1024 ** 2
				: unit === 'gib'
					? 1024 ** 3
					: unit === 'us'
						? 1_000
						: unit === 'ms'
							? 1_000_000
							: unit === 's'
								? 1_000_000_000
								: 1
	return Number.isFinite(amount) ? amount * multiplier : null
}

const isDedicatedRegion = (region: string) => /^(?:vram|local)/i.test(region)

export function parseDrmFdinfo(contents: string, pid: number): DrmClientSample | null {
	const values = new Map<string, string>()
	for (const line of contents.split('\n')) {
		const separator = line.indexOf(':')
		if (separator === -1) continue
		values.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
	}

	const clientId = values.get('drm-client-id')
	const rawDeviceId = values.get('drm-pdev')
	if (!values.get('drm-driver') || !clientId || !rawDeviceId) return null
	const deviceId = normalizePciAddress(rawDeviceId)

	const capacities = new Map<string, number>()
	for (const [key, value] of values) {
		const match = key.match(/^drm-engine-capacity-(.+)$/)
		if (!match) continue
		const parsed = Number(value)
		if (Number.isFinite(parsed) && parsed > 0) capacities.set(match[1], parsed)
	}

	const engines: Record<string, DrmEngineSample> = {}
	const cycles: Record<string, DrmCycleSample> = {}
	const memoryRegions = new Map<string, {priority: number; used: number}>()

	for (const [key, value] of values) {
		const engine = key.match(/^drm-engine-(.+)$/)
		if (engine && !engine[1].startsWith('capacity-')) {
			const busy = parseValueWithUnit(value)
			if (busy !== null) engines[engine[1]] = {busy, capacity: capacities.get(engine[1]) ?? 1}
			continue
		}

		const cycle = key.match(/^drm-cycles-(.+)$/)
		if (cycle) {
			const busy = parseValueWithUnit(value)
			const total = parseValueWithUnit(values.get(`drm-total-cycles-${cycle[1]}`) ?? '')
			if (busy !== null && total !== null) {
				cycles[cycle[1]] = {busy, total, capacity: capacities.get(cycle[1]) ?? 1}
			}
			continue
		}

		const memory = key.match(/^drm-(resident|memory|total)-(.+)$/)
		if (!memory || memory[2].startsWith('cycles-')) continue
		const used = parseValueWithUnit(value)
		if (used === null) continue
		const priority = memory[1] === 'resident' ? 3 : memory[1] === 'memory' ? 2 : 1
		if ((memoryRegions.get(memory[2])?.priority ?? 0) < priority) memoryRegions.set(memory[2], {priority, used})
	}

	let dedicatedMemoryUsed = 0
	let sharedMemoryUsed = 0
	for (const [region, memory] of memoryRegions) {
		if (isDedicatedRegion(region)) dedicatedMemoryUsed += memory.used
		else sharedMemoryUsed += memory.used
	}

	return {
		key: `${deviceId}:${clientId}`,
		deviceId,
		pids: [pid],
		engines,
		cycles,
		dedicatedMemoryUsed: clampBytes(dedicatedMemoryUsed),
		sharedMemoryUsed: clampBytes(sharedMemoryUsed),
	}
}

// The columns of debugfs' clients file vary by kernel: newer ones add name
// and id after magic. So the tgid column is found from the header, counted
// from the end because the command before it can contain spaces.
export function parseDrmClientPids(contents: string): number[] {
	const [header = '', ...lines] = contents.split('\n')
	const columns = header.trim().split(/\s+/)
	const tgidColumn = columns.indexOf('tgid')
	if (tgidColumn === -1) return []
	const fromEnd = columns.length - tgidColumn
	return lines.flatMap((line) => {
		const fields = line.trim().split(/\s+/)
		const pid = Number(fields.at(-fromEnd))
		return Number.isInteger(pid) && pid > 0 ? [pid] : []
	})
}

async function getDrmClientPids(): Promise<number[]> {
	let entries: string[] = []
	try {
		entries = await fse.readdir(DRM_DEBUG_PATH)
	} catch {
		return []
	}
	const clientFiles = entries
		.filter((entry) => /^\d+$/.test(entry))
		.map((entry) => path.join(DRM_DEBUG_PATH, entry, 'clients'))
	const clients = await Promise.all(clientFiles.map((file) => readText(file)))
	return [...new Set(clients.flatMap((contents) => (contents ? parseDrmClientPids(contents) : [])))]
}

async function readDrmClientsForPid(pid: number): Promise<DrmClientSample[]> {
	const directory = `/proc/${pid}/fdinfo`
	let entries: string[] = []
	try {
		entries = await fse.readdir(directory)
	} catch {
		return []
	}
	const files = await Promise.all(entries.map((entry) => readText(path.join(directory, entry))))
	return files.flatMap((contents) => {
		const parsed = contents ? parseDrmFdinfo(contents, pid) : null
		return parsed ? [parsed] : []
	})
}

async function getDrmClientSamples(): Promise<DrmClientSample[]> {
	const pids = await getDrmClientPids()
	const samples = (await Promise.all(pids.map((pid) => readDrmClientsForPid(pid)))).flat()
	const unique = new Map<string, DrmClientSample>()
	for (const sample of samples) {
		const existing = unique.get(sample.key)
		if (existing) existing.pids = [...new Set([...existing.pids, ...sample.pids])]
		else unique.set(sample.key, sample)
	}
	return [...unique.values()]
}

function drmEngineUtilization(
	before: DrmClientSample,
	after: DrmClientSample,
	engine: string,
	elapsedNanoseconds: number,
): number | null {
	const afterCycles = after.cycles[engine]
	const beforeCycles = before.cycles[engine]
	if (afterCycles && beforeCycles) {
		const busyDelta = afterCycles.busy - beforeCycles.busy
		const totalDelta = afterCycles.total - beforeCycles.total
		if (busyDelta < 0 || totalDelta <= 0) return 0
		return clampPercent((busyDelta / totalDelta / afterCycles.capacity) * 100)
	}

	const afterEngine = after.engines[engine]
	const beforeEngine = before.engines[engine]
	if (!afterEngine || !beforeEngine || elapsedNanoseconds <= 0) return null
	const busyDelta = afterEngine.busy - beforeEngine.busy
	if (busyDelta < 0) return 0
	return clampPercent((busyDelta / elapsedNanoseconds / afterEngine.capacity) * 100)
}

export function calculateDrmUtilization(
	before: DrmClientSample[],
	after: DrmClientSample[],
	elapsedNanoseconds: number,
): Map<string, {totalUsed: number; clients: Map<string, number>}> {
	const beforeByKey = new Map(before.map((client) => [client.key, client]))
	const enginesByDevice = new Map<string, Map<string, Map<string, number>>>()

	for (const client of after) {
		const previous = beforeByKey.get(client.key)
		if (!previous) continue
		const engines = new Set([...Object.keys(client.engines), ...Object.keys(client.cycles)])
		for (const engine of engines) {
			const used = drmEngineUtilization(previous, client, engine, elapsedNanoseconds)
			if (used === null) continue
			const device = enginesByDevice.get(client.deviceId) ?? new Map<string, Map<string, number>>()
			const clients = device.get(engine) ?? new Map<string, number>()
			clients.set(client.key, used)
			device.set(engine, clients)
			enginesByDevice.set(client.deviceId, device)
		}
	}

	const result = new Map<string, {totalUsed: number; clients: Map<string, number>}>()
	for (const [deviceId, engines] of enginesByDevice) {
		const busiest = [...engines.values()].reduce<Map<string, number> | null>((current, clients) => {
			if (!current) return clients
			const currentTotal = [...current.values()].reduce((total, used) => total + used, 0)
			const nextTotal = [...clients.values()].reduce((total, used) => total + used, 0)
			return nextTotal > currentTotal ? clients : current
		}, null)
		if (!busiest) continue
		result.set(deviceId, {
			totalUsed: clampPercent([...busiest.values()].reduce((total, used) => total + used, 0)),
			clients: busiest,
		})
	}
	return result
}

async function sampleDrmDevices(devices: DrmDevice[]): Promise<GpuDeviceUsage[]> {
	const before = await getDrmClientSamples()
	const hasEngineTelemetry = before.some(
		(client) => Object.keys(client.engines).length > 0 || Object.keys(client.cycles).length > 0,
	)
	let after = before
	let elapsedNanoseconds = 0
	if (hasEngineTelemetry) {
		const started = process.hrtime.bigint()
		await delay(DRM_SAMPLE_INTERVAL_MS)
		after = await getDrmClientSamples()
		elapsedNanoseconds = Number(process.hrtime.bigint() - started)
	}
	const utilization = calculateDrmUtilization(before, after, elapsedNanoseconds)
	const clientsByDevice = new Map<string, DrmClientSample[]>()
	for (const client of after)
		clientsByDevice.set(client.deviceId, [...(clientsByDevice.get(client.deviceId) ?? []), client])

	return devices.map((device) => {
		const deviceClients = clientsByDevice.get(device.id) ?? []
		const clientUtilization = utilization.get(device.id)
		const clientDedicatedMemory = deviceClients.reduce((total, client) => total + client.dedicatedMemoryUsed, 0)
		const clientSharedMemory = deviceClients.reduce((total, client) => total + client.sharedMemoryUsed, 0)
		const processes = deviceClients.map((client) => ({
			pids: client.pids,
			used: clientUtilization?.clients.get(client.key) ?? null,
			dedicatedMemoryUsed: client.dedicatedMemoryUsed,
			sharedMemoryUsed: client.sharedMemoryUsed,
		}))

		const driverHasIdleUtilization = device.driver === 'i915' || device.driver === 'xe'
		const {sysfsTotalUsed, driver: _driver, ...publicDevice} = device
		const dedicatedMemory =
			device.dedicatedMemory || clientDedicatedMemory > 0
				? {
						total: device.dedicatedMemory?.total ?? null,
						used: clampBytes(Math.max(device.dedicatedMemory?.used ?? 0, clientDedicatedMemory)),
					}
				: null
		const sharedMemory =
			device.sharedMemory || clientSharedMemory > 0 || driverHasIdleUtilization
				? {used: clampBytes(Math.max(device.sharedMemory?.used ?? 0, clientSharedMemory))}
				: null
		return {
			...publicDevice,
			totalUsed: sysfsTotalUsed ?? clientUtilization?.totalUsed ?? (driverHasIdleUtilization ? 0 : null),
			dedicatedMemory,
			sharedMemory,
			processes,
		}
	})
}

type NvidiaDevice = GpuDeviceUsage & {index: number; uuid: string}

export function parseNvidiaGpuCsv(output: string): NvidiaDevice[] {
	return output.split('\n').flatMap((line) => {
		if (!line.trim()) return []
		const fields = line.split(',').map((field) => field.trim())
		if (fields.length < 7) return []
		const [index, uuid, pciAddress, model, utilization, totalMemory, usedMemory] = fields
		const parsedIndex = Number(index)
		const total = Number(totalMemory)
		const used = Number(usedMemory)
		if (!Number.isInteger(parsedIndex) || !uuid || !pciAddress) return []
		return [
			{
				index: parsedIndex,
				uuid,
				id: normalizePciAddress(pciAddress),
				vendor: 'NVIDIA Corporation',
				model,
				totalUsed: utilization === 'N/A' ? null : clampPercent(Number(utilization)),
				dedicatedMemory:
					Number.isFinite(total) && Number.isFinite(used)
						? {total: clampBytes(total * 1024 ** 2), used: clampBytes(used * 1024 ** 2)}
						: null,
				sharedMemory: null,
				processes: [],
			},
		]
	})
}

export function parseNvidiaPmon(
	output: string,
): Array<{index: number; pid: number; used: number | null; memoryUsed: number}> {
	const lines = output.split('\n')
	const header = lines
		.map((line) => line.trim())
		.find((line) => line.startsWith('# gpu'))
		?.replace(/^#\s*/, '')
		.split(/\s+/)
	if (!header) return []
	const indexes = {
		gpu: header.indexOf('gpu'),
		pid: header.indexOf('pid'),
		used: header.indexOf('sm'),
		memory: header.indexOf('fb'),
	}
	if (Object.values(indexes).some((index) => index === -1)) return []

	return lines.flatMap((line) => {
		if (!line.trim() || line.trim().startsWith('#')) return []
		const fields = line.trim().split(/\s+/)
		const index = Number(fields[indexes.gpu])
		const pid = Number(fields[indexes.pid])
		if (!Number.isInteger(index) || !Number.isInteger(pid) || pid <= 0) return []
		const rawUsed = fields[indexes.used]
		const rawMemory = fields[indexes.memory]
		return [
			{
				index,
				pid,
				used: rawUsed === '-' ? null : clampPercent(Number(rawUsed)),
				memoryUsed: rawMemory === '-' ? 0 : clampBytes(Number(rawMemory) * 1024 ** 2),
			},
		]
	})
}

async function sampleNvidiaDevices(): Promise<GpuDeviceUsage[]> {
	const [gpuResult, processResult] = await Promise.allSettled([
		execa(
			'nvidia-smi',
			[
				'--query-gpu=index,uuid,pci.bus_id,name,utilization.gpu,memory.total,memory.used',
				'--format=csv,noheader,nounits',
			],
			{timeout: COMMAND_TIMEOUT_MS},
		),
		execa('nvidia-smi', ['pmon', '-c', '1', '-s', 'um'], {timeout: COMMAND_TIMEOUT_MS}),
	])
	if (gpuResult.status === 'rejected') return []
	const devices = parseNvidiaGpuCsv(gpuResult.value.stdout)
	const processes = processResult.status === 'fulfilled' ? parseNvidiaPmon(processResult.value.stdout) : []
	for (const process of processes) {
		const device = devices.find(({index}) => index === process.index)
		device?.processes.push({
			pids: [process.pid],
			used: process.used,
			dedicatedMemoryUsed: process.memoryUsed,
			sharedMemoryUsed: 0,
		})
	}
	return devices.map(({index: _index, uuid: _uuid, ...device}) => device)
}

let usageInFlight: Promise<GpuDeviceUsage[]> | undefined

export function mergeGpuDeviceUsage(drmUsage: GpuDeviceUsage[], nvidiaUsage: GpuDeviceUsage[]): GpuDeviceUsage[] {
	const devices = new Map(drmUsage.map((device) => [device.id, device]))
	for (const nvidia of nvidiaUsage) {
		const drm = devices.get(nvidia.id)
		// nvidia-smi is authoritative when it returned process telemetry. Do not
		// also count the same allocations from NVIDIA's DRM fdinfo; retain DRM as
		// a fallback when pmon exposes no process data.
		const processes = nvidia.processes.length > 0 ? nvidia.processes : (drm?.processes ?? [])
		devices.set(nvidia.id, drm ? {...drm, ...nvidia, processes} : nvidia)
	}
	return [...devices.values()].sort((a, b) => a.id.localeCompare(b.id))
}

export async function getGpuDeviceUsage(): Promise<GpuDeviceUsage[]> {
	if (usageInFlight) return usageInFlight
	usageInFlight = (async () => {
		const controllers = await getPciControllers()
		const drmDevices = await getDrmDevices(controllers)
		const hasNvidia = controllers.some(({vendor}) => /nvidia/i.test(vendor))
		const [drmUsage, nvidiaUsage] = await Promise.all([
			sampleDrmDevices(drmDevices),
			hasNvidia ? sampleNvidiaDevices() : Promise.resolve([]),
		])

		return mergeGpuDeviceUsage(drmUsage, nvidiaUsage)
	})()

	try {
		return await usageInFlight
	} finally {
		usageInFlight = undefined
	}
}
