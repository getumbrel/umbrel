import fse from 'fs-extra'

import {$} from 'execa'

import type Umbreld from '../../index.js'
import FileStore from '../utilities/file-store.js'

// TODO: Keep all this data in sync in the config partition when it changes in the OS
type ConfigStore = {
	user?: {
		name: string
		hashedPassword?: string
		password?: string
		language: string
	}
	raid?: {
		devices: string[]
	}
}

export default class Raid {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	configStore: FileStore<ConfigStore>

	poolName = 'umbrelos'

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

	async start() {
		this.logger.log('Starting RAID')

		// TODO: Monthly scrub
	}

	async stop() {
		this.logger.log('Stopping RAID')
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
	async #createPool(dataPartitions: string[]): Promise<void> {
		// Create pool with no RAID (JBOD/striping) - empty raid type means stripe
		// Pool options (-o):
		//   ashift=12: 4K sectors (optimal for NVMe SSDs)
		//   autotrim=on: Enable automatic TRIM for SSDs
		//   cachefile=none: Don't write to /etc/zfs/zpool.cache since it won't exist before we've mounted the pool
		//   -m none: Don't mount the pool itself
		this.logger.log(`Creating ZFS pool '${this.poolName}' with partitions: ${dataPartitions.join(', ')}`)
		await $`zpool create -f -o ashift=12 -o autotrim=on -o cachefile=none -m none ${this.poolName} ${dataPartitions}`

		// Create the data dataset with NVMe-optimized options
		// Dataset options (-o):
		//   mountpoint=legacy: We want to handle mounting manually
		//   compression=lz4: Fastest compression for minimal overhead
		//   atime=off: Disable access time updates (significantly reduces writes)
		//   xattr=sa: Store extended attributes in inodes for significant performance gains.
		//   acltype=posixacl: Enable POSIX ACLs for proper permission handling.
		this.logger.log(`Creating data dataset on pool '${this.poolName}'`)
		await $`zfs create -o mountpoint=legacy -o compression=lz4 -o atime=off -o xattr=sa -o acltype=posixacl ${this.poolName}/data`

		this.logger.log(`ZFS pool '${this.poolName}' created successfully`)
	}

	// Setup RAID array from a list of devices
	// This will:
	// 1. Partition each device with a state partition and data partition (remaining space)
	// 2. Create a ZFS pool from all data partitions in JBOD/stripe mode
	// 3. Write RAID config to boot partition to signal the boot process to mount the array
	// TODO: Add different RAID levels
	async setup(deviceIds: string[]): Promise<boolean> {
		if (deviceIds.length === 0) throw new Error('At least one device is required')

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

		// Create ZFS pool from all data partitions
		await this.#createPool(dataPartitions)

		// Write RAID config to boot partition
		this.logger.log(`Writing RAID config to config partition`)
		await this.configStore.set('raid.devices', devices)

		this.logger.log('RAID setup complete')
		return true
	}

	// Add a new device to an existing RAID array
	// This will:
	// 1. Partition the device with a state partition and data partition
	// 2. Add the data partition to the existing ZFS pool
	// 3. Update RAID config in boot partition
	async addDevice(deviceId: string): Promise<boolean> {
		// Convert device ID to full path and verify it exists
		const device = `/dev/disk/by-id/${deviceId}`
		const exists = await fse.pathExists(device)
		if (!exists) throw new Error(`Device not found: ${device}`)

		this.logger.log(`Adding device to RAID array: ${device}`)

		// Get current devices from config
		const currentDevices = (await this.configStore.get('raid.devices')) ?? []
		if (currentDevices.includes(device)) throw new Error(`Device ${device} is already in the RAID array`)

		// Partition the new device
		this.logger.log(`Partitioning device: ${device}`)
		const {dataPartition} = await this.#partitionDevice(device)

		// Add the data partition to the existing pool
		this.logger.log(`Adding partition ${dataPartition} to pool '${this.poolName}'`)
		await $`zpool add ${this.poolName} ${dataPartition}`

		// Update config with new device
		const updatedDevices = [...currentDevices, device]
		this.logger.log(`Updating RAID config with ${updatedDevices.length} device(s)`)
		await this.configStore.set('raid.devices', updatedDevices)

		this.logger.log(`Device ${device} added to RAID array successfully`)
		return true
	}
}
