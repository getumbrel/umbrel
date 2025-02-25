import nodePath from 'node:path'

import {$} from 'execa'
import fse from 'fs-extra'
import PQueue from 'p-queue'

import type Umbreld from '../../index.js'
import isUmbrelHome from '../is-umbrel-home.js'

type LsblkDevice = {
	name: string
	kname: string
	label?: string | null
	type?: string
	mountpoints?: string[] | null
	tran?: string | null
	model?: string | null
	size?: number | null
	children?: LsblkDevice[]
	parttypename?: string
	serial?: string
}

type Disk = {
	id: string
	label: string
	size: number
}

type Partition = {
	id: string
	diskId: string
	mountpoints: string[]
	label: string
	size: number
}

type Mount = {
	diskId: string
	partitionId: string
	mountpoint: string
	label: string
	size: number
}

const mountQueue = new PQueue({concurrency: 1})

async function isSupported() {
	return await isUmbrelHome()
}

class ExternalStorage {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	disks: Map<string, Disk> = new Map()
	mounts: Map<string, Mount> = new Map()
	running = false

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLocaleLowerCase())
	}

	async start() {
		const supported = await isSupported()
		if (!supported) return
		this.logger.log(`Starting external storage`)
		this.#umbreld.dbus.udisks.addListener('change', this.#onUdisksChange)
		await this.updateMounts().catch((error) => this.logger.error(`Failed to update mounts: ${error.message}`))
		this.running = true
	}

	async stop() {
		if (!this.running) return
		this.running = false
		this.logger.log(`Stopping external storage`)
		this.#umbreld.dbus.udisks.removeListener('change', this.#onUdisksChange)

		// Unmount external partitions if possible. When an unmount fails, report
		// the error but still inform listeners so the mount no longer shows up.
		await mountQueue.add(async () => {
			for (const [id, {mountpoint}] of this.mounts) {
				const success = await unmountPartition(mountpoint)
				if (success) {
					this.logger.log(`Unmounted partition '${id}' at mountpoint '${mountpoint}'`)
					await fse
						.rmdir(mountpoint)
						.catch((error) => this.logger.error(`Failed to remove mountpoint '${mountpoint}': ${error.message}`))
				} else {
					this.logger.log(`Unable to unmount partition '${id}' at mountpoint '${mountpoint}', leaving as-is`)
				}
			}
			this.mounts.clear()
			this.disks.clear()
		})
	}

	get() {
		const disks = [...this.disks.entries()].map(([id, {label, size}]) => ({id, label, size}))
		return disks.map((disk) => {
			return {
				...disk,
				partitions: [...this.mounts.values()]
					.filter(({diskId}) => diskId === disk.id)
					.map(({mountpoint, label, size}) => ({
						mountpoint: this.#umbreld.files.mapSystemToVirtualPath(mountpoint),
						label,
						size,
					})),
			}
		})
	}

	async updateMounts() {
		await mountQueue.add(async () => {
			const {disks, partitions} = await getDisksAndPartitions()

			// Update list of external disks
			const disksWithPartitions = disks.filter((disk) => partitions.some((partition) => partition.diskId === disk.id))
			this.disks = new Map(disksWithPartitions.map((disk) => [disk.id, disk]))

			// Try to auto-mount any new partitions
			const seenPartitions = new Set<string>()
			for (let {id, diskId, mountpoints, label, size} of partitions) {
				const sanitisedLabel = label.replace(/[^a-zA-Z0-9 '\\!\\-]/g, '')
				let mountpoint = nodePath.join(this.#umbreld.files.mediaDirectory, sanitisedLabel)
				let mountIndex = 1
				while (Array.from(this.mounts.values()).some((mount) => mount.mountpoint === mountpoint)) {
					mountIndex++
					mountpoint = nodePath.join(this.#umbreld.files.mediaDirectory, `${sanitisedLabel} (${mountIndex})`)
				}
				seenPartitions.add(id)

				// If the partition is already mounted, check if we already mounted it
				// and register its presence. If it's mounted elsewhere, skip this
				// partition as it is not managed by us.
				if (mountpoints.length) {
					if (!this.mounts.has(id) && mountpoints.includes(mountpoint)) {
						this.mounts.set(id, {partitionId: id, diskId, mountpoint, label, size})
						this.logger.log(`Registering partition '${id}' at mountpoint '${mountpoint}'`)
					}
					continue
				}

				// Otherwise attempt to mount the partition. It is expected that not all
				// partitions can be mounted, so we are not reporting mount errors here.
				await fse
					.ensureDir(mountpoint)
					.catch((error) =>
						this.logger.error(`Failed to create mountpoint '${mountpoint}' for partition '${id}': ${error.message}`),
					)
				const success = await mountPartition(id, mountpoint)
				if (success) {
					this.mounts.set(id, {partitionId: id, diskId, mountpoint, label, size})
					this.logger.log(`Mounted partition '${id}' at mountpoint '${mountpoint}'`)
				} else {
					await fse.rmdir(mountpoint).catch(() => {})
				}
			}

			// Clean up mountpoints that have been removed
			for (const [id, {mountpoint}] of this.mounts) {
				if (seenPartitions.has(id)) continue
				let isMounted = await mountExists(mountpoint)
				if (isMounted) {
					const success = await unmountPartition(mountpoint)
					if (success) {
						isMounted = false
						await fse
							.rmdir(mountpoint)
							.catch((error) => this.logger.error(`Failed to remove mountpoint '${mountpoint}': ${error.message}`))
					}
				}
				if (!isMounted) {
					this.mounts.delete(id)
					this.logger.log(`Cleaned up partition '${id}' at mountpoint '${mountpoint}'`)
				}
			}

			// Clean up orphaned mountpoints
			const mountpointNames = await fse.readdir(this.#umbreld.files.mediaDirectory).catch(() => [])
			await Promise.all(
				mountpointNames.map(async (name) => {
					const mountpoint = nodePath.join(this.#umbreld.files.mediaDirectory, name)
					const isMounted = await mountExists(mountpoint)
					if (!isMounted) {
						await fse
							.rmdir(mountpoint)
							.catch((error) =>
								this.logger.error(`Failed to remove orphaned mountpoint '${mountpoint}': ${error.message}`),
							)
					}
				}),
			)
		})
	}

	async eject(diskId: string) {
		return await mountQueue.add(async () => {
			const disk = this.disks.get(diskId)
			if (!disk) return false

			this.logger.log(`Ejecting disk '${disk.id}'...`)

			// Unmount the disk's partitions
			let anyStillMounted = false
			for (const [id, {diskId, mountpoint}] of this.mounts) {
				if (diskId !== disk.id) continue
				let isMounted = await mountExists(mountpoint)
				if (isMounted) {
					const success = await unmountPartition(mountpoint)
					if (success) {
						this.logger.log(`Unmounted partition '${id}' of disk '${diskId}' at mountpoint '${mountpoint}'`)
						await fse
							.rmdir(mountpoint)
							.catch((error) => this.logger.error(`Failed to remove mountpoint '${mountpoint}': ${error.message}`))
						isMounted = false
					} else {
						this.logger.error(`Unable to unmount partition '${id}' of disk '${diskId}' at mountpoint '${mountpoint}'`)
					}
				} else {
					this.logger.verbose(`Partition '${id}' of disk '${diskId}' is already unmounted`)
				}
				if (!isMounted) {
					this.mounts.delete(id)
				} else {
					anyStillMounted = true
				}
			}

			// Discard the disk when all partitions have been unmounted
			if (!anyStillMounted) {
				const success = await discardDisk(disk.id)
				if (success) {
					this.disks.delete(disk.id)
					this.logger.log(`Discarded disk '${disk.id}'`)
				} else {
					this.logger.error(`Failed to discard disk '${disk.id}', assuming that it no longer exists`)
				}
				return true
			}
			this.logger.error(`Failed to eject disk '${disk.id}': Some partitions are still mounted`)
			return false
		})
	}

	#onUdisksChange = () => {
		this.updateMounts().catch((error) => this.logger.error(`Failed to update mounts: ${error.message}`))
	}

	async isExternalDriveConnectedOnNonUmbrelHome() {
		const isHome = await isUmbrelHome()
		const {disks} = await getDisksAndPartitions()

		// Exclude any external disks that include the current data directory.
		// This prevents USB storage based Raspberry Pi's detecting their main
		// USB storage drive as a connected external drive.
		const df = await $`df ${this.#umbreld.dataDirectory} --output=source`
		const dataDirDisk = df.stdout.split('\n').pop()?.split('/').pop()?.replace(/\d+$/, '')
		const externalDisks = disks.filter((disk) => disk.id !== dataDirDisk)

		return !isHome && externalDisks.length > 0
	}
}

export default ExternalStorage

async function getDisksAndPartitions() {
	const {stdout} = await $`lsblk --output-all --json --bytes`
	const {blockdevices} = JSON.parse(stdout) as {blockdevices: LsblkDevice[]}

	const disks: Disk[] = []
	const partitions: Partition[] = []

	function traverse(devices: LsblkDevice[], parentDisk?: LsblkDevice) {
		for (const device of devices) {
			const isUsb = parentDisk !== undefined || device.tran === 'usb'
			// We only want to deal with external devices, not internal ones
			if (!isUsb) continue

			// Skip EFI partitions since they're just confusing for users
			if (device?.parttypename === 'EFI System') continue

			if (device.type === 'disk') {
				disks.push({
					id: device.kname,
					label: device.model?.trim() || 'USB Disk',
					size: device.size ?? 0,
				})
				if (device.children && device.children.length > 0) {
					traverse(device.children, device)
				}
			} else if (parentDisk && device.type === 'part' && device.size) {
				partitions.push({
					id: device.kname,
					diskId: parentDisk.kname,
					mountpoints: device.mountpoints?.filter(Boolean) ?? [],
					label: device.label?.trim() || 'Untitled',
					size: device.size,
				})
			}
		}
	}
	traverse(blockdevices)
	return {disks, partitions}
}

async function mountExists(mountpoint: string) {
	const {exitCode} = await $({reject: false})`findmnt --noheadings ${mountpoint}`
	return exitCode === 0
}

async function mountPartition(id: string, mountpoint: string) {
	const {exitCode} = await $({reject: false})`mount /dev/${id} ${mountpoint}`
	return exitCode === 0
}

async function unmountPartition(mountpoint: string) {
	const {exitCode} = await $({reject: false})`umount --all-targets ${mountpoint}`
	return exitCode === 0
}

async function discardDisk(diskId: string) {
	try {
		await fse.writeFile(`/sys/block/${diskId}/device/delete`, '1')
		return true
	} catch {
		return false
	}
}
