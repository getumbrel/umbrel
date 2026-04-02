import fse from 'fs-extra'
import {$} from 'execa'

import type Umbreld from '../../index.js'
// Used by getIdentity() until detectDevice is refactored into this module
import {detectDevice} from '../system/system.js'

type LsblkDevice = {
	name: string
	type: string
	tran: string | null // Transport type (nvme, sata, mmc, usb, etc.)
	rota: boolean // Rotational: true = HDD, false = SSD
}

// Determine storage type from lsblk transport and rotational flag
function getStorageType(disk: LsblkDevice): string {
	if (disk.tran === 'mmc') return 'SD'
	if (disk.tran === 'nvme') return 'NVMe SSD'
	return disk.rota ? 'HDD' : 'SSD'
}

export default class Device {
	#umbreld: Umbreld
	logger: Umbreld['logger']

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(`systemng:${name.toLowerCase()}`)
	}

	async start() {
		this.logger.log('Starting device')
	}

	async stop() {
		this.logger.log('Stopping device')
	}

	async getIdentity() {
		return detectDevice()
	}

	async getSpecs() {
		const [identity, cpu, {memorySize, memoryType}, {storageSize, storageType}] = await Promise.all([
			this.getIdentity(),
			this.#getCpu(),
			this.#getMemory(),
			this.#getStorage(),
		])
		return {...identity, cpu, memorySize, memoryType, storageSize, storageType}
	}

	async #getCpu(): Promise<string> {
		try {
			// lscpu normalizes CPU info across x86 and arm64 (unlike /proc/cpuinfo which varies by architecture)
			const {stdout} = await $`lscpu`
			const rawName = stdout.match(/^Model name:\s*(.+)$/m)?.[1]?.trim()
			if (!rawName) return ''

			// Clean up CPUID brand string artifacts: (R) → ®, (TM) → ™, (C) → ©, strip "CPU"
			const modelName = rawName
				.replace(/\(R\)/gi, '®')
				.replace(/\(TM\)/gi, '™')
				.replace(/\(C\)/gi, '©')
				.replace(/CPU/g, '')
				.replace(/\s+/g, ' ')
				.trim()

			const vendorId = stdout.match(/^Vendor ID:\s*(.+)$/m)?.[1]?.trim()
			// Map vendor IDs to human-readable names (GenuineIntel → Intel, AuthenticAMD → AMD, ARM → ARM)
			const vendorMap: Record<string, string> = {GenuineIntel: 'Intel', AuthenticAMD: 'AMD', ARM: 'ARM'}
			const vendor = vendorMap[vendorId ?? ''] ?? ''

			// Prefix vendor if not already in model name (e.g. "Intel® N150" already contains "Intel")
			if (vendor && !modelName.includes(vendor)) return `${vendor} ${modelName}`
			return modelName
		} catch {
			// Non-fatal, return empty string
		}
		return ''
	}

	async #getMemory(): Promise<{memorySize: number | null; memoryType: string}> {
		let memorySize: number | null = null
		let memoryType = ''

		try {
			const meminfo = await fse.readFile('/proc/meminfo', 'utf8')
			const match = meminfo.match(/^MemTotal:\s+(\d+)\s+kB$/m)
			if (match) {
				// /proc/meminfo reports in kB (actually KiB — 1024 bytes)
				memorySize = Number(match[1]) * 1024
			}
		} catch {
			// Non-fatal, return defaults
		}

		try {
			// dmidecode reads SMBIOS tables — available on x86, not ARM (Pi).
			// Match all Type fields and skip empty/unknown slots to find the first populated DIMM.
			const {stdout} = await $`dmidecode --type 17`
			const types = [...stdout.matchAll(/^\s*Type:\s*(.+)$/gm)].map((m) => m[1].trim())
			const validType = types.find((t) => t !== 'Unknown' && t !== 'Other')
			if (validType) {
				memoryType = validType
			}
		} catch {
			// Non-fatal, expected to fail on ARM
		}

		return {memorySize, memoryType}
	}

	async #getStorage(): Promise<{storageSize: number | null; storageType: string}> {
		let storageSize: number | null = null
		let storageType = ''

		try {
			// Use RAID pool size on Pro, fall back to df for other devices.
			// Duplicates logic from system/system.ts getSystemDiskUsage (will be consolidated when system module is migrated).
			if (await this.#umbreld.hardware.umbrelPro.isUmbrelPro()) {
				const pool = await this.#umbreld.hardware.raid.getStatus()
				if (pool.exists) {
					storageSize = pool.usableSpace ?? null
				}
			}
			if (storageSize === null) {
				const df = await $`df --output=size --block-size=1 ${this.#umbreld.dataDirectory}`
				storageSize = Number(df.stdout.split('\n').slice(-1)[0].trim())
			}
		} catch {
			// Non-fatal, return defaults
		}

		try {
			// Storage type detection: match the data directory's partition to a physical disk via lsblk.
			// On Pro with RAID, df returns a ZFS dataset name (e.g. umbrelos-xxx/data) that
			// won't match lsblk, so storageType defaults to empty string. The UI links
			// Pro users to Storage Manager for full detail.

			// Get the base disk device from the partition name. Strip the trailing partition
			// number (sda1 → sda) and the 'p' separator used by NVMe/MMC (nvme0n1p1 → nvme0n1).
			const dfSource = await $`df ${this.#umbreld.dataDirectory} --output=source`
			const dataDirDisk = dfSource.stdout
				.split('\n')
				.pop()
				?.split('/')
				.pop()
				?.replace(/p?\d+$/, '')

			const {stdout} = await $`lsblk --output NAME,TYPE,TRAN,ROTA --json`
			const {blockdevices} = JSON.parse(stdout) as {blockdevices: LsblkDevice[]}
			const matchedDisk = blockdevices.find((d) => d.type === 'disk' && d.name === dataDirDisk)

			if (matchedDisk) {
				storageType = getStorageType(matchedDisk)
			}
		} catch {
			// Non-fatal, return defaults
		}

		return {storageSize, storageType}
	}
}
