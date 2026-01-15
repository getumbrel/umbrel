import fse from 'fs-extra'

import {$} from 'execa'

import type Umbreld from '../../index.js'
import FileStore from '../utilities/file-store.js'
import {reboot} from '../system/system.js'

// Get the size of a block device or partition in bytes
async function getDeviceSize(device: string): Promise<number> {
	const {stdout} = await $`lsblk --output SIZE --bytes --nodeps --noheadings ${device}`
	return parseInt(stdout.trim(), 10)
}

export type RaidType = 'storage' | 'failsafe'

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
	state: 'ACTIVE' | 'FINISHED' | 'CANCELED'
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
		devices: string[]
		raidType: RaidType
	}
}

export default class Raid {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	configStore: FileStore<ConfigStore>
	isTransitioningToFailsafe = false
	failsafeTransitionError?: Error
	initialRaidSetupError?: Error
	poolName = 'umbrelos'
	temporaryDevicePath = '/tmp/umbrelos-temporary-migration-device.img'

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(`hardware:${name.toLowerCase()}`)

		// Create a file store for the config file with hooks to handle read-only partition
		// TODO: Move this to a more appropriate place.
		const configPartition = '/run/rugix/mounts/config'
		const configFile = `${configPartition}/umbrel.yaml`
		this.configStore = new FileStore<ConfigStore>({
			filePath: configFile,
			onBeforeWrite: async () => {
				await $`mount -o remount,rw ${configPartition}`
			},
			onAfterWrite: async () => {
				await $`mount -o remount,ro ${configPartition}`
			},
		})
	}

	async hasConfigStore() {
		return await fse.pathExists(this.configStore.filePath)
	}

	async start() {
		this.logger.log('Starting RAID')

		// Handle initial RAID setup after first boot with the new array
		await this.handlePostBootRaidSetupProcess().catch((error) =>
			this.logger.error('Failed to handle initial RAID setup boot', error),
		)

		// Check if we are currently transitioning to failsafe mode and complete the migration
		await this.#completeFailsafeTransition().catch((error) => {
			this.logger.error('Failed to complete FailSafe transition:', error)
			this.failsafeTransitionError = error as Error
		})

		// TODO: Monitor and report scrub progress

		// TODO: Monitor and report resilver progress

		// TODO: Monitor and report expansion progress

		// TODO: Monthly scrub
	}

	async stop() {
		this.logger.log('Stopping RAID')
	}

	// Get status of the main RAID pool with migration error if any
	async getStatus() {
		const status = await this.getPoolStatus(this.poolName)
		return {
			...status,
			failsafeTransitionError: this.failsafeTransitionError?.message,
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
		await reboot()
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

	// Create GPT partition table and partitions on a device
	async #partitionDevice(device: string): Promise<{statePartition: string; dataPartition: string}> {
		const isDiskById = device.startsWith('/dev/disk/by-id/')
		if (!isDiskById) throw new Error('Must pass disk by id')

		this.logger.log(`Wiping signatures from ${device}`)
		await $`wipefs --all ${device}`

		// Create partition table and partitions using sgdisk
		// Partition 1: State partition (100MB)
		// Partition 2: Data partition (remaining space, 0 means use all available)
		// TODO: Check if we need to leave headroom for varying sized drives. It looks like actually they don't vary much
		// but MB/MiB is the problem.
		this.logger.log(`Creating partition table on ${device}`)
		await $`sgdisk --zap-all ${device}`

		const statePartitionSizeMb = 100
		this.logger.log(`Creating state partition (${statePartitionSizeMb}MB) on ${device}`)
		await $`sgdisk --new=1:0:+${statePartitionSizeMb}M --change-name=1:umbrel-raid-state ${device}`

		this.logger.log(`Creating data partition on ${device}`)
		await $`sgdisk --new=2:0:0 ${device}`

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
		//   cachefile=none: Don't write to /etc/zfs/zpool.cache since it won't exist before we've mounted the pool
		//   -m none: Don't mount the pool itself
		this.logger.log(`Creating ZFS pool '${poolName}' (${raidType}) with partitions: ${dataPartitions.join(', ')}`)
		const vdevType = raidType === 'failsafe' ? ['raidz1'] : []
		await $`zpool create -f -o ashift=12 -o autotrim=on -o cachefile=none -m none ${poolName} ${vdevType} ${dataPartitions}`
		this.logger.log(`ZFS pool '${poolName}' created successfully`)
	}

	// Create the data dataset on a pool
	async #createDataset(poolName: string): Promise<void> {
		// Dataset options (-o):
		//   mountpoint=legacy: We want to handle mounting manually
		//   compression=lz4: Fastest compression for minimal overhead
		//   atime=off: Disable access time updates (significantly reduces writes)
		//   xattr=sa: Store extended attributes in inodes for significant performance gains.
		//   acltype=posixacl: Enable POSIX ACLs for proper permission handling.
		this.logger.log(`Creating data dataset on pool '${poolName}'`)
		await $`zfs create -o mountpoint=legacy -o compression=lz4 -o atime=off -o xattr=sa -o acltype=posixacl ${poolName}/data`
		this.logger.log(`Main dataset created successfully`)
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

		// Partition all devices concurrently and collect data partitions
		this.logger.log(`Partitioning ${devices.length} device(s) concurrently`)
		const partitionResults = await Promise.all(devices.map((device) => this.#partitionDevice(device)))
		const dataPartitions = partitionResults.map((result) => result.dataPartition)
		this.logger.log(`All devices partitioned successfully`)

		// Create ZFS pool and data dataset
		await this.#createPool(this.poolName, dataPartitions, raidType)
		await this.#createDataset(this.poolName)

		// Write RAID config to boot partition
		this.logger.log(`Writing RAID config to config partition`)
		await this.configStore.set('raid', {devices, raidType})

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
	// TODO: Allow transitioningfrom storage mode to failsafe mode
	async addDevice(deviceId: string): Promise<boolean> {
		// Convert device ID to full path and verify it exists
		const device = `/dev/disk/by-id/${deviceId}`
		const exists = await fse.pathExists(device)
		if (!exists) throw new Error(`Device not found: ${device}`)

		this.logger.log(`Adding device to RAID array: ${device}`)

		// Get current devices from config
		const currentDevices = (await this.configStore.get('raid.devices')) ?? []
		if (currentDevices.includes(device)) throw new Error(`Device ${device} is already in the RAID array`)

		// Get the pool status
		const pool = await this.getPoolStatus(this.poolName)
		if (!pool.exists) throw new Error("RAID array doesn't exist")

		// Partition the new device
		this.logger.log(`Partitioning device: ${device}`)
		const {dataPartition} = await this.#partitionDevice(device)

		// Add the data partition to the existing pool
		this.logger.log(`Adding partition ${dataPartition} to pool '${this.poolName}'`)
		// For failsafe mode, attach the new device to the existing raidz1 vdev
		if (pool.raidType === 'failsafe') await $`zpool attach ${this.poolName} raidz1-0 ${dataPartition}`
		// For storage mode, add the new device as a new top-level vdev
		else if (pool.raidType === 'storage') await $`zpool add ${this.poolName} ${dataPartition}`

		// Update config with new device
		const updatedDevices = [...currentDevices, device]
		this.logger.log(`Updating RAID config with ${updatedDevices.length} device(s)`)
		await this.configStore.set('raid.devices', updatedDevices)

		this.logger.log(`Device ${device} added to RAID array successfully`)
		return true
	}

	// Transition a single-disk storage array to a failsafe (raidz1) array
	// This creates a degraded raidz1 pool with the new disk and syncs data from the old pool
	async transitionToFailsafe(newDeviceId: string): Promise<boolean> {
		const newDevice = `/dev/disk/by-id/${newDeviceId}`
		if (!(await fse.pathExists(newDevice))) throw new Error(`Device not found: ${newDevice}`)

		// Verify we're in a state that can be migrated
		const pool = await this.getPoolStatus(this.poolName)
		if (!pool.exists) throw new Error('No RAID array exists')
		if (pool.raidType !== 'storage') throw new Error('Can only transition from storage mode')
		if (pool.devices?.length !== 1) throw new Error('Can only transition single-disk arrays')

		if (this.isTransitioningToFailsafe) throw new Error('Already transitioning to failsafe mode')
		this.isTransitioningToFailsafe = true

		this.logger.log(`Starting transition to failsafe mode with ${newDevice}`)
		const migrationPoolName = `${this.poolName}-migration`
		try {
			// Partition the new device
			this.logger.log(`Partitioning new device: ${newDevice}`)
			const {dataPartition: newDataPartition} = await this.#partitionDevice(newDevice)

			// Get the size of the new partition for creating the temp file
			const partitionSize = await getDeviceSize(newDataPartition)
			this.logger.log(`New partition size: ${partitionSize} bytes`)

			// Create a sparse temp file the same size as the new partition
			this.logger.log(`Creating sparse temp file: ${this.temporaryDevicePath} (${partitionSize} bytes)`)
			await $`truncate -s ${partitionSize} ${this.temporaryDevicePath}`

			// Create the migration pool as raidz1 with new partition + temp file
			// ZFS can use a file path directly without needing a loopback device
			await this.#createPool(migrationPoolName, [newDataPartition, this.temporaryDevicePath], 'failsafe')

			// Remove the temp file from the migration pool (making it degraded)
			this.logger.log(`Removing temp device from pool to create degraded raidz1`)
			await $`zpool offline ${migrationPoolName} ${this.temporaryDevicePath}`
			await fse.remove(this.temporaryDevicePath)

			// Create a snapshot of the active pool
			const baseSnapshot = 'migration'
			this.logger.log(`Creating snapshot: ${this.poolName}@${baseSnapshot}`)
			await $`zfs snapshot -r ${this.poolName}@${baseSnapshot}`

			// Send the active pool snapshot to the migration pool
			this.logger.log(`Sending snapshot to migration pool (this may take a while)...`)
			await $({shell: true})`zfs send -R ${this.poolName}@${baseSnapshot} | zfs receive -Fu ${migrationPoolName}`

			this.logger.log(`Initial sync complete, rebooting to complete migration`)
			setTimeout(() => reboot(), 1000) // Schedule in 1 second so the api response has time to be sent
			return true
		} catch (error) {
			// Clean up on failure
			this.logger.error(`Migration failed, cleaning up...`)
			await $`zpool destroy ${migrationPoolName}`.catch(() => {})
			await $`zfs destroy -r ${this.poolName}@migration`.catch(() => {})
			await fse.remove(this.temporaryDevicePath).catch(() => {})
			throw error
		} finally {
			this.isTransitioningToFailsafe = false
		}
	}

	// We run this on boot to check if there's an in progress transition and complete it.
	// The boot script does the minimum: final sync and pool rename
	// We complete the migration here: destroy old pool, re-partition old device, add it to the new pool
	async #completeFailsafeTransition(): Promise<void> {
		const previousPoolName = `${this.poolName}-previous-migration`

		// Check if we have a transition in progress
		const previousPool = await this.getPoolStatus(previousPoolName)
		if (!previousPool.exists) return

		this.logger.log('Failsafe transition detected, finishing off migration')

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
		await $`zpool replace ${this.poolName} ${this.temporaryDevicePath} ${oldDataPartition}`

		// Update config with new RAID configuration
		this.logger.log('Updating RAID config')
		const pool = await this.getPoolStatus(this.poolName)
		await this.configStore.set('raid', {
			devices: pool.devices!.map((device) => device.id),
			raidType: 'failsafe',
		})

		// Clean up leftover snapshots
		this.logger.log('Cleaning up leftover snapshots')
		await $`zfs destroy -r ${this.poolName}@migration`.catch((error) =>
			this.logger.error('Failed to destroy migration snapshot', error),
		)
		await $`zfs destroy -r ${this.poolName}@migration-final`.catch((error) =>
			this.logger.error('Failed to destroy migration final snapshot', error),
		)

		this.logger.log('Migration to failsafe mode complete')
	}
}
