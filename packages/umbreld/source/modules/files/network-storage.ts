import nodePath from 'node:path'
import {setTimeout} from 'node:timers/promises'

import fse from 'fs-extra'
import {$} from 'execa'
import ky from 'ky'

import {getHostname} from '../system/system.js'

import type Umbreld from '../../index.js'

type NetworkShare = {
	host: string
	share: string
	username: string
	password: string
	mountPath: string
}

export default class NetworkStorage {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	mountedShares: Set<string>
	shareWatchInterval = 1000 * 60 // One minute
	isRunning = false
	watchJobPromise?: Promise<void>

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(`files:${name.toLowerCase()}`)
		this.mountedShares = new Set()
	}

	async start() {
		this.isRunning = true
		this.watchJobPromise = this.#watchAndMountShares().catch((error) =>
			this.logger.error('Error watching and mounting shares', error),
		)
	}

	async stop() {
		this.logger.log('Stopping network storage')
		this.isRunning = false

		const ONE_SECOND = 1000

		// Wait for background job to finish
		if (this.watchJobPromise) {
			await Promise.race([
				setTimeout(ONE_SECOND * 10),
				(async () => {
					this.logger.log('Waiting for background job to finish')
					await this.watchJobPromise!.catch(() => {})
				})(),
			])
		}

		// Cleanup any currently mounted shares
		await Promise.race([
			setTimeout(ONE_SECOND * 10),
			(async () => {
				this.logger.log('Unmounting shares')
				await this.#unmountAllShares().catch((error) => this.logger.error('Error unmounting shares', error))
			})(),
		])
	}

	// List all shares from the store
	async getShares() {
		return (await this.#umbreld.store.get('files.networkStorage')) || []
	}

	// List all shares including mount status
	async getShareInfo() {
		const shares = await this.getShares()
		return shares.map(({host, share, mountPath}) => ({
			host,
			share,
			mountPath,
			isMounted: this.mountedShares.has(mountPath),
		}))
	}

	// Constantly check if shares are mounted and if not, mount them
	async #watchAndMountShares() {
		this.logger.log('Scheduling network share watch interval')
		let lastRun = 0
		while (this.isRunning) {
			await setTimeout(100)
			const shouldRun = Date.now() - lastRun >= this.shareWatchInterval
			if (!shouldRun) continue
			lastRun = Date.now()

			this.logger.verbose('Running network share watch interval')
			const shares = await this.getShares()
			await Promise.all(
				shares.map(async (share) => {
					try {
						if (await this.#isMounted(share)) {
							this.mountedShares.add(share.mountPath)
						} else {
							this.mountedShares.delete(share.mountPath)
							await this.#mountShare(share)
						}
					} catch (error) {}
				}),
			)
			this.logger.verbose('Network share watch interval complete')
		}
	}

	// Check if a share is mounted
	async #isMounted(share: NetworkShare): Promise<boolean> {
		try {
			const systemMountPath = await this.#umbreld.files.virtualToSystemPathUnsafe(share.mountPath)
			await $`mountpoint ${systemMountPath}`

			return true
		} catch (error) {
			return false
		}
	}

	// Attempt to mount a share
	async #mountShare(share: NetworkShare): Promise<void> {
		this.logger.log(`Mounting network share: ${share.mountPath}`)

		// Ensure mount directory exists
		const systemMountPath = this.#umbreld.files.virtualToSystemPathUnsafe(share.mountPath)
		await fse.ensureDir(systemMountPath)

		try {
			// Mount the network share
			const smbPath = `//${share.host}/${share.share}`
			const {userId, groupId} = this.#umbreld.files.fileOwner
			await $`mount -t cifs ${smbPath} ${systemMountPath} -o username=${share.username},password=${share.password},uid=${userId},gid=${groupId},iocharset=utf8`
			this.mountedShares.add(share.mountPath)
			this.logger.log(`Successfully mounted network share: ${smbPath} to ${share.mountPath}`)
		} catch (error) {
			// Clean up the directory we created if mount fails
			this.logger.error(`Failed to mount network share: ${share.mountPath}, cleaning up mount directory`)
			this.#unmountShare(share).catch((error) =>
				this.logger.error(`Failed to clean up mount directory after mount failure: ${share.mountPath}`, error),
			)

			// Re-throw the original mount error
			throw error
		}
	}

	// Unmount a share, don't throw on failure
	async #unmountShare(share: NetworkShare): Promise<void> {
		this.logger.log(`Unmounting network share: ${share.mountPath}`)
		try {
			// If we're mounted, unmount
			const systemMountPath = this.#umbreld.files.virtualToSystemPathUnsafe(share.mountPath)
			if (await this.#isMounted(share)) await $`umount ${systemMountPath}`

			// Clean up empty mount directory
			await fse.rmdir(systemMountPath)

			// Clean up parent dir if it's empty
			const parentDirectory = nodePath.dirname(systemMountPath)
			const parentFiles = await fse.readdir(parentDirectory)
			const isParentEmpty = parentFiles.length === 0
			const isParentChildOfNetwork =
				nodePath.dirname(parentDirectory) === this.#umbreld.files.getBaseDirectory('/Network')
			if (isParentEmpty && isParentChildOfNetwork) await fse.rmdir(parentDirectory)

			this.mountedShares.delete(share.mountPath)
			this.logger.log(`Successfully unmounted network share: ${share.mountPath}`)
		} catch (error) {
			this.logger.error(`Failed to unmount network share ${share.mountPath}`, error)
		}
	}

	// Unmount all shares concurrently
	async #unmountAllShares(): Promise<void> {
		const shares = await this.getShares()
		await Promise.all(shares.map(async (share) => this.#unmountShare(share)))
	}

	// Add a new share
	async addShare(newShare: Omit<NetworkShare, 'mountPath'>) {
		// Generate mount path
		const sanitize = (string: string) => string.replace(/[^a-zA-Z0-9\-\.\' \(\)]/g, '')
		const mountPath = `/Network/${sanitize(newShare.host)}/${sanitize(newShare.share)}`

		// Check if the share already exists
		const alreadyExists = await this.getShare(mountPath)
			.then(() => true)
			.catch(() => false)
		if (alreadyExists) throw new Error(`Share with mount path ${mountPath} already exists`)

		// Create share object
		const share: NetworkShare = {...newShare, mountPath}

		// Check we can mount the share
		await this.#mountShare(share)

		// Save new share in the store
		await this.#umbreld.store.getWriteLock(async ({set}) => {
			const shares = await this.getShares()
			if (shares.find((existingShare) => existingShare.mountPath === share.mountPath)) return
			shares.push(share)
			await set('files.networkStorage', shares)
		})

		return share.mountPath
	}

	// Get a share by mount path
	async getShare(mountPath: string) {
		const shares = await this.getShares()
		const share = shares.find((share) => share.mountPath === mountPath)
		if (!share) throw new Error(`Share with mount path ${mountPath} not found`)
		return share
	}

	// Remove a share
	async removeShare(sharePath: string) {
		const share = await this.getShare(sharePath)

		// Attempt to unmount the share first
		await this.#unmountShare(share)

		// Remove the share from the store
		await this.#umbreld.store.getWriteLock(async ({set}) => {
			const shares = await this.getShares()
			const newShares = shares.filter((existingShare) => existingShare.mountPath !== sharePath)
			await set('files.networkStorage', newShares)
		})

		return true
	}

	// Discover available servers
	// Used to help the user find servers if they don't already know the address
	async discoverServers() {
		const avahiBrowse = await $`avahi-browse --resolve --terminate _smb._tcp --parsable`

		const hostname = await getHostname().catch(() => '')

		const servers = avahiBrowse.stdout
			.split('\n')
			// Grab mDNS domain name
			.map((line) => line.split(';')[6])
			// Filter out empty values
			.filter((line) => typeof line === 'string' && line !== '')
			// Filter out the current hostname
			.filter((line) => line !== `${hostname}.local`)

		// Only return each address once
		return Array.from(new Set(servers))
	}

	// Discover shares for a given samba server
	// Used to help the user find share names if they don't already know them
	async discoverSharesOnServer(host: string, username: string, password: string) {
		// TODO: Figure out if we can speed this up
		// The command usually returns data quite quickly but then hangs for like 10 seconds
		// and returns some weird compatibility error. Is there some way we can disable whatever
		// is causing the hang so we can get the command to return as soon as we have the info
		// we care about?
		const smbclient = await $`smbclient --list //${host} --user ${username} --password ${password} --grepable`

		const shares = smbclient.stdout
			// Process line by line
			.split('\n')
			// Filter out any lines that don't have 3 '|' separated columns
			.filter((line) => line.split('|').length === 3)
			// Grab the second column (the share name)
			.map((line) => line.split('|')[1])
			// Filter out the IPC$ share that Samba always creates
			.filter((share) => share !== 'IPC$')

		return shares
	}

	// Checks if the given network address is an Umbrel device
	async isServerAnUmbrelDevice(address: string) {
		try {
			const responseText = (await ky(`http://${address}/trpc/system.version`, {timeout: 1000}).text()) as any
			return responseText.toLowerCase().includes('umbrel')
		} catch {
			return false
		}
	}
}
