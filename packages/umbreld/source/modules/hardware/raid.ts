import crypto from 'node:crypto'
import {setTimeout} from 'node:timers/promises'

import fse from 'fs-extra'
import {$} from 'execa'
import pRetry from 'p-retry'

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
// This ensures drives of slightly different sizes can be used together in RAID
export function getRoundedDeviceSize(sizeInBytes: number): number {
	const oneTerabyte = 1_000_000_000_000
	const twoFiftyGigabytes = 250_000_000_000
	if (sizeInBytes >= oneTerabyte) {
		return Math.floor(sizeInBytes / twoFiftyGigabytes) * twoFiftyGigabytes
	}
	return sizeInBytes
}

export type RaidType = 'storage' | 'failsafe'

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

export type ReplaceStatus = {
	state: 'rebuilding' | 'expanding' | 'finished' | 'canceled'
	progress: number
}

// Types for zpool status --json --json-int --json-flat-vdevs output
type State = 'ONLINE' | 'DEGRADED' | 'FAULTED' | 'OFFLINE' | 'UNAVAIL' | 'REMOVED'
type Vdev = {
	vdev_type: 'root' | 'raidz' | 'mirror' | 'disk'
	path?: string
	rep_dev_size?: number
	phys_space?: number
	slow_ios?: number
	name: string
	guid: number
	class: string
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
		expansion?: ExpansionStatus
		rebuild?: RebuildStatus
	}> {
		// Get pool status from ZFS
		let pool
		try {
			const {stdout} = await $`zpool status --json --json-int --json-flat-vdevs ${poolName}`
			const zpoolStatus = JSON.parse(stdout) as ZpoolStatusOutput
			pool = zpoolStatus.pools?.[poolName]
		} catch {}
		if (!pool) return {exists: false}

		const vdevs = Object.values(pool.vdevs)

		// Determine RAID type from topology
		const isRaidz = vdevs.some((v) => v.vdev_type === 'raidz')
		const raidType = isRaidz ? 'failsafe' : 'storage'

		// Filter vdevs by type
		const rootVdev = vdevs.find((v) => v.vdev_type === 'root')
		const diskVdevs = vdevs.filter((v) => v.vdev_type === 'disk')

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

		return {
			exists: true,
			raidType,
			totalSpace: rootVdev.total_space,
			usableSpace: rootVdev.def_space,
			usedSpace: rootVdev.alloc_space,
			freeSpace: rootVdev.def_space - rootVdev.alloc_space,
			status: pool.state,
			devices: diskVdevs.map((device) => ({
				id: device.path!.replace('/dev/disk/by-id/', '').replace(/-part\d+$/, ''),
				size: device.rep_dev_size,
				status: device.state,
				readErrors: device.read_errors,
				writeErrors: device.write_errors,
				checksumErrors: device.checksum_errors,
			})),
			expansion,
			rebuild,
		}
	}

	// Trigger initial RAID setup boot process
	async triggerInitialRaidSetupBootFlow(
		raidDevices: string[],
		raidType: RaidType,
		user: {name: string; password: string; language: string},
	) {
		// Setup the RAID array
		await this.setup(raidDevices, raidType)

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
		const {stdout} = await $`zpool import -N`
		const expectedDevices = ((await this.configStore.get('raid.devices')) ?? []) as string[]

		return expectedDevices.map((device) => {
			const name = device.replace('/dev/disk/by-id/', '')
			const isOk = stdout.split('\n').some((line) => line.includes(name) && line.includes('ONLINE'))
			return {name, isOk}
		})
	}

	// Create GPT partition table and partitions on a device
	async #partitionDevice(device: string): Promise<{statePartition: string; dataPartition: string}> {
		const isDiskById = device.startsWith('/dev/disk/by-id/')
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

		// Get device size and round down to nearest 250GB if over 1TB
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

	// Create ZFS pool from data partitions
	async #createPool(poolName: string, dataPartitions: string[], raidType: RaidType): Promise<void> {
		// Pool options (-o):
		//   ashift=12: 4K sectors (optimal for NVMe SSDs)
		//   autotrim=on: Enable automatic TRIM for SSDs
		//   autoexpand=on: Automatically expand pool when devices are replaced with larger ones
		//   cachefile=none: Don't write to /etc/zfs/zpool.cache since it won't exist before we've mounted the pool
		//   -m none: Don't mount the pool itself
		this.logger.log(`Creating ZFS pool '${poolName}' (${raidType}) with partitions: ${dataPartitions.join(', ')}`)
		const vdevType = raidType === 'failsafe' ? ['raidz1'] : []
		await $`zpool create -f -o ashift=12 -o autotrim=on -o autoexpand=on -o cachefile=none -m none ${poolName} ${vdevType} ${dataPartitions}`
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
	async setup(deviceIds: string[], raidType: RaidType): Promise<boolean> {
		if (deviceIds.length === 0) throw new Error('At least one device is required')
		if (raidType === 'failsafe' && deviceIds.length < 2) throw new Error('Failsafe mode requires at least two devices')

		const devices = deviceIds.map((id) => `/dev/disk/by-id/${id}`)
		for (const device of devices) {
			if (!(await fse.pathExists(device))) throw new Error(`Device not found: ${device}`)
		}
		this.logger.log(`Setting up RAID with ${devices.length} device(s): ${devices.join(', ')}`)

		// Generate a unique pool name for this installation
		const poolName = this.generatePoolName()
		this.logger.log(`Generated unique pool name: ${poolName}`)

		// Partition all devices concurrently and collect data partitions
		this.logger.log(`Partitioning ${devices.length} device(s) concurrently`)
		const partitionResults = await Promise.all(devices.map((device) => this.#partitionDevice(device)))
		const dataPartitions = partitionResults.map((result) => result.dataPartition)
		this.logger.log(`All devices partitioned successfully`)

		// Create ZFS pool and data dataset
		await this.#createPool(poolName, dataPartitions, raidType)
		await this.#createDataset(poolName)

		// Write RAID config to boot partition
		this.logger.log(`Writing RAID config to config partition`)
		await this.configStore.set('raid', {poolName, state: 'normal', raidType, devices})

		this.logger.log('RAID setup complete')
		return true
	}

	// Add a new device to an existing RAID array
	// This will:
	// 1. Partition the device with a state partition and data partition
	// 2. Add the data partition to the existing ZFS pool
	//    - For storage mode: adds as new top-level vdev (stripe)
	//    - For failsafe mode: expands the existing raidz1 vdev
	// 3. Update RAID config in boot partition
	async addDevice(deviceId: string): Promise<boolean> {
		// Convert device ID to full path and verify it exists
		const device = `/dev/disk/by-id/${deviceId}`
		const exists = await fse.pathExists(device)
		if (!exists) throw new Error(`Device not found: ${device}`)

		this.logger.log(`Adding device to RAID array: ${device}`)

		// Get the pool status
		const pool = await this.getStatus()
		if (!pool.exists) throw new Error("RAID array doesn't exist")

		// Check if device is already in the array
		const poolDeviceIds = pool.devices?.map((d) => d.id) ?? []
		if (poolDeviceIds.includes(deviceId)) throw new Error('Cannot add a device that is already in the RAID array')

		// Partition the new device
		this.logger.log(`Partitioning device: ${device}`)
		const {dataPartition} = await this.#partitionDevice(device)

		// Add the data partition to the existing pool
		this.logger.log(`Adding partition ${dataPartition} to pool '${pool.name}'`)
		// For failsafe mode, attach the new device to the existing raidz1 vdev
		if (pool.raidType === 'failsafe') await $`zpool attach -f ${pool.name} raidz1-0 ${dataPartition}`
		// For storage mode, add the new device as a new top-level vdev
		else if (pool.raidType === 'storage') await $`zpool add -f ${pool.name} ${dataPartition}`

		// Update config with new device
		const updatedDevices = [...poolDeviceIds, device]
		this.logger.log(`Updating RAID config with ${updatedDevices.length} device(s)`)
		await this.configStore.set('raid.devices', updatedDevices)

		this.logger.log(`Device ${device} added to RAID array successfully`)
		return true
	}

	// Replace a device in the RAID array with a new device
	// This will:
	// 1. Partition the new device with a state partition and data partition
	// 2. Use zpool replace to swap the old device with the new one
	// 3. Update RAID config in boot partition
	// Works for both storage and failsafe modes. ZFS will resilver the new device.
	async replaceDevice(oldDeviceId: string, newDeviceId: string): Promise<boolean> {
		const oldDevice = `/dev/disk/by-id/${oldDeviceId}`
		const newDevice = `/dev/disk/by-id/${newDeviceId}`

		// Verify new device exists
		if (!(await fse.pathExists(newDevice))) throw new Error(`New device not found: ${newDevice}`)

		// Get the pool status - this is the source of truth for what devices are in the pool
		const pool = await this.getStatus()
		if (!pool.exists) throw new Error("RAID array doesn't exist")

		// Verify old device is in the pool and new device is not
		const poolDeviceIds = pool.devices?.map((d) => d.id) ?? []
		if (!poolDeviceIds.includes(oldDeviceId)) throw new Error(`Device ${oldDeviceId} is not in the RAID array`)
		if (poolDeviceIds.includes(newDeviceId))
			throw new Error('Cannot replace with a device that is already in the RAID array')

		if (this.isReplacing) throw new Error('Already replacing device')
		this.isReplacing = true
		this.logger.log(`Replacing device ${oldDevice} with ${newDevice}`)

		try {
			// Partition the new device
			this.logger.log(`Partitioning new device: ${newDevice}`)
			const {dataPartition: newDataPartition} = await this.#partitionDevice(newDevice)

			// Get the old data partition path
			const oldDataPartition = `${oldDevice}-part2`

			// Replace the device in the pool
			// ZFS will automatically start resilvering the new device
			this.logger.log(`Replacing ${oldDataPartition} with ${newDataPartition} in pool '${pool.name}'`)
			await $`zpool replace -f ${pool.name} ${oldDataPartition} ${newDataPartition}`

			// Initialize replace status
			this.replaceStatus = {state: 'rebuilding', progress: 0}
			this.#umbreld.eventBus.emit('raid:replace-progress', this.replaceStatus)

			// Kick off non-blocking monitoring to avoid blocking the API response
			this.logger.log('Monitoring replace progress...')
			Promise.resolve()
				.then(async () => {
					// Poll rebuild status until complete
					while (true) {
						try {
							const status = await this.getPoolStatus(pool.name)
							if (status.rebuild) {
								// Cap progress at 99% until fully complete (state === 'finished')
								const cappedProgress = status.rebuild.state === 'finished' ? 100 : Math.min(status.rebuild.progress, 99)
								if (cappedProgress > (this.replaceStatus?.progress ?? 0)) {
									this.replaceStatus = {state: 'rebuilding', progress: cappedProgress}
									this.logger.log(`Replace progress: ${cappedProgress}%`)
									this.#umbreld.eventBus.emit('raid:replace-progress', this.replaceStatus)
								}
								if (status.rebuild.state === 'finished') {
									break
								}
							} else {
								// No rebuild status - check if new device is in pool and online
								// This handles the case where resilver completes before first poll
								const newDeviceInPool = status.devices?.some((d) => d.id === newDeviceId && d.status === 'ONLINE')
								if (newDeviceInPool) {
									this.logger.log('No rebuild status but new device is online, considering complete')
									break
								}
							}
						} catch (error) {
							this.logger.error('Error polling replace progress', error)
						}
						await setTimeout(1000)
					}

					// Expand the new device to its full size
					// This makes sure the new size is recognized if it's larger than the old size
					this.logger.log('Resilver complete, expanding new device...')
					await $`zpool online -e ${pool.name} ${newDataPartition}`.catch(() =>
						this.logger.error('Error expanding new device'),
					)

					// Mark as finished
					this.replaceStatus = {state: 'finished', progress: 100}
					this.logger.log('Replace complete')
					this.#umbreld.eventBus.emit('raid:replace-progress', this.replaceStatus)
					this.isReplacing = false
				})
				.catch((error) => {
					this.logger.error('Error monitoring replace progress', error)
					this.isReplacing = false
				})
		} catch (error) {
			this.isReplacing = false
			throw error
		}

		// Update config with new device list
		const currentDevices = (await this.configStore.get('raid.devices')) ?? []
		const updatedDevices = currentDevices.map((d: string) => (d === oldDevice ? newDevice : d))
		this.logger.log(`Updating RAID config with devices: ${updatedDevices.join(', ')}`)
		await this.configStore.set('raid.devices', updatedDevices)

		this.logger.log(`Device replacement initiated, resilvering in progress`)
		return true
	}

	// Transition a single-disk storage array to a failsafe (raidz1) array
	// This creates a degraded raidz1 pool with the new disk and syncs data from the old pool
	async transitionToFailsafe(newDeviceId: string): Promise<boolean> {
		const newDevice = `/dev/disk/by-id/${newDeviceId}`
		if (!(await fse.pathExists(newDevice))) throw new Error(`Device not found: ${newDevice}`)

		// Verify we're in a state that can be migrated
		const pool = await this.getStatus()
		if (!pool.exists) throw new Error('No RAID array exists')
		if (pool.raidType !== 'storage') throw new Error('Can only transition from storage mode')
		if (pool.devices?.length !== 1) throw new Error('Can only transition single-disk arrays')

		// Check if device is already in the array
		const poolDeviceIds = pool.devices?.map((d) => d.id) ?? []
		if (poolDeviceIds.includes(newDeviceId))
			throw new Error('Cannot transition with a device that is already in the RAID array')

		// Check if new device is at least as large as the current device
		const currentDeviceId = pool.devices![0].id
		const currentDevice = `/dev/disk/by-id/${currentDeviceId}`
		const currentDeviceSize = await getDeviceSize(currentDevice)
		const newDeviceSize = await getDeviceSize(newDevice)
		if (getRoundedDeviceSize(newDeviceSize) < getRoundedDeviceSize(currentDeviceSize))
			throw new Error('Cannot transition to a device smaller than the current device')

		if (this.isTransitioningToFailsafe) throw new Error('Already transitioning to failsafe mode')
		this.isTransitioningToFailsafe = true

		this.logger.log(`Starting transition to failsafe mode with ${newDevice}`)
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
			await this.#createPool(migrationPoolName, [newDataPartition, this.temporaryDevicePath], 'failsafe')

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
									// usedSpace is raw allocation including raidz1 parity overhead
									// Calculate overhead factor (totalSpace/usableSpace) to convert to actual data
									const overheadFactor =
										migrationStatus.totalSpace && migrationStatus.usableSpace
											? migrationStatus.totalSpace / migrationStatus.usableSpace
											: 2 // Default to 2 for 2-disk raidz1
									const usedSpace = migrationStatus.usedSpace ?? 0
									const actualDataWritten = usedSpace / overheadFactor
									// Scale sync progress to 0-49% (first half of transition)
									const rawProgress = Math.min(99, Math.floor((actualDataWritten / estimatedSize) * 100))
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
			const oldDevicePath = `/dev/disk/by-id/${oldDevice}`
			if (!oldDevice) throw new Error('Could not determine old device from previous migration pool')
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
				const devices = pool.devices!.map((device) => device.id)
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
