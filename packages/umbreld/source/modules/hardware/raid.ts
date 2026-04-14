import crypto from 'node:crypto'
import os from 'node:os'
import {setTimeout} from 'node:timers/promises'

import fse from 'fs-extra'
import {$} from 'execa'
import pRetry from 'p-retry'
import prettyBytes from 'pretty-bytes'

import type Umbreld from '../../index.js'
import FileStore from '../utilities/file-store.js'
import {reboot} from '../system/system.js'
import {setSystemStatus} from '../system/routes.js'
import runEvery from '../utilities/run-every.js'

// Get the size of a block device or partition in bytes
async function getDeviceSize(device: string): Promise<number> {
	const {stdout} = await $`lsblk --output SIZE --bytes --nodeps --noheadings ${device}`
	return parseInt(stdout.trim(), 10)
}

// Round device size down to nearest 250GB if over 1TB
// Round device size down to nearest 25GB if over 250GB
// This ensures drives of slightly different sizes can be used together in RAID
// e.g 512GB + 500GB can be used together
export function getRoundedDeviceSize(sizeInBytes: number): number {
	const twoFiftyGigabytes = 250_000_000_000
	const oneTerabyte = 1_000_000_000_000
	const twentyFiveGigabytes = 25_000_000_000
	if (sizeInBytes >= oneTerabyte) return Math.floor(sizeInBytes / twoFiftyGigabytes) * twoFiftyGigabytes
	if (sizeInBytes >= twoFiftyGigabytes) return Math.floor(sizeInBytes / twentyFiveGigabytes) * twentyFiveGigabytes
	return sizeInBytes
}

export type RaidType = 'storage' | 'failsafe'
export type Topology = 'stripe' | 'raidz' | 'mirror'

export type ExpansionStatus = {
	state: 'expanding' | 'finished' | 'canceled'
	progress: number
}

export type FailsafeTransitionStatus = {
	state: 'syncing' | 'rebooting' | 'rebuilding' | 'complete' | 'error'
	progress: number
	error?: string
}

export type RebuildStatus = {
	state: 'rebuilding' | 'finished' | 'canceled'
	progress: number
}

export type FailsafeMirrorTransitionPair = {
	existingDeviceId: string
	newDeviceId: string
}

export type ReplaceStatus = {
	state: 'rebuilding' | 'expanding' | 'finished' | 'canceled'
	progress: number
}

type AcceleratorConfig = {
	devices: string[]
}

// Types for zpool status --json --json-int --json-flat-vdevs output
type State = 'ONLINE' | 'DEGRADED' | 'FAULTED' | 'OFFLINE' | 'UNAVAIL' | 'REMOVED' | 'CANT_OPEN'
type Vdev = {
	vdev_type: 'root' | 'raidz' | 'mirror' | 'disk' | 'file'
	path?: string
	rep_dev_size?: number
	phys_space?: number
	slow_ios?: number
	name: string
	guid: number
	class: 'normal' | 'special' | 'l2cache' | string
	parent?: string
	state: State
	alloc_space: number
	total_space: number
	def_space: number
	read_errors: number
	write_errors: number
	checksum_errors: number
}
type ScanStats = {
	function: 'SCRUB' | 'RESILVER'
	state: 'SCANNING' | 'FINISHED' | 'CANCELED'
	start_time: number
	end_time: number
	to_examine: number
	examined: number
	skipped: number
	processed: number
	errors: number
	bytes_per_scan: number
	pass_start: number
	scrub_pause: number
	scrub_spent_paused: number
	issued_bytes_per_scan: number
	issued: number
}
type RaidzExpandStats = {
	name: string
	state: 'SCANNING' | 'FINISHED' | 'CANCELED'
	expanding_vdev: number
	start_time: number
	end_time: number
	to_reflow: number
	reflowed: number
	waiting_for_resilver: number
}
type Pool = {
	name: string
	state: State
	pool_guid: number
	txg: number
	spa_version: number
	zpl_version: number
	error_count: number
	status?: string
	action?: string
	msgid?: string
	moreinfo?: string
	scan_stats?: ScanStats
	raidz_expand_stats?: RaidzExpandStats
	vdevs: Record<string, Vdev>
}
type ZpoolStatusOutput = {
	output_version: {
		command: string
		vers_major: number
		vers_minor: number
	}
	pools: Record<string, Pool>
}

type AcceleratorPoolDevice = {
	id: string
	status: State
	l2arcPartition: string
	l2arcSize: number
	specialPartition: string
	specialSize: number
}

type ParsedAccelerator = {
	devices: AcceleratorPoolDevice[]
	totalL2arcSize: number
	totalSpecialUsableSize: number
}

type ConfigStore = {
	user?: {
		name: string
		hashedPassword?: string
		password?: string
		language: string
	}
	raid?: {
		poolName: string
		state: 'normal' | 'transitioning-to-failsafe'
		devices: string[]
		raidType: RaidType
		accelerator?: AcceleratorConfig
	}
}

export default class Raid {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	configStore: FileStore<ConfigStore>
	isTransitioningToFailsafe = false
	isReplacing = false
	failsafeTransitionStatus?: FailsafeTransitionStatus
	replaceStatus?: ReplaceStatus
	initialRaidSetupError?: Error
	poolNameBase = 'umbrelos'
	temporaryDevicePath = '/tmp/umbrelos-temporary-migration-device.img'
	#lastExpansionProgress = 0
	#lastRebuildProgress = 0
	#stopPoolMonitor?: () => void
	#lastEmittedExpansion?: ExpansionStatus
	#lastEmittedRebuild?: RebuildStatus
	#lastEmittedReplace?: ReplaceStatus

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(`hardware:${name.toLowerCase()}`)

		// Create a file store for the config file with hooks to handle read-only partition
		const configPartition = '/run/rugix/mounts/config'
		const configFile = `${configPartition}/umbrel.yaml`
		this.configStore = new FileStore<ConfigStore>({
			filePath: configFile,
			onBeforeWrite: () => $`mount -o remount,rw ${configPartition}`,
			// This occasionally fails with "mount point is busy" errors. I have no idea why because all writes are
			// queued so there should be no open file handles and remount should flush writes. Retrying with a delay
			// makes this extremely unlikely to ever fail but blocks the write queue. It's acceptable since config
			// writes are rare. On the tiny chance that 5 retries fail we just log the error and move on without failing
			// to avoid blocking the write queue. This means the config partition would be left in rw state which isn't ideal
			// but it's very unlikely to happen and less bad than killing the current operation which is probably quite
			// critical if it's touching the RAID config file like a ZFS dataset migration. The next boot or config udpate
			// should successfully remount the partition read-only.
			onAfterWrite: () =>
				pRetry(() => $`mount -o remount,ro ${configPartition}`, {
					retries: 5,
					factor: 1.1,
					minTimeout: 100,
				}).catch((error) => {
					this.logger.error('Failed to remount config partition read-only', error)
				}),
		})
	}

	async hasConfigStore() {
		return await fse.pathExists(this.configStore.filePath)
	}

	// Generate a unique pool name with random suffix to avoid collisions
	// when SSDs from other Umbrel installations are connected
	generatePoolName(): string {
		const suffix = crypto.randomBytes(4).toString('hex')
		return `${this.poolNameBase}-${suffix}`
	}

	async start() {
		this.logger.log('Starting RAID')

		// Halve the default ZFS ARC minimum (RAM/32 -> RAM/64) to free up memory.
		// On a 16GB device this means 256MB instead of 512MB.
		// This is more conservative for umbrelOS where we may be running alongside many apps.
		try {
			const totalMemory = os.totalmem()
			const arcMin = Math.max(32 * 1024 * 1024, Math.floor(totalMemory / 64))
			await fse.writeFile('/sys/module/zfs/parameters/zfs_arc_min', String(arcMin))
			this.logger.log(`Set ZFS ARC min to ${prettyBytes(arcMin)}`)
		} catch (error) {
			this.logger.error('Failed to set ZFS ARC min', error)
		}

		// Exclude blocks on special vdev from l2arc since we run both l2arc and special vdev
		// on different partitions on the same accelerator device. There's no speedup caching
		// blocks in l2arc on the same device that they already live on. It just wastes l2 cache
		// space for no reason.
		try {
			await fse.writeFile('/sys/module/zfs/parameters/l2arc_exclude_special', '1')
			this.logger.log('Set ZFS l2arc_exclude_special to 1')
		} catch (error) {
			this.logger.error('Failed to set ZFS l2arc_exclude_special', error)
		}

		// Start pool monitor to send realtime events
		// This must happen before any operations that trigger rebuild/expansion
		// so events are captured from the start
		try {
			this.#startPoolMonitor()
		} catch (error) {
			this.logger.error('Failed to start pool monitor', error)
		}

		// Handle initial RAID setup after first boot with the new array
		await this.handlePostBootRaidSetupProcess().catch((error) =>
			this.logger.error('Failed to handle initial RAID setup boot', error),
		)

		// Update the config file to match the current live RAID device paths once the
		// array is mounted and healthy. This also migrates old /dev/disk/by-id paths
		// to the new /dev/disk/by-umbrel-id scheme.
		await this.#updateConfigDevicePaths().catch((error) => {
			this.logger.error('Failed to update RAID config device paths', error)
		})

		// Check if we are currently transitioning to failsafe mode and complete the migration
		await this.#completeFailsafeTransition().catch((error) => {
			this.logger.error('Failed to complete FailSafe transition:', error)
		})

		// TODO: Monthly scrub
	}

	async stop() {
		this.logger.log('Stopping RAID')
		this.#stopPoolMonitor?.()
	}

	async #updateConfigDevicePaths(): Promise<void> {
		const status = await this.getStatus()
		if (!status.exists || status.status !== 'ONLINE') return

		const devices = status.devices!.map((device) => `/dev/disk/by-umbrel-id/${device.id}`)
		await this.configStore.set('raid.devices', devices)

		if (status.accelerator?.devices) {
			const acceleratorDevices = status.accelerator.devices.map((device) => `/dev/disk/by-umbrel-id/${device.id}`)
			await this.configStore.set('raid.accelerator.devices', acceleratorDevices)
		}
	}

	#startPoolMonitor() {
		this.#stopPoolMonitor = runEvery(
			'1 second',
			async () => {
				try {
					const pool = await this.getStatus()

					// Emit expansion progress events
					if (pool.expansion) {
						const last = this.#lastEmittedExpansion
						if (last?.state !== pool.expansion.state || last?.progress !== pool.expansion.progress) {
							this.#lastEmittedExpansion = pool.expansion
							this.#umbreld.eventBus.emit('raid:expansion-progress', pool.expansion)
						}
					}

					// Emit rebuild progress events (for normal rebuilds, not failsafe transitions)
					if (pool.rebuild) {
						const last = this.#lastEmittedRebuild
						if (last?.state !== pool.rebuild.state || last?.progress !== pool.rebuild.progress) {
							this.#lastEmittedRebuild = pool.rebuild
							this.#umbreld.eventBus.emit('raid:rebuild-progress', pool.rebuild)
						}
					}
				} catch {
					// Silently ignore errors during monitoring
				}
			},
			{runInstantly: true},
		)
	}

	// Get status of the main RAID pool with migration error if any
	async getStatus() {
		const name = await this.configStore.get('raid.poolName')
		const status = await this.getPoolStatus(name)

		return {
			name,
			...status,
			replace: this.replaceStatus,
			failsafeTransitionStatus: this.failsafeTransitionStatus,
			// Supress degraded state when performing failsafe transition
			status:
				this.failsafeTransitionStatus?.state === 'rebuilding' && status.status === 'DEGRADED'
					? 'ONLINE'
					: status.status,
		}
	}

	// Get status of a RAID pool
	async getPoolStatus(poolName: string): Promise<{
		exists: boolean
		raidType?: RaidType
		totalSpace?: number
		usableSpace?: number
		usedSpace?: number
		freeSpace?: number
		status?: State
		devices?: Array<{
			id: string
			status: State
			readErrors: number
			writeErrors: number
			checksumErrors: number
		}>
		mirrors?: string[][]
		topology?: Topology
		accelerator?: {
			exists: boolean
			l2arcSize?: number
			specialSize?: number
			devices?: Array<{
				id: string
				status: State
			}>
		}
		expansion?: ExpansionStatus
		rebuild?: RebuildStatus
	}> {
		// Get pool status from ZFS
		const pool = await this.#getZpoolStatus(poolName)
		if (!pool) return {exists: false}

		const vdevs = Object.values(pool.vdevs)
		const isDataVdev = (vdev: Vdev) => vdev.class === 'normal'
		const dataVdevs = vdevs.filter(isDataVdev)

		// Determine RAID type from data topology only, ignoring accelerator vdev classes.
		const isRaidz = dataVdevs.some((v) => v.vdev_type === 'raidz')
		const isMirror = dataVdevs.some((v) => v.vdev_type === 'mirror')
		const raidType = isRaidz || isMirror ? 'failsafe' : 'storage'
		let topology: Topology = 'stripe'
		if (isRaidz) topology = 'raidz'
		if (isMirror) topology = 'mirror'

		// Filter vdevs by type
		const rootVdev = dataVdevs.find((v) => v.vdev_type === 'root')
		const diskVdevs = dataVdevs.filter((v) => v.vdev_type === 'disk')
		const fileVdevs = dataVdevs.filter((v) => v.vdev_type === 'file')
		const mirrorVdevs = dataVdevs.filter((v) => v.vdev_type === 'mirror')
		if (!rootVdev) return {exists: false}

		// Parse expansion progress (only relevant for failsafe/raidz mode)
		let expansion: ExpansionStatus | undefined
		if (pool.raidz_expand_stats) {
			const stats = pool.raidz_expand_stats
			const stateMap = {SCANNING: 'expanding', FINISHED: 'finished', CANCELED: 'canceled'} as const
			const state = stateMap[stats.state]

			let progress: number
			if (state === 'finished' || state === 'canceled') {
				// Reset tracker when expansion ends so next expansion starts from 0
				this.#lastExpansionProgress = 0
				progress = state === 'finished' ? 100 : 0
			} else {
				// We need to do some awkward handling here because stats.to_reflow keeps growing forever and messes up the calculations.
				// Cap progress at 99 while expanding due to overflow bugs
				const rawProgress = stats.to_reflow > 0 ? Math.floor((stats.reflowed / stats.to_reflow) * 100) : 0
				const cappedProgress = Math.min(rawProgress, 99)
				// Never let progress go backwards
				progress = Math.max(cappedProgress, this.#lastExpansionProgress)
				this.#lastExpansionProgress = progress
			}

			expansion = {state, progress}
		}

		// Parse rebuild progress (ZFS calls this "resilver")
		let rebuild: RebuildStatus | undefined
		if (pool.scan_stats?.function === 'RESILVER') {
			const stats = pool.scan_stats
			const stateMap = {SCANNING: 'rebuilding', FINISHED: 'finished', CANCELED: 'canceled'} as const
			const state = stateMap[stats.state]

			let progress: number
			if (state === 'finished' || state === 'canceled') {
				// Reset tracker when rebuild ends so next rebuild starts from 0
				this.#lastRebuildProgress = 0
				progress = state === 'finished' ? 100 : 0
			} else {
				// Calculate progress from issued vs to_examine
				const rawProgress = stats.to_examine > 0 ? Math.floor((stats.issued / stats.to_examine) * 100) : 0
				const cappedProgress = Math.min(rawProgress, 99)
				// Never let progress go backwards
				progress = Math.max(cappedProgress, this.#lastRebuildProgress)
				this.#lastRebuildProgress = progress
			}

			rebuild = {state, progress}
		}

		const toDeviceId = (path: string) => path.replace('/dev/disk/by-umbrel-id/', '').replace(/-part\d+$/, '')

		const devices = diskVdevs.map((device) => ({
			id: toDeviceId(device.path!),
			size: device.phys_space,
			status: device.state,
			readErrors: device.read_errors,
			writeErrors: device.write_errors,
			checksumErrors: device.checksum_errors,
		}))

		// Calculate l2arc and special vdev sizes
		// l2arc is striped so we sum all partition sizes
		// special vdev is mirrored so we use the smallest partition size
		const accelerator = this.#parsePoolAccelerator(pool)
		const acceleratorDevices = accelerator.devices.map(({id, status}) => ({id, status}))
		const hasAccelerator = acceleratorDevices.length > 0

		let mirrors: string[][] | undefined
		if (isMirror) {
			const membersByMirrorVdev = new Map<string, string[]>()

			for (const diskVdev of diskVdevs) {
				const mirrorVdevName = diskVdev.parent
				if (!mirrorVdevName) continue
				const members = membersByMirrorVdev.get(mirrorVdevName) ?? []
				members.push(toDeviceId(diskVdev.path!))
				membersByMirrorVdev.set(mirrorVdevName, members)
			}

			mirrors = mirrorVdevs
				.map((mirrorVdev) => (membersByMirrorVdev.get(mirrorVdev.name) ?? []).sort())
				.filter((mirror) => mirror.length > 0)
				.sort((a, b) => a.join(',').localeCompare(b.join(',')))
		}

		// ZFS has an accounting bug where after raidz expansion, it uses the old parity ratio the array was created with
		// to calculate total usable space, used space and free space. Since most users will upgade SSDs one
		// at a time this means they'll start with a parity ratio of 50%. Adding a 3rd disk gives
		// them a parity ratio of 33%. Meaning upgrading from 2 1TB SSDs to 3 1TB SSDs they'd expect to go from
		// 1TB usable space and 1TB parity, to 2TB usable space and 2TB parity. However ZFS will report the old
		// parity ratio of 50% and incorrectly say there is 1.5TB usable space and 1.5TB parity. Even after adding more SSDs and increasing
		// parity ratio further, ZFS will continue to report 50%. It's very confusing and makes it appear as
		// though multiple TBs of storage are being lost. The used space and free space values are also incorrect
		// for the same reason. The expected amount of data can still be written, it's just a reporting issue.
		// - https://github.com/openzfs/zfs/issues/17784
		//
		// We fix this by calculating the usable space ourself by doing:
		//   smallest device size * (number of devices - 1 parity device)
		// We then take the total space and total raw allocated space (including parity overhead) reported by ZFS
		// and calculate the used percentage of the array. We then multiply the usable space by the used percentage to
		// get the actual used space.
		// This results in the expected usable space, used space and free space values after raidz expansion.
		//
		// One quirk of this approach is that we have the opposite accounting issue. Instead of treating all data
		// as using the old parity ratio, we treat all data as using the new parity ratio. When in fact there is a mix.
		// This means after expansion the used space will jump up as we're assuming that the raw data was using the new
		// higher parity ratio. So now total and available space are correct but used space is incorrect. This is much
		// less confusing. It will also correct itself over time. As those files are deleted or modified they'll be
		// re-written using the new parity ratio bringing down the used space.
		// For example starting with 100GB used space and upgrading from 2 devices to 3 will show ~150GB used space.
		// This effectively means the 100GB in the old inneficient parity ratio is taking up enough space to write 150GB
		// of data with the new parity ratio. Deleting this 100GB file frees up 150GB of space for new files.
		let totalSpace = rootVdev.total_space
		let usableSpace = rootVdev.def_space
		let usedSpace = rootVdev.alloc_space
		// Fix raidz fs usage calculations after raidz expansion.
		// Only run this logic with more than 2 devices so we don't run it during the transition which does lots of
		// complex file vdev replace weirdness which makes the below calculations very complex. We don't need this
		// if we only have two devices anyway since ZFS default reporting is reliable in that case.
		if (isRaidz && diskVdevs.length > 2) {
			// Take file vdevs into account to handle the migration pool correctly which
			// has a file vdev. Otherwise we can't track FailSafe transition progress since we watch
			// the migration pools size to calculate snapshot sync progress.
			let numberOfDevices = diskVdevs.length + fileVdevs.length

			// If we're currently replacing a device, don't count it twice. We just assume there's only ever one
			// replacement happening at a time to keep things simple.
			const isReplacing = [...diskVdevs, ...fileVdevs].some((vdev) => vdev.parent?.includes('replacing'))
			if (isReplacing) numberOfDevices -= 1

			// Calculate usable space based on the smallest device size and accounting for a single parity device
			const smallestDeviceSize = Math.min(...devices.map((d) => d.size).filter((size) => size !== undefined))
			usableSpace = smallestDeviceSize * (numberOfDevices - 1)

			// ZFS doesn't update total space until the end of a raidz1 expansion which breaks our calculations.
			// We need to calculate it as soon as we start a resize by summing all the devices.
			// We need to use phys_space because rep_dev_size can randomly change during operations.
			// However sometimes on missing devices phys_space doesn't exist but rep_dev_size does, and in those
			// situations it's stable so we can rely on it.
			// If we're replacing a device we skip the missing one so we don't count it twice.
			totalSpace = [...diskVdevs, ...fileVdevs]
				.filter((vdev) => !(vdev.state === 'CANT_OPEN' && vdev.parent?.includes('replacing')))
				.reduce((sum, vdev) => sum + (vdev.phys_space || vdev.rep_dev_size || 0), 0)

			// Now we need to also fix usedSpace calculations otherwise we'll go negative
			// with the smaller usable space value.
			// The used space percentage is reliable from (alloc / total)
			// so we can multiply usableSpace by the percentage
			const usedPercentage = rootVdev.alloc_space / totalSpace
			usedSpace = Math.ceil(usableSpace * usedPercentage)

			// TODO: Handle FailSafe replace with old devices online

			// TODO: Handle mixed size devices
		}

		// Handle raidz failsafe mode with 2 disks (or 1 disk and 1 file) reporting double usage due to
		// the parity device being included in the total space.
		if (isRaidz && diskVdevs.length <= 2) usedSpace /= 2

		// Fix mirror space reporting. ZFS reports total_space and def_space as the usable capacity
		// (already accounting for mirror redundancy), so totalSpace needs to be calculated from
		// physical device sizes to represent the raw total capacity across all devices.
		if (isMirror) totalSpace = devices.reduce((sum, device) => sum + (device.size ?? 0), 0)

		return {
			exists: true,
			raidType,
			topology,
			totalSpace,
			usableSpace,
			usedSpace,
			freeSpace: usableSpace - usedSpace,
			status: pool.state,
			devices,
			mirrors,
			accelerator: {
				exists: hasAccelerator,
				l2arcSize: accelerator.totalL2arcSize,
				specialSize: accelerator.totalSpecialUsableSize,
				devices: acceleratorDevices,
			},
			expansion,
			rebuild,
		}
	}

	async #getZpoolStatus(poolName: string): Promise<Pool | undefined> {
		try {
			const {stdout} = await $`zpool status --json --json-int --json-flat-vdevs ${poolName}`
			const zpoolStatus = JSON.parse(stdout) as ZpoolStatusOutput
			return zpoolStatus.pools?.[poolName]
		} catch {
			return undefined
		}
	}

	// Parse accelerator vdevs from a pool into per-device info with aggregate sizes.
	// Each physical accelerator device has two partitions: l2arc (read cache) and special (metadata).
	// We match them by device id and combine into a single entry per device.
	#parsePoolAccelerator(pool: Pool): ParsedAccelerator {
		const toDeviceId = (path: string) => path.replace('/dev/disk/by-umbrel-id/', '').replace(/-part\d+$/, '')
		const getVdevSize = (vdev: Vdev) => vdev.phys_space || vdev.rep_dev_size || vdev.total_space || 0
		const vdevs = Object.values(pool.vdevs)
		const cacheVdevs = vdevs.filter((v) => v.vdev_type === 'disk' && v.class === 'l2cache' && v.path)
		const specialVdevs = vdevs.filter((v) => v.vdev_type === 'disk' && v.class === 'special' && v.path)

		// Index special vdevs by device id for matching against cache vdevs
		const specialByDeviceId = new Map(specialVdevs.map((v) => [toDeviceId(v.path!), v]))

		// Build a complete device entry for each accelerator that has both partitions
		const devices: AcceleratorPoolDevice[] = cacheVdevs
			.map((cacheVdev) => {
				const id = toDeviceId(cacheVdev.path!)
				const specialVdev = specialByDeviceId.get(id)
				if (!specialVdev) return undefined

				// Default to cache status, but prefer special vdev status if it's bad since it's more critical
				let status: State = cacheVdev.state
				if (specialVdev.state !== 'ONLINE') status = specialVdev.state

				return {
					id,
					status,
					l2arcPartition: cacheVdev.path!,
					l2arcSize: getVdevSize(cacheVdev),
					specialPartition: specialVdev.path!,
					specialSize: getVdevSize(specialVdev),
				}
			})
			.filter((d): d is AcceleratorPoolDevice => d !== undefined)
			.sort((a, b) => a.id.localeCompare(b.id))

		return {
			devices,
			// l2arc is striped so we sum all partition sizes
			totalL2arcSize: devices.reduce((sum, d) => sum + d.l2arcSize, 0),
			// special vdev is mirrored so usable size is the smallest partition
			totalSpecialUsableSize: devices.length === 0 ? 0 : Math.min(...devices.map((d) => d.specialSize)),
		}
	}

	// Trigger initial RAID setup boot process
	async triggerInitialRaidSetupBootFlow(
		raidDevices: string[],
		raidType: RaidType,
		acceleratorDevices: string[] | undefined,
		user: {name: string; password: string; language: string},
	) {
		// Setup the RAID array and optional accelerator before rebooting into it.
		await this.setup(raidDevices, raidType, acceleratorDevices)

		// Temporarily store the user setup details
		// We handle setting up the user on the next boot
		await this.configStore.set('user', user)

		// Reboot the system into the RAID array
		setTimeout(1000).then(() => reboot()) // Schedule in 1 second so the api response has time to be sent

		return true
	}

	// Handle initial RAID setup after first boot with the new array
	async handlePostBootRaidSetupProcess() {
		// Check if we're on the first boot after RAID setup
		const raidConfigUser = await this.configStore.get('user')
		const userExists = await this.#umbreld.user.exists()
		if (raidConfigUser?.name && raidConfigUser?.password && !userExists) {
			this.logger.log('Detected first boot after RAID setup, creating user')
			try {
				// Create the user which will also update user/hashedPassword in the RAID config
				await this.#umbreld.user.register(raidConfigUser.name, raidConfigUser.password, raidConfigUser.language ?? 'en')

				// Wipe the plain text password from the RAID config
				await this.configStore
					.delete('user.password')
					.catch((error) => this.logger.error('Failed to delete password from RAID config', error))
			} catch (error) {
				this.logger.error('Failed to create user', error)
				// If this fails we save the error to return over the API to the UI
				this.initialRaidSetupError = error as Error
			}
		}
	}

	// Check the status of the RAID setup boot process
	async checkInitialRaidSetupStatus(): Promise<boolean> {
		// Throw error if we failed to create the user
		if (this.initialRaidSetupError) throw this.initialRaidSetupError

		// Return false if the RAID array doesn't exist yet
		const pool = await this.getStatus()
		if (!pool.exists) return false

		// Return false if the user isn't created yet
		const userExists = await this.#umbreld.user.exists()
		if (!userExists) return false

		// Return false if the app store hasn't attempted to complete it's initial sync yet
		if (!this.#umbreld.appStore.attemptedInitialAppStoreUpdate) return false

		// Initial RAID setup is complete
		return true
	}

	// Check if RAID mount failed during boot
	async checkRaidMountFailure(): Promise<boolean> {
		return fse.pathExists('/run/rugix/mounts/data/.rugix/data-mount-error.log')
	}

	// Get details about why RAID mount failed by running a test import
	async checkRaidMountFailureDevices(): Promise<Array<{name: string; isOk: boolean}>> {
		const {stdout} = await $`zpool import -N -d /dev/disk/by-umbrel-id`
		const expectedDevices = ((await this.configStore.get('raid.devices')) ?? []) as string[]

		return expectedDevices.map((device) => {
			const name = device.replace('/dev/disk/by-umbrel-id/', '')
			const isOk = stdout.split('\n').some((line) => line.includes(name) && line.includes('ONLINE'))
			return {name, isOk}
		})
	}

	// Create GPT partition table and partitions on a device
	async #partitionDevice(device: string): Promise<{statePartition: string; dataPartition: string}> {
		const isDiskById = device.startsWith('/dev/disk/by-umbrel-id/')
		if (!isDiskById) throw new Error('Must pass disk by id')

		this.logger.log(`Wiping signatures from ${device}`)
		await $`wipefs --all ${device}`

		// Create partition table and partitions using sgdisk
		// Partition 1: State partition (100MB)
		// Partition 2: Data partition (calculated size based on rounded device size)
		this.logger.log(`Creating partition table on ${device}`)
		await $`sgdisk --zap-all ${device}`

		const oneMiB = 1024 * 1024

		// Add a 10MiB buffer to allow for partition table
		const bufferSizeBytes = 10 * oneMiB // 10 MiB

		// Reserve 100MiB for state partition we may use in the future
		const statePartitionSizeBytes = 100 * oneMiB // 100 MiB

		// Get device size and round down into compatibility buckets.
		// This normalises device sizes. e.g sometimes 4000GB and 4096GB SSDs are sold as 4TB.
		// If we use their sizes directly then starting with a 4096 GB SSD and then trying to add
		// a 4000 GB SSD later will fails because ZFS will complain the new device is too small.
		// This is confusing for the user because they have what they think are two 4TB SSDs.
		const deviceSize = await getDeviceSize(device)
		const roundedDeviceSize = getRoundedDeviceSize(deviceSize)

		// Calculate data partition size all free space after state partition and buffer
		const dataPartitionSizeBytes = roundedDeviceSize - statePartitionSizeBytes - bufferSizeBytes

		// Convert to MiB for sgdisk (M suffix = MiB)
		const statePartitionSizeMiB = Math.floor(statePartitionSizeBytes / oneMiB)
		const dataPartitionSizeMiB = Math.floor(dataPartitionSizeBytes / oneMiB)

		this.logger.log(
			`Device size: ${deviceSize} bytes, rounded: ${roundedDeviceSize} bytes, data partition: ${dataPartitionSizeBytes} bytes (${dataPartitionSizeMiB} MiB)`,
		)

		this.logger.log(`Creating state partition (${statePartitionSizeMiB} MiB) on ${device}`)
		await $`sgdisk --new=1:0:+${statePartitionSizeMiB}M --change-name=1:umbrel-raid-state ${device}`

		this.logger.log(`Creating data partition (${dataPartitionSizeMiB} MiB) on ${device}`)
		await $`sgdisk --new=2:0:+${dataPartitionSizeMiB}M --change-name=2:umbrel-raid-data ${device}`

		// Determine partition naming convention
		const statePartition = `${device}-part1`
		const dataPartition = `${device}-part2`

		// Wait for partitions to appear
		this.logger.log(`Waiting for partitions to appear on ${device}`)
		await $`udevadm settle`

		// Check partitions actually exist
		const partitionsExist = await Promise.all([fse.pathExists(statePartition), fse.pathExists(dataPartition)])
		if (!partitionsExist[0]) throw new Error(`State partition ${statePartition} does not exist`)
		if (!partitionsExist[1]) throw new Error(`Data partition ${dataPartition} does not exist`)

		this.logger.log(`Successfully partitioned ${device}`)
		return {statePartition, dataPartition}
	}

	async #partitionAcceleratorDevice(
		device: string,
		sizes?: {l2arcSizeBytes: number; specialSizeBytes: number},
	): Promise<{statePartition: string; l2arcPartition: string; specialPartition: string}> {
		// Use the same state partition and front buffer as normal RAID devices.
		const isDiskById = device.startsWith('/dev/disk/by-umbrel-id/')
		if (!isDiskById) throw new Error('Must pass disk by id')

		this.logger.log(`Wiping signatures from accelerator device ${device}`)
		await $`wipefs --all ${device}`

		this.logger.log(`Creating partition table on accelerator device ${device}`)
		await $`sgdisk --zap-all ${device}`

		const oneMiB = 1024 * 1024
		const bufferSizeBytes = 10 * oneMiB
		const statePartitionSizeBytes = 100 * oneMiB

		const deviceSize = await getDeviceSize(device)
		const roundedDeviceSize = getRoundedDeviceSize(deviceSize)
		const usableBytes = roundedDeviceSize - statePartitionSizeBytes - bufferSizeBytes
		if (usableBytes <= 0) throw new Error('Accelerator device is too small to partition')

		// L2Arc partition is capped at 50% of device size or 5x RAM size, whichever is smaller
		// Since L2Arc stores redundant copies of data, we don't need to mirror it in FailSafe mode
		// so we stripe it. This means the total L2Arc size is 10x RAM or 100% of the accelerator
		// device size, whichever is smaller
		const requestedL2arcSizeBytes =
			sizes?.l2arcSizeBytes ?? Math.floor(Math.min(roundedDeviceSize * 0.5, os.totalmem() * 5))
		const l2arcSizeBytes = requestedL2arcSizeBytes
		if (l2arcSizeBytes <= 0) throw new Error('Accelerator device is too small for an L2ARC partition')

		// The special vdev uses the remaining space after the above. So either 50% of the device or 100% - 5x RAM.
		// The special vdev stores the master copy of it's data so we need to mirror in FailSafe mode and the size
		// does not increase with the second SSD.
		const specialSizeBytes = sizes?.specialSizeBytes ?? usableBytes - l2arcSizeBytes
		if (specialSizeBytes <= 0) throw new Error('Accelerator device is too small for a special partition')
		if (l2arcSizeBytes + specialSizeBytes > usableBytes)
			throw new Error('Accelerator device is too small for the requested partition sizes')

		const statePartitionSizeMiB = Math.floor(statePartitionSizeBytes / oneMiB)
		const l2arcPartitionSizeMiB = Math.floor(l2arcSizeBytes / oneMiB)
		const specialPartitionSizeMiB = Math.floor(specialSizeBytes / oneMiB)

		this.logger.log(
			`Accelerator size: ${deviceSize} bytes, rounded: ${roundedDeviceSize} bytes, l2arc: ${l2arcSizeBytes} bytes (${l2arcPartitionSizeMiB} MiB), special: ${specialSizeBytes} bytes (${specialPartitionSizeMiB} MiB)`,
		)

		await $`sgdisk --new=1:0:+${statePartitionSizeMiB}M --change-name=1:umbrel-raid-accelerator-state ${device}`
		await $`sgdisk --new=2:0:+${l2arcPartitionSizeMiB}M --change-name=2:umbrel-raid-l2arc ${device}`
		await $`sgdisk --new=3:0:+${specialPartitionSizeMiB}M --change-name=3:umbrel-raid-special ${device}`

		const statePartition = `${device}-part1`
		const l2arcPartition = `${device}-part2`
		const specialPartition = `${device}-part3`

		this.logger.log(`Waiting for accelerator partitions to appear on ${device}`)
		await $`udevadm settle`

		const partitionsExist = await Promise.all([
			fse.pathExists(statePartition),
			fse.pathExists(l2arcPartition),
			fse.pathExists(specialPartition),
		])
		if (!partitionsExist[0]) throw new Error(`State partition ${statePartition} does not exist`)
		if (!partitionsExist[1]) throw new Error(`L2ARC partition ${l2arcPartition} does not exist`)
		if (!partitionsExist[2]) throw new Error(`Special partition ${specialPartition} does not exist`)

		this.logger.log(`Successfully partitioned accelerator device ${device}`)
		return {statePartition, l2arcPartition, specialPartition}
	}

	// Create ZFS pool from data partitions with a given topology
	// For mirror topology, partitions are assumed to be in pairs
	async #createPool(poolName: string, dataPartitions: string[], topology: Topology): Promise<void> {
		// Build vdev specification from topology
		let vdevSpec = dataPartitions
		if (topology === 'raidz') {
			vdevSpec = ['raidz1', ...dataPartitions]
		} else if (topology === 'mirror') {
			vdevSpec = []
			for (let i = 0; i < dataPartitions.length; i += 2) {
				vdevSpec.push('mirror', dataPartitions[i], dataPartitions[i + 1])
			}
		}

		// Pool options (-o):
		//   ashift=12: 4K sectors (optimal for NVMe SSDs)
		//   autotrim=on: Enable automatic TRIM for SSDs
		//   autoexpand=on: Automatically expand pool when devices are replaced with larger ones
		//   cachefile=none: Don't write to /etc/zfs/zpool.cache since it won't exist before we've mounted the pool
		//   -m none: Don't mount the pool itself
		this.logger.log(`Creating ZFS pool '${poolName}' (${topology}) with partitions: ${dataPartitions.join(', ')}`)
		await $`zpool create -f -o ashift=12 -o autotrim=on -o autoexpand=on -o cachefile=none -m none ${poolName} ${vdevSpec}`
		this.logger.log(`ZFS pool '${poolName}' created successfully`)
	}

	// Create the data dataset on a pool
	async #createDataset(poolName: string): Promise<void> {
		// We use a hardcoded encryption password for now. This obviously doesn't provide any security.
		// However initialising encryption now means we can enable full disk encryption in the future
		// by simply updating the password to something secure without requiring an entire backup and restore
		// of all data into a new encrypted dataset.
		// Must be minimum 8 characters so we use umbrelumbrel.
		const defaultEncryptionPassword = 'umbrelumbrel'

		// Dataset options (-o):
		//   encryption=aes-256-gcm: Enable encryption with AES-256-GCM
		//   keyformat=passphrase: Use a passphrase for the encryption key
		//   keylocation=prompt: Key will be provided via stdin
		//   mountpoint=legacy: We want to handle mounting manually
		//   compression=lz4: Fastest compression for minimal overhead
		//   atime=off: Disable access time updates (significantly reduces writes)
		//   xattr=sa: Store extended attributes in inodes for significant performance gains.
		//   acltype=posixacl: Enable POSIX ACLs for proper permission handling.
		this.logger.log(`Creating data dataset on pool '${poolName}'`)
		await $({
			input: defaultEncryptionPassword,
		})`zfs create -o encryption=aes-256-gcm -o keyformat=passphrase -o keylocation=prompt -o mountpoint=legacy -o compression=lz4 -o atime=off -o xattr=sa -o acltype=posixacl ${poolName}/data`
		this.logger.log(`Encrypted dataset created successfully`)
	}

	// Setup RAID array from a list of devices
	// This will:
	// 1. Partition each device with a state partition and data partition (remaining space)
	// 2. Create a ZFS pool from all data partitions
	// 3. Write RAID config to boot partition to signal the boot process to mount the array
	async setup(deviceIds: string[], raidType: RaidType, acceleratorDeviceIds?: string[]): Promise<boolean> {
		if (deviceIds.length === 0) throw new Error('At least one device is required')
		if (raidType === 'failsafe' && deviceIds.length < 2) throw new Error('Failsafe mode requires at least two devices')

		const devices = deviceIds.map((id) => `/dev/disk/by-umbrel-id/${id}`)
		for (const device of devices) {
			if (!(await fse.pathExists(device))) throw new Error(`Device not found: ${device}`)
		}
		this.logger.log(`Setting up RAID with ${devices.length} device(s): ${devices.join(', ')}`)

		// Resolve and validate selected device type(s)
		const internalDevices = await this.#umbreld.hardware.internalStorage.getDevices()
		const selectedDeviceTypes = deviceIds.map((id) => internalDevices.find((device) => device.id === id)?.type)
		if (selectedDeviceTypes.some((deviceType) => deviceType === undefined))
			throw new Error('Could not determine device type for selected devices')
		const uniqueDeviceTypes = [...new Set(selectedDeviceTypes)]
		if (uniqueDeviceTypes.length > 1) throw new Error('Cannot mix SSDs and HDDs in the same RAID array')
		const [deviceType] = uniqueDeviceTypes
		if (!deviceType) throw new Error('Could not determine device type for selected devices')

		// HDD failsafe uses mirrors which require an even number of devices (one per mirror pair)
		if (raidType === 'failsafe' && deviceType === 'hdd' && deviceIds.length % 2 !== 0)
			throw new Error('HDD failsafe mode requires an even number of devices')

		if (acceleratorDeviceIds?.length) {
			if (deviceType !== 'hdd') throw new Error('Accelerators are only supported for HDD RAID arrays')

			const expectedCount = raidType === 'failsafe' ? 2 : 1
			if (acceleratorDeviceIds.length !== expectedCount)
				throw new Error(
					raidType === 'failsafe'
						? 'Failsafe mode requires exactly two SSDs for the accelerator'
						: 'Storage mode requires exactly one SSD for the accelerator',
				)

			const uniqueAcceleratorDeviceIds = new Set(acceleratorDeviceIds)
			if (uniqueAcceleratorDeviceIds.size !== acceleratorDeviceIds.length)
				throw new Error('Accelerator devices must be unique')

			const raidDeviceIds = new Set(deviceIds)
			for (const acceleratorDeviceId of acceleratorDeviceIds) {
				const acceleratorDevice = `/dev/disk/by-umbrel-id/${acceleratorDeviceId}`
				if (!(await fse.pathExists(acceleratorDevice))) throw new Error(`Device not found: ${acceleratorDevice}`)
				if (raidDeviceIds.has(acceleratorDeviceId)) throw new Error('Cannot add a RAID data device as an accelerator')
				await this.#assertAcceleratorDeviceType(acceleratorDeviceId)
			}
		}

		// Generate a unique pool name for this installation
		const poolName = this.generatePoolName()
		this.logger.log(`Generated unique pool name: ${poolName}`)

		// Partition all devices concurrently and collect data partitions
		this.logger.log(`Partitioning ${devices.length} device(s) concurrently`)
		const partitionResults = await Promise.all(devices.map((device) => this.#partitionDevice(device)))
		const dataPartitions = partitionResults.map((result) => result.dataPartition)
		this.logger.log(`All devices partitioned successfully`)

		// Determine pool topology based on raid type and device type
		let topology: Topology = 'stripe'
		if (raidType === 'failsafe' && deviceType === 'ssd') topology = 'raidz'
		if (raidType === 'failsafe' && deviceType === 'hdd') topology = 'mirror'

		// Create ZFS pool and data dataset
		await this.#createPool(poolName, dataPartitions, topology)
		await this.#createDataset(poolName)

		// Write RAID config to boot partition
		this.logger.log(`Writing RAID config to config partition`)
		await this.configStore.set('raid', {poolName, state: 'normal', raidType, devices})

		if (acceleratorDeviceIds?.length) await this.addAccelerator(acceleratorDeviceIds)

		this.logger.log('RAID setup complete')
		return true
	}

	// Assert that a device matches the type (SSD or HDD) of the RAID array
	async #assertDeviceTypeMatchesPool(deviceId: string): Promise<void> {
		const devices = await this.#umbreld.hardware.internalStorage.getDevices()
		const pool = await this.getStatus()
		const poolDeviceId = pool.devices?.[0]?.id
		if (!poolDeviceId) throw new Error("RAID array doesn't exist or has no devices")
		const newDevice = devices.find((d) => d.id === deviceId)
		const poolDevice = devices.find((d) => d.id === poolDeviceId)
		if (!newDevice) throw new Error(`Device not found: ${deviceId}`)
		if (!poolDevice) throw new Error(`Device not found: ${poolDeviceId}`)
		if (newDevice.type !== poolDevice.type) throw new Error(`Cannot mix SSDs and HDDs in the same RAID array`)
	}

	// Get the device type (SSD or HDD) of the RAID array based on its first device
	async #getPoolDeviceType(): Promise<'ssd' | 'hdd'> {
		const pool = await this.getStatus()
		const poolDeviceId = pool.devices?.[0]?.id
		if (!poolDeviceId) throw new Error("RAID array doesn't exist or has no devices")
		const devices = await this.#umbreld.hardware.internalStorage.getDevices()
		const device = devices.find((d) => d.id === poolDeviceId)
		if (!device) throw new Error(`Device not found: ${poolDeviceId}`)
		return device.type
	}

	async #getDeviceInfo(deviceId: string) {
		const devices = await this.#umbreld.hardware.internalStorage.getDevices()
		const device = devices.find((d) => d.id === deviceId)
		if (!device) throw new Error(`Device not found: ${deviceId}`)
		return device
	}

	async #assertAcceleratorDeviceType(deviceId: string): Promise<void> {
		const device = await this.#getDeviceInfo(deviceId)
		if (device.type !== 'ssd') throw new Error('Accelerator devices must be SSDs')
	}

	// Add one device to a stripe (storage) or raidz (failsafe SSD) array.
	// Mirror failsafe arrays must use addMirror().
	async addDevice(deviceId: string): Promise<boolean> {
		// Get the pool status
		const pool = await this.getStatus()
		if (!pool.exists) throw new Error("RAID array doesn't exist")
		if (pool.topology === 'mirror')
			throw new Error('addDevice is not supported for mirror failsafe mode, use addMirror')
		if (pool.topology !== 'stripe' && pool.topology !== 'raidz')
			throw new Error(`Unsupported RAID topology for addDevice: ${pool.topology}`)

		const poolDeviceIds = pool.devices?.map((d) => d.id) ?? []
		const device = `/dev/disk/by-umbrel-id/${deviceId}`

		// Validate device exists and isn't already in the pool
		if (!(await fse.pathExists(device))) throw new Error(`Device not found: ${device}`)
		if (poolDeviceIds.includes(deviceId)) throw new Error('Cannot add a device that is already in the RAID array')
		await this.#assertDeviceTypeMatchesPool(deviceId)

		this.logger.log(`Adding device to RAID array: ${device}`)

		// Partition the new device
		this.logger.log(`Partitioning device ${device}`)
		const {dataPartition} = await this.#partitionDevice(device)

		// Add the data partition to the existing pool
		if (pool.topology === 'raidz') {
			// Raidz failsafe: attach the new device to the existing raidz1 vdev
			this.logger.log(`Attaching ${dataPartition} to raidz1-0 in pool '${pool.name}'`)
			await $`zpool attach -f ${pool.name} raidz1-0 ${dataPartition}`
		} else {
			// Storage mode: add as new top-level vdev (stripe)
			this.logger.log(`Adding ${dataPartition} as stripe to pool '${pool.name}'`)
			await $`zpool add -f ${pool.name} ${dataPartition}`
		}

		// Update config with new device
		const updatedDevices = [...poolDeviceIds.map((id) => `/dev/disk/by-umbrel-id/${id}`), device]
		this.logger.log(`Updating RAID config with ${updatedDevices.length} device(s)`)
		await this.configStore.set('raid.devices', updatedDevices)

		this.logger.log(`Device added to RAID array successfully`)
		return true
	}

	// Add one mirror pair to a mirror (failsafe HDD) array.
	async addMirror(deviceIds: [string, string]): Promise<boolean> {
		// Get the pool status
		const pool = await this.getStatus()
		if (!pool.exists) throw new Error("RAID array doesn't exist")
		if (pool.topology !== 'mirror') throw new Error('addMirror is only supported for mirror failsafe mode')

		// Mirror pair must be two different devices
		if (deviceIds[0] === deviceIds[1]) throw new Error('Mirror pair requires two different devices')

		const poolDeviceIds = pool.devices?.map((d) => d.id) ?? []
		const devices = deviceIds.map((id) => `/dev/disk/by-umbrel-id/${id}`)

		// Validate both devices exist, aren't already in the pool, and match pool device type
		for (const deviceId of deviceIds) {
			const device = `/dev/disk/by-umbrel-id/${deviceId}`
			if (!(await fse.pathExists(device))) throw new Error(`Device not found: ${device}`)
			if (poolDeviceIds.includes(deviceId)) throw new Error('Cannot add a device that is already in the RAID array')
			await this.#assertDeviceTypeMatchesPool(deviceId)
		}

		this.logger.log(`Adding mirror pair to RAID array: ${devices.join(', ')}`)

		// Partition both new mirror devices
		this.logger.log(`Partitioning mirror pair devices: ${devices.join(', ')}`)
		const partitionResults = await Promise.all(devices.map((device) => this.#partitionDevice(device)))
		const [leftPartition, rightPartition] = partitionResults.map((result) => result.dataPartition)

		// Add the mirror vdev
		this.logger.log(`Adding mirror pair (${leftPartition}, ${rightPartition}) to pool '${pool.name}'`)
		await $`zpool add -f ${pool.name} mirror ${leftPartition} ${rightPartition}`

		// Update config with new devices
		const updatedDevices = [...poolDeviceIds.map((id) => `/dev/disk/by-umbrel-id/${id}`), ...devices]
		this.logger.log(`Updating RAID config with ${updatedDevices.length} device(s)`)
		await this.configStore.set('raid.devices', updatedDevices)

		this.logger.log(`Mirror pair added to RAID array successfully`)
		return true
	}

	// Add SSD accelerator device to an HDD pool.
	//
	// The SSD is partitioned into L2Arc (read cache) and special vdev (metadata + small blocks) partitions.
	// In FailSafe mode 2 SSDs are required: L2Arc is striped (data is volatile) but the special vdev is
	// mirrored (losing it means losing the entire pool).
	//
	// L2Arc is capped at 5x RAM (or 50% of device, whichever is smaller) per device. In FailSafe mode
	// this means 10x RAM total since L2Arc is striped across both devices. This prevents L2Arc entry
	// addressing from consuming too much L1Arc (RAM). At 128k block size, the 10x total cap results
	// in ~1% of memory dedicated to L2Arc addressing. The remainder of each device goes to the special vdev.
	//
	// We set special_small_blocks=32k so any block that compresses to ≤32k (or any file ≤32k total) lands
	// on the special vdev. This captures most OS/app files (configs, logs, container layers) while keeping
	// bulk data on HDDs. On a 2TB Umbrel dataset this is ~15GB. 64k would jump to ~150GB which is
	// unpredictable on larger/different workloads, so we stay conservative.
	async addAccelerator(deviceIds: string[]): Promise<boolean> {
		// Accelerators are layered on an existing HDD pool, never on SSD RAID.
		const pool = await this.getStatus()
		if (!pool.exists) throw new Error("RAID array doesn't exist")
		if ((await this.#getPoolDeviceType()) !== 'hdd')
			throw new Error('Accelerators are only supported for HDD RAID arrays')
		if (pool.accelerator?.exists) throw new Error('RAID array already has an accelerator')

		// Storage mode uses one SSD. Failsafe mirrors the special vdev, so it needs two.
		const expectedCount = pool.raidType === 'failsafe' ? 2 : 1
		if (deviceIds.length !== expectedCount)
			throw new Error(
				pool.raidType === 'failsafe'
					? 'Failsafe mode requires exactly two SSDs for the accelerator'
					: 'Storage mode requires exactly one SSD for the accelerator',
			)

		const uniqueDeviceIds = new Set(deviceIds)
		if (uniqueDeviceIds.size !== deviceIds.length) throw new Error('Accelerator devices must be unique')

		const poolDeviceIds = new Set(pool.devices?.map((d) => d.id) ?? [])
		const acceleratorDevices = deviceIds.map((id) => `/dev/disk/by-umbrel-id/${id}`)

		// Validate everything up front so we fail before touching partitions.
		for (const deviceId of deviceIds) {
			const device = `/dev/disk/by-umbrel-id/${deviceId}`
			if (!(await fse.pathExists(device))) throw new Error(`Device not found: ${device}`)
			if (poolDeviceIds.has(deviceId)) throw new Error('Cannot add a RAID data device as an accelerator')
			await this.#assertAcceleratorDeviceType(deviceId)
		}

		this.logger.log(`Adding accelerator to RAID array: ${acceleratorDevices.join(', ')}`)

		const partitionResults = await Promise.all(
			acceleratorDevices.map((device) => this.#partitionAcceleratorDevice(device)),
		)
		const l2arcPartitions = partitionResults.map((result) => result.l2arcPartition)
		const specialPartitions = partitionResults.map((result) => result.specialPartition)

		// L2ARC entries are independent. Only the special class is mirrored in failsafe mode.
		await $`zpool add -f ${pool.name} cache ${l2arcPartitions}`
		if (pool.raidType === 'failsafe') {
			await $`zpool add -f ${pool.name} special mirror ${specialPartitions[0]} ${specialPartitions[1]}`
		} else {
			await $`zpool add -f ${pool.name} special ${specialPartitions[0]}`
		}

		// Store not only metadata but also small blocks on the special vdev
		// 32k is very safe but we could consider 64k for users with very large special vdevs.
		await $`zfs set special_small_blocks=32K ${pool.name}`

		await this.configStore.set('raid.accelerator', {
			devices: acceleratorDevices,
		})

		this.logger.log('Accelerator added to RAID array successfully')
		return true
	}

	async #monitorReplaceProgress(
		poolName: string,
		completionCheck: (status: Awaited<ReturnType<Raid['getPoolStatus']>>) => boolean,
		onComplete?: () => Promise<void>,
	): Promise<void> {
		this.replaceStatus = {state: 'rebuilding', progress: 0}
		this.#umbreld.eventBus.emit('raid:replace-progress', this.replaceStatus)

		this.logger.log('Monitoring replace progress...')
		Promise.resolve()
			.then(async () => {
				while (true) {
					try {
						const status = await this.getPoolStatus(poolName)
						if (status.rebuild) {
							const cappedProgress = status.rebuild.state === 'finished' ? 100 : Math.min(status.rebuild.progress, 99)
							if (cappedProgress > (this.replaceStatus?.progress ?? 0)) {
								this.replaceStatus = {state: 'rebuilding', progress: cappedProgress}
								this.logger.log(`Replace progress: ${cappedProgress}%`)
								this.#umbreld.eventBus.emit('raid:replace-progress', this.replaceStatus)
							}
							if (status.rebuild.state === 'finished') break
						} else if (completionCheck(status)) {
							this.logger.log('No rebuild status but replacement target is online, considering complete')
							break
						}
					} catch (error) {
						this.logger.error('Error polling replace progress', error)
					}
					await setTimeout(1000)
				}

				if (onComplete) await onComplete()

				this.replaceStatus = {state: 'finished', progress: 100}
				this.logger.log('Replace complete')
				this.#umbreld.eventBus.emit('raid:replace-progress', this.replaceStatus)
				this.isReplacing = false
			})
			.catch((error) => {
				this.logger.error('Error monitoring replace progress', error)
				this.isReplacing = false
			})
	}

	async #replaceStorageDevice(
		pool: Awaited<ReturnType<Raid['getStatus']>>,
		oldDeviceId: string,
		newDeviceId: string,
	): Promise<boolean> {
		const oldDevice = `/dev/disk/by-umbrel-id/${oldDeviceId}`
		const newDevice = `/dev/disk/by-umbrel-id/${newDeviceId}`

		await this.#assertDeviceTypeMatchesPool(newDeviceId)

		this.logger.log(`Replacing device ${oldDevice} with ${newDevice}`)

		this.logger.log(`Partitioning new device: ${newDevice}`)
		const {dataPartition: newDataPartition} = await this.#partitionDevice(newDevice)
		const oldDataPartition = `${oldDevice}-part2`

		this.logger.log(`Replacing ${oldDataPartition} with ${newDataPartition} in pool '${pool.name}'`)
		await $`zpool replace -f ${pool.name} ${oldDataPartition} ${newDataPartition}`

		const currentDevices = (await this.configStore.get('raid.devices')) ?? []
		const updatedDevices = currentDevices.map((device: string) => (device === oldDevice ? newDevice : device))
		this.logger.log(`Updating RAID config with devices: ${updatedDevices.join(', ')}`)
		await this.configStore.set('raid.devices', updatedDevices)

		await this.#monitorReplaceProgress(
			pool.name,
			(status) => Boolean(status.devices?.some((d) => d.id === newDeviceId && d.status === 'ONLINE')),
			async () => {
				this.logger.log('Resilver complete, expanding new device...')
				await $`zpool online -e ${pool.name} ${newDataPartition}`.catch(() =>
					this.logger.error('Error expanding new device'),
				)
			},
		)

		this.logger.log(`Device replacement initiated, resilvering in progress`)
		return true
	}

	async #replaceAcceleratorDevice(
		pool: Awaited<ReturnType<Raid['getStatus']>>,
		oldDeviceId: string,
		newDeviceId: string,
	): Promise<boolean> {
		const oldDevice = `/dev/disk/by-umbrel-id/${oldDeviceId}`
		const newDevice = `/dev/disk/by-umbrel-id/${newDeviceId}`
		const acceleratorDeviceIds = pool.accelerator!.devices?.map((device) => device.id) ?? []

		await this.#assertAcceleratorDeviceType(newDeviceId)

		this.logger.log(`Replacing accelerator device ${oldDevice} with ${newDevice}`)

		const rawPool = await this.#getZpoolStatus(pool.name)
		if (!rawPool) throw new Error('Pool not found')
		const acceleratorDevices = this.#parsePoolAccelerator(rawPool).devices
		const acceleratorToReplace = acceleratorDevices.find((device) => device.id === oldDeviceId)
		if (!acceleratorToReplace) throw new Error(`Device ${oldDeviceId} is not in the accelerator`)
		const referenceAccelerator =
			pool.raidType === 'failsafe'
				? (acceleratorDevices.find((device) => device.id !== oldDeviceId) ?? acceleratorToReplace)
				: acceleratorToReplace

		const {l2arcPartition, specialPartition} = await this.#partitionAcceleratorDevice(newDevice, {
			l2arcSizeBytes: referenceAccelerator.l2arcSize,
			specialSizeBytes: referenceAccelerator.specialSize,
		})

		// Replace the old special vdev with the new one and resilver data over
		this.logger.log(
			`Replacing accelerator special partition ${acceleratorToReplace.specialPartition} with ${specialPartition} in pool '${pool.name}'`,
		)
		await $`zpool replace -f ${pool.name} ${acceleratorToReplace.specialPartition} ${specialPartition}`

		// Simply throw away the old l2arc vdev and add a new one, we don't need to resilver the data is volatile
		this.logger.log(
			`Removing accelerator cache partition ${acceleratorToReplace.l2arcPartition} from pool '${pool.name}'`,
		)
		await $`zpool remove ${pool.name} ${acceleratorToReplace.l2arcPartition}`

		this.logger.log(`Adding accelerator cache partition ${l2arcPartition} to pool '${pool.name}'`)
		await $`zpool add -f ${pool.name} cache ${l2arcPartition}`

		const currentAcceleratorDevices = (await this.configStore.get('raid.accelerator.devices')) ?? []
		const updatedAcceleratorDevices = currentAcceleratorDevices.map((device: string) =>
			device === oldDevice ? newDevice : device,
		)
		this.logger.log(`Updating RAID config with accelerator devices: ${updatedAcceleratorDevices.join(', ')}`)
		await this.configStore.set('raid.accelerator.devices', updatedAcceleratorDevices)

		const expectedAcceleratorDeviceIds = acceleratorDeviceIds.map((deviceId) =>
			deviceId === oldDeviceId ? newDeviceId : deviceId,
		)
		await this.#monitorReplaceProgress(pool.name, (status) => {
			const currentAcceleratorDeviceIds = status.accelerator?.devices?.map((device) => device.id).sort() ?? []
			return currentAcceleratorDeviceIds.join(',') === expectedAcceleratorDeviceIds.sort().join(',')
		})

		this.logger.log('Accelerator replacement initiated, resilvering in progress')
		return true
	}

	// Replace a storage or accelerator device in the RAID array.
	async replaceDevice(oldDeviceId: string, newDeviceId: string): Promise<boolean> {
		const newDevice = `/dev/disk/by-umbrel-id/${newDeviceId}`
		if (!(await fse.pathExists(newDevice))) throw new Error(`New device not found: ${newDevice}`)

		const pool = await this.getStatus()
		if (!pool.exists) throw new Error("RAID array doesn't exist")

		const poolDeviceIds = pool.devices?.map((d) => d.id) ?? []
		const acceleratorDeviceIds = pool.accelerator?.devices?.map((device) => device.id) ?? []

		if (poolDeviceIds.includes(newDeviceId))
			throw new Error('Cannot replace with a device that is already in the RAID array')
		if (acceleratorDeviceIds.includes(newDeviceId))
			throw new Error('Cannot replace with a device that is already in the accelerator')

		if (this.isReplacing) throw new Error('Already replacing device')
		this.isReplacing = true

		try {
			if (poolDeviceIds.includes(oldDeviceId)) return await this.#replaceStorageDevice(pool, oldDeviceId, newDeviceId)
			if (acceleratorDeviceIds.includes(oldDeviceId))
				return await this.#replaceAcceleratorDevice(pool, oldDeviceId, newDeviceId)
			throw new Error(`Device ${oldDeviceId} is not in the RAID array or accelerator`)
		} catch (error) {
			this.isReplacing = false
			throw error
		}
	}

	// Transition an SSD storage array to a failsafe (raidz1) array.
	// This creates a degraded raidz1 pool with the new disk and syncs data from the old pool.
	async transitionToFailsafeRaidz(newDeviceId: string): Promise<boolean> {
		// Verify we're in a state that can be migrated
		const pool = await this.getStatus()
		if (!pool.exists) throw new Error('No RAID array exists')
		if (pool.raidType !== 'storage') throw new Error('Can only transition from storage mode')

		// Raidz transition only supports SSD arrays with a single existing device
		const deviceType = await this.#getPoolDeviceType()
		if (deviceType !== 'ssd') throw new Error('transitionToFailsafeRaidz is only supported for SSD arrays')
		if (pool.devices?.length !== 1) throw new Error('Can only transition single-disk SSD arrays')

		// Validate new device exists, isn't in the pool, and matches pool type
		const newDevice = `/dev/disk/by-umbrel-id/${newDeviceId}`
		if (!(await fse.pathExists(newDevice))) throw new Error(`Device not found: ${newDevice}`)
		const poolDeviceIds = pool.devices?.map((d) => d.id) ?? []
		if (poolDeviceIds.includes(newDeviceId))
			throw new Error('Cannot transition with a device that is already in the RAID array')
		await this.#assertDeviceTypeMatchesPool(newDeviceId)

		// Check if new device is at least as large as the current device
		const currentDeviceId = pool.devices![0].id
		const currentDevice = `/dev/disk/by-umbrel-id/${currentDeviceId}`
		const currentDeviceSize = await getDeviceSize(currentDevice)
		const newDeviceSize = await getDeviceSize(newDevice)
		if (getRoundedDeviceSize(newDeviceSize) < getRoundedDeviceSize(currentDeviceSize))
			throw new Error('Cannot transition to a device smaller than the current device')

		if (this.isTransitioningToFailsafe) throw new Error('Already transitioning to failsafe mode')
		this.isTransitioningToFailsafe = true

		this.logger.log(`Starting raidz failsafe transition with ${newDevice}`)
		const migrationPoolName = `${pool.name}-migration`
		try {
			// Partition the new device
			this.logger.log(`Partitioning new device: ${newDevice}`)
			const {dataPartition: newDataPartition} = await this.#partitionDevice(newDevice)

			// Get the size of the existing data partition for creating the temp file
			const currentDeviceDataPartition = `${currentDevice}-part2`
			const currentDeviceDataPartitionSize = await getDeviceSize(currentDeviceDataPartition)

			// Create a sparse temp file the same size as the current device partition
			this.logger.log(
				`Creating sparse temp file: ${this.temporaryDevicePath} (${currentDeviceDataPartitionSize} bytes)`,
			)
			await $`truncate -s ${currentDeviceDataPartitionSize} ${this.temporaryDevicePath}`

			// Create the migration pool as raidz1 with new partition + temp file
			// ZFS can use a file path directly without needing a loopback device
			await this.#createPool(migrationPoolName, [newDataPartition, this.temporaryDevicePath], 'raidz')

			// Remove the temp file from the migration pool (making it degraded)
			this.logger.log(`Removing temp device from pool to create degraded raidz1`)
			await $`zpool offline ${migrationPoolName} ${this.temporaryDevicePath}`
			await fse.remove(this.temporaryDevicePath)

			// Create a snapshot of the active pool
			const baseSnapshot = 'migration'
			this.logger.log(`Creating snapshot: ${pool.name}@${baseSnapshot}`)
			await $`zfs snapshot -r ${pool.name}@${baseSnapshot}`

			// Get the estimated size of the snapshot to send (must match flags used in actual send)
			// Using --raw to preserve encryption (sends encrypted blocks without needing key loaded)
			this.logger.log('Estimating snapshot size...')
			const sizeResult =
				await $`zfs send --dryrun --raw --replicate --parsable --large-block --compressed ${pool.name}@${baseSnapshot}`
			const sizeOutput = sizeResult.stderr || sizeResult.stdout
			// --parsable outputs "size\t<bytes>" on the last line
			const sizeMatch = sizeOutput.match(/^size\s+(\d+)/m)
			const estimatedSize = sizeMatch ? parseInt(sizeMatch[1], 10) : 0
			this.logger.log(`Estimated snapshot size: ${estimatedSize} bytes`)

			// Initialize transition status
			this.failsafeTransitionStatus = {state: 'syncing', progress: 0}
			this.#umbreld.eventBus.emit('raid:failsafe-transition-progress', this.failsafeTransitionStatus)

			// Kick off non-blocking data migration to avoid blocking the API response
			this.logger.log('Starting async data migration...')
			Promise.resolve()
				.then(async () => {
					// Send the active pool snapshot to the migration pool
					// Using --raw to preserve encryption (sends encrypted blocks without needing key loaded)
					this.logger.log(`Sending snapshot to migration pool (this may take a while)...`)
					const sendProcess = $({
						shell: true,
					})`zfs send --raw --replicate --large-block --compressed ${pool.name}@${baseSnapshot} | zfs receive -Fu ${migrationPoolName}`

					// Poll progress while sending
					const stopProgressMonitor = runEvery(
						'1 second',
						async () => {
							try {
								const migrationStatus = await this.getPoolStatus(migrationPoolName)
								if (migrationStatus.exists && estimatedSize > 0) {
									const usedSpace = migrationStatus.usedSpace ?? 0
									// Scale sync progress to 0-49% (first half of transition)
									const rawProgress = Math.min(99, Math.floor((usedSpace / estimatedSize) * 100))
									const progress = Math.floor((rawProgress / 100) * 49)
									if (this.failsafeTransitionStatus && progress > this.failsafeTransitionStatus.progress) {
										this.logger.log(`Sync progress: ${progress}%`)
										this.failsafeTransitionStatus = {state: 'syncing', progress}
										this.#umbreld.eventBus.emit('raid:failsafe-transition-progress', this.failsafeTransitionStatus)
									}
								}
							} catch {
								// Ignore errors during progress polling
							}
						},
						{runInstantly: true},
					)

					try {
						await sendProcess
					} finally {
						stopProgressMonitor()
					}

					// Mark RAID config state as transitioning to failsafe
					// This allows easy detection by the boot script
					this.logger.log('Updating RAID config')
					await this.configStore.set('raid.state', 'transitioning-to-failsafe')

					// Emit rebooting state at 50% (rebuild will complete the remaining 50%)
					this.failsafeTransitionStatus = {state: 'rebooting', progress: 50}
					this.#umbreld.eventBus.emit('raid:failsafe-transition-progress', this.failsafeTransitionStatus)

					// Set status and wait 11 seconds before rebooting so the UI has time to poll
					// and show the restarting state (UI polls every 10 seconds)
					this.logger.log(`Initial sync complete, rebooting to complete migration`)
					setSystemStatus('restarting')
					await setTimeout(11_000)
					reboot()
				})
				.catch(async (error) => {
					// Reset system status in case we set it to restarting before the error
					setSystemStatus('running')

					// Emit error state
					this.failsafeTransitionStatus = {state: 'error', progress: 0, error: (error as Error).message}
					this.#umbreld.eventBus.emit('raid:failsafe-transition-progress', this.failsafeTransitionStatus)

					// Clean up on failure
					this.logger.error(`Migration failed, cleaning up...`, error)
					await $`zpool destroy ${migrationPoolName}`.catch(() => {})
					await $`zfs destroy -r ${pool.name}@migration`.catch(() => {})
					await fse.remove(this.temporaryDevicePath).catch(() => {})
					this.isTransitioningToFailsafe = false
				})

			return true
		} catch (error) {
			// Emit error state
			this.failsafeTransitionStatus = {state: 'error', progress: 0, error: (error as Error).message}
			this.#umbreld.eventBus.emit('raid:failsafe-transition-progress', this.failsafeTransitionStatus)

			// Clean up on failure
			this.logger.error(`Migration setup failed, cleaning up...`)
			await $`zpool destroy ${migrationPoolName}`.catch(() => {})
			await $`zfs destroy -r ${pool.name}@migration`.catch(() => {})
			await fse.remove(this.temporaryDevicePath).catch(() => {})
			this.isTransitioningToFailsafe = false
			throw error
		}
	}

	// Transition an HDD storage array to failsafe mirrors by attaching a new disk to each existing disk.
	// This is an in-place operation that does not require a reboot.
	async transitionToFailsafeMirror(
		pairs: FailsafeMirrorTransitionPair[],
		acceleratorDeviceId?: string,
	): Promise<boolean> {
		if (pairs.length === 0) throw new Error('At least one mirror pair is required')

		// Verify we're in a state that can be migrated
		const pool = await this.getStatus()
		if (!pool.exists) throw new Error('No RAID array exists')
		if (pool.raidType !== 'storage') throw new Error('Can only transition from storage mode')

		// Mirror transition only supports HDD arrays
		const deviceType = await this.#getPoolDeviceType()
		if (deviceType !== 'hdd') throw new Error('transitionToFailsafeMirror is only supported for HDD arrays')

		const existingDeviceIds = pool.devices?.map((d) => d.id) ?? []
		if (pairs.length !== existingDeviceIds.length)
			throw new Error(
				`Need exactly ${existingDeviceIds.length} mirror pair(s) to transition to failsafe mode, got ${pairs.length}`,
			)

		const existingPoolDeviceIds = new Set(existingDeviceIds)
		const seenExisting = new Set<string>()
		const seenNew = new Set<string>()

		for (const pair of pairs) {
			if (!existingPoolDeviceIds.has(pair.existingDeviceId))
				throw new Error(`Device ${pair.existingDeviceId} is not in the RAID array`)
			if (seenExisting.has(pair.existingDeviceId))
				throw new Error(`Duplicate existing device in mirror pairs: ${pair.existingDeviceId}`)
			if (seenNew.has(pair.newDeviceId)) throw new Error(`Duplicate new device in mirror pairs: ${pair.newDeviceId}`)
			if (existingPoolDeviceIds.has(pair.newDeviceId))
				throw new Error('Cannot transition with a device that is already in the RAID array')

			const newDevice = `/dev/disk/by-umbrel-id/${pair.newDeviceId}`
			if (!(await fse.pathExists(newDevice))) throw new Error(`Device not found: ${newDevice}`)

			await this.#assertDeviceTypeMatchesPool(pair.newDeviceId)

			seenExisting.add(pair.existingDeviceId)
			seenNew.add(pair.newDeviceId)
		}

		for (const existingDeviceId of existingDeviceIds) {
			if (!seenExisting.has(existingDeviceId))
				throw new Error(`Missing mirror pair for existing device: ${existingDeviceId}`)
		}

		// Validate each new device is at least as large as the existing device it mirrors
		for (const pair of pairs) {
			const existingDevice = `/dev/disk/by-umbrel-id/${pair.existingDeviceId}`
			const newDevice = `/dev/disk/by-umbrel-id/${pair.newDeviceId}`
			const existingSize = await getDeviceSize(existingDevice)
			const newSize = await getDeviceSize(newDevice)
			if (getRoundedDeviceSize(newSize) < getRoundedDeviceSize(existingSize))
				throw new Error('Cannot transition with a device smaller than an existing device')
		}

		// If we have an accelerator device, check we have a valid new accelerator device to mirror to
		const existingAccelerator = pool.accelerator
		const existingAcceleratorDeviceIds = existingAccelerator?.devices?.map((device) => device.id) ?? []
		const existingAcceleratorDevices = existingAcceleratorDeviceIds.map((id) => `/dev/disk/by-umbrel-id/${id}`)
		// Check the live pool status instead of config.
		if (existingAcceleratorDeviceIds.length > 0) {
			if (!acceleratorDeviceId)
				throw new Error(
					'Transitioning to failsafe with an accelerator requires an additional SSD for the accelerator mirror',
				)
			const existingAcceleratorIds = new Set(existingAcceleratorDeviceIds)
			if (
				existingPoolDeviceIds.has(acceleratorDeviceId) ||
				seenNew.has(acceleratorDeviceId) ||
				existingAcceleratorIds.has(acceleratorDeviceId)
			)
				throw new Error('Cannot reuse a RAID device as the accelerator mirror')

			const acceleratorDevice = `/dev/disk/by-umbrel-id/${acceleratorDeviceId}`
			if (!(await fse.pathExists(acceleratorDevice))) throw new Error(`Device not found: ${acceleratorDevice}`)
			await this.#assertAcceleratorDeviceType(acceleratorDeviceId)

			// Use the same rounded size check as normal RAID devices.
			const existingAcceleratorDevicePath = existingAcceleratorDevices[0]
			const existingAcceleratorSize = await getDeviceSize(existingAcceleratorDevicePath)
			const newAcceleratorSize = await getDeviceSize(acceleratorDevice)
			if (getRoundedDeviceSize(newAcceleratorSize) < getRoundedDeviceSize(existingAcceleratorSize))
				throw new Error('Cannot transition with an accelerator device smaller than the existing accelerator')
		} else if (acceleratorDeviceId) {
			throw new Error('Cannot supply an accelerator mirror SSD when no accelerator exists')
		}

		if (this.isTransitioningToFailsafe) throw new Error('Already transitioning to failsafe mode')
		this.isTransitioningToFailsafe = true

		const newDevices = pairs.map((pair) => `/dev/disk/by-umbrel-id/${pair.newDeviceId}`)
		this.logger.log(`Starting mirror failsafe transition with ${newDevices.join(', ')}`)

		try {
			// Partition all new devices
			this.logger.log(`Partitioning ${newDevices.length} new device(s)`)
			const partitionEntries = await Promise.all(
				pairs.map(async (pair) => {
					const newDevice = `/dev/disk/by-umbrel-id/${pair.newDeviceId}`
					const {dataPartition} = await this.#partitionDevice(newDevice)
					return [pair.newDeviceId, dataPartition] as const
				}),
			)
			const newDataPartitions = new Map(partitionEntries)

			// Attach each new device to the explicitly specified existing device
			for (const pair of pairs) {
				const existingPartition = `/dev/disk/by-umbrel-id/${pair.existingDeviceId}-part2`
				const newDataPartition = newDataPartitions.get(pair.newDeviceId)
				if (!newDataPartition) throw new Error(`Missing partition for device: ${pair.newDeviceId}`)

				this.logger.log(`Attaching ${newDataPartition} to ${existingPartition} in pool '${pool.name}'`)
				await $`zpool attach -f ${pool.name} ${existingPartition} ${newDataPartition}`
			}

			// If we have an existing accelerator device, mirror it against the new one
			if (existingAcceleratorDeviceIds.length > 0 && acceleratorDeviceId) {
				const newAcceleratorDevice = `/dev/disk/by-umbrel-id/${acceleratorDeviceId}`
				const existingL2arcPartition = `${existingAcceleratorDevices[0]}-part2`
				const existingSpecialPartition = `${existingAcceleratorDevices[0]}-part3`
				// Reuse the existing partition sizes.
				const {l2arcPartition, specialPartition} = await this.#partitionAcceleratorDevice(newAcceleratorDevice, {
					l2arcSizeBytes: await getDeviceSize(existingL2arcPartition),
					specialSizeBytes: await getDeviceSize(existingSpecialPartition),
				})

				this.logger.log(`Adding accelerator cache partition ${l2arcPartition} to pool '${pool.name}'`)
				await $`zpool add -f ${pool.name} cache ${l2arcPartition}`

				// Mirror the existing special vdev.
				this.logger.log(`Mirroring accelerator special vdev ${existingSpecialPartition} with ${specialPartition}`)
				await $`zpool attach -f ${pool.name} ${existingSpecialPartition} ${specialPartition}`
			}

			// Keep config order deterministic: existing pool order, then mirror partners in that same order
			const newDeviceByExisting = new Map(pairs.map((pair) => [pair.existingDeviceId, pair.newDeviceId]))
			const orderedNewDeviceIds = existingDeviceIds.map((existingDeviceId) => {
				const newDeviceId = newDeviceByExisting.get(existingDeviceId)
				if (!newDeviceId) throw new Error(`Missing mirror pair for existing device: ${existingDeviceId}`)
				return newDeviceId
			})

			// Update config with new RAID configuration
			const allDevices = [
				...existingDeviceIds.map((id) => `/dev/disk/by-umbrel-id/${id}`),
				...orderedNewDeviceIds.map((id) => `/dev/disk/by-umbrel-id/${id}`),
			]
			await this.configStore.getWriteLock(async ({set}) => {
				const raid = await this.configStore.get('raid')
				await set('raid', {
					...raid,
					raidType: 'failsafe',
					devices: allDevices,
					accelerator:
						existingAcceleratorDeviceIds.length > 0 && acceleratorDeviceId
							? {
									devices: [...existingAcceleratorDevices, `/dev/disk/by-umbrel-id/${acceleratorDeviceId}`],
								}
							: raid?.accelerator,
				})
			})

			// Initialize transition status and monitor rebuild progress in the background
			this.failsafeTransitionStatus = {state: 'rebuilding', progress: 0}
			this.#umbreld.eventBus.emit('raid:failsafe-transition-progress', this.failsafeTransitionStatus)

			Promise.resolve()
				.then(async () => {
					while (true) {
						try {
							const status = await this.getPoolStatus(pool.name)
							if (status.rebuild) {
								const cappedProgress = status.rebuild.state === 'finished' ? 100 : Math.min(status.rebuild.progress, 99)
								if (cappedProgress > (this.failsafeTransitionStatus?.progress ?? 0)) {
									this.failsafeTransitionStatus = {state: 'rebuilding', progress: cappedProgress}
									this.logger.log(`Mirror rebuild progress: ${cappedProgress}%`)
									this.#umbreld.eventBus.emit('raid:failsafe-transition-progress', this.failsafeTransitionStatus)
								}
								if (status.rebuild.state === 'finished') break
							} else {
								// No rebuild status means resilver completed before first poll
								const allOnline = status.devices?.every((d) => d.status === 'ONLINE')
								if (allOnline && (status.devices?.length ?? 0) > existingDeviceIds.length) break
							}
						} catch (error) {
							this.logger.error('Error polling mirror rebuild progress', error)
						}
						await setTimeout(1000)
					}

					this.failsafeTransitionStatus = {state: 'complete', progress: 100}
					this.logger.log('Mirror failsafe transition complete')
					this.#umbreld.eventBus.emit('raid:failsafe-transition-progress', this.failsafeTransitionStatus)
					this.isTransitioningToFailsafe = false
				})
				.catch((error) => {
					this.failsafeTransitionStatus = {state: 'error', progress: 0, error: (error as Error).message}
					this.#umbreld.eventBus.emit('raid:failsafe-transition-progress', this.failsafeTransitionStatus)
					this.isTransitioningToFailsafe = false
				})

			return true
		} catch (error) {
			this.failsafeTransitionStatus = {state: 'error', progress: 0, error: (error as Error).message}
			this.#umbreld.eventBus.emit('raid:failsafe-transition-progress', this.failsafeTransitionStatus)
			this.isTransitioningToFailsafe = false
			throw error
		}
	}

	// We run this on boot to check if there's an in progress transition and complete it.
	// The boot script does the minimum: final sync and pool rename
	// We complete the migration here: destroy old pool, re-partition old device, add it to the new pool
	async #completeFailsafeTransition(): Promise<void> {
		// Check config state first - this is the source of truth for transition status
		const raidState = await this.configStore.get('raid.state')
		if (raidState !== 'transitioning-to-failsafe') return

		const pool = await this.getStatus()
		const previousPoolName = `${pool.name}-previous-migration`

		// Verify the previous pool exists (should always exist if config says transitioning)
		const previousPool = await this.getPoolStatus(previousPoolName)
		if (!previousPool.exists) {
			this.logger.error('Config indicates transition in progress but previous pool not found')
			return
		}

		this.logger.log('Failsafe transition detected, finishing off migration')
		this.isTransitioningToFailsafe = true

		// Initialize transition status at 50% (sync phase complete, rebuild phase starting)
		this.failsafeTransitionStatus = {state: 'rebuilding', progress: 50}
		this.#umbreld.eventBus.emit('raid:failsafe-transition-progress', this.failsafeTransitionStatus)

		try {
			// Get the old device from the previous pool
			// We just grab the first device since the pool should only have one
			const oldDevice = previousPool.devices?.[0]?.id
			if (!oldDevice) throw new Error('Could not determine old device from previous migration pool')
			const oldDevicePath = `/dev/disk/by-umbrel-id/${oldDevice}`
			this.logger.log(`Old device: ${oldDevice}`)

			// Destroy the old pool
			this.logger.log('Destroying previous migration pool')
			await $`zpool destroy ${previousPoolName}`

			// Partition the old device
			this.logger.log(`Partitioning old device: ${oldDevice}`)
			const {dataPartition: oldDataPartition} = await this.#partitionDevice(oldDevicePath)

			// Replace the temp device with the old device partition in the new pool
			this.logger.log('Replacing temp device with old device in pool')
			await $`zpool replace -f ${pool.name} ${this.temporaryDevicePath} ${oldDataPartition}`

			// Update config with new RAID configuration
			this.logger.log('Updating RAID config')
			await this.configStore.getWriteLock(async ({set}) => {
				const pool = await this.getStatus()
				const devices = pool.devices!.map((device) => `/dev/disk/by-umbrel-id/${device.id}`)
				const raid = await this.configStore.get('raid')
				await set('raid', {
					...raid,
					raidType: 'failsafe',
					devices,
					state: 'normal',
				})
			})

			// Monitor rebuild progress until complete
			this.logger.log('Monitoring rebuild progress...')
			while (true) {
				try {
					const status = await this.getPoolStatus(pool.name)
					if (status.rebuild) {
						// Scale rebuild progress (0-100) to transition progress (51-99)
						const scaledProgress = 51 + Math.floor((status.rebuild.progress / 100) * 48)
						const cappedProgress = Math.min(scaledProgress, 99)
						if (cappedProgress > (this.failsafeTransitionStatus?.progress ?? 0)) {
							this.failsafeTransitionStatus = {state: 'rebuilding', progress: cappedProgress}
							this.logger.log(`Rebuild progress: ${cappedProgress}%`)
							this.#umbreld.eventBus.emit('raid:failsafe-transition-progress', this.failsafeTransitionStatus)
						}
						if (status.rebuild.state === 'finished') {
							this.failsafeTransitionStatus = {state: 'complete', progress: 100}
							this.logger.log('Rebuild progress: 100%')
							this.#umbreld.eventBus.emit('raid:failsafe-transition-progress', this.failsafeTransitionStatus)
							break
						}
					}
				} catch (error) {
					this.logger.error('Error polling rebuild progress', error)
				}
				await setTimeout(1000)
			}

			this.logger.log('Migration to failsafe mode complete')
		} catch (error) {
			this.failsafeTransitionStatus = {state: 'error', progress: 0, error: (error as Error).message}
			this.#umbreld.eventBus.emit('raid:failsafe-transition-progress', this.failsafeTransitionStatus)
			throw error
		} finally {
			// Clean up leftover snapshots
			this.logger.log('Cleaning up leftover snapshots')
			await $`zfs destroy -r ${pool.name}@migration`.catch((error) =>
				this.logger.error('Failed to destroy migration snapshot', error),
			)
			await $`zfs destroy -r ${pool.name}@migration-final`.catch((error) =>
				this.logger.error('Failed to destroy migration final snapshot', error),
			)

			// Reset state
			this.isTransitioningToFailsafe = false
		}
	}
}
