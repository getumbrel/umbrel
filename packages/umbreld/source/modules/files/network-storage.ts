import os from 'node:os'
import nodePath from 'node:path'
import {randomBytes} from 'node:crypto'
import {setTimeout} from 'node:timers/promises'

import fse from 'fs-extra'
import {$} from 'execa'
import ky from 'ky'

import {getHostname} from '../system/system.js'

import {
	assertRcloneAvailable,
	buildWebdavRemote,
	mountRemote,
	obscurePassword,
	unmountRemote,
} from './remote-mount/rclone.js'

import type Umbreld from '../../index.js'

export type NetworkShareProtocol = 'smb' | 'webdav'

export type NetworkShare = {
	protocol: NetworkShareProtocol
	host: string
	share: string
	username: string
	password: string
	mountPath: string
	url?: string
}

type NewSmbShare = {
	protocol: 'smb'
	host: string
	share: string
	username: string
	password: string
}

type NewWebdavShare = {
	protocol: 'webdav'
	url: string
	username: string
	password: string
	label?: string
}

export type NewNetworkShare = NewSmbShare | NewWebdavShare

const sanitizeMountSegment = (string: string) => string.replace(/[^a-zA-Z0-9\-\.\' \(\)]/g, '')

function normalizeShare(share: NetworkShare & {protocol?: NetworkShareProtocol}): NetworkShare {
	return {
		...share,
		protocol: share.protocol ?? 'smb',
	}
}

export function getWebdavHostKey(url: string) {
	const parsed = new URL(url)
	const defaultPort = parsed.protocol === 'https:' ? '443' : '80'
	const port = parsed.port || defaultPort
	if (port === defaultPort) return parsed.hostname
	return `${parsed.hostname}-${port}`
}

function parseWebdavDisplay(url: string, label?: string) {
	const host = getWebdavHostKey(url)
	const pathLabel = label?.trim() || new URL(url).pathname.split('/').filter(Boolean).pop() || 'WebDAV'
	return {host, share: pathLabel}
}

function buildMountPath(host: string, share: string) {
	return `/Network/${sanitizeMountSegment(host)}/${sanitizeMountSegment(share)}`
}

function mountPathToStorageId(mountPath: string) {
	return mountPath.replace(/^\//, '').replace(/\//g, '__')
}

function getWebdavConfigPath(dataDirectory: string, mountPath: string) {
	return nodePath.join(dataDirectory, 'secrets', 'rclone', `${mountPathToStorageId(mountPath)}.conf`)
}

function getWebdavCacheDirectory(dataDirectory: string, mountPath: string) {
	return nodePath.join(dataDirectory, 'cache', 'rclone-vfs', mountPathToStorageId(mountPath))
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
		const shares = await this.getShares()
		if (shares.some((share) => share.protocol === 'webdav')) {
			await assertRcloneAvailable().catch((error) => {
				this.logger.error('rclone is required for WebDAV network shares but is not available', error)
			})
		}

		this.isRunning = true
		this.watchJobPromise = this.#watchAndMountShares().catch((error) =>
			this.logger.error('Error watching and mounting shares', error),
		)
	}

	async stop() {
		this.logger.log('Stopping network storage')
		this.isRunning = false

		const ONE_SECOND = 1000

		if (this.watchJobPromise) {
			await Promise.race([
				setTimeout(ONE_SECOND * 10),
				(async () => {
					this.logger.log('Waiting for background job to finish')
					await this.watchJobPromise!.catch(() => {})
				})(),
			])
		}

		await Promise.race([
			setTimeout(ONE_SECOND * 10),
			(async () => {
				this.logger.log('Unmounting shares')
				await this.#unmountAllShares().catch((error) => this.logger.error('Error unmounting shares', error))
			})(),
		])
	}

	async getShares() {
		const shares = ((await this.#umbreld.store.get('files.networkStorage')) || []) as Array<
			NetworkShare & {protocol?: NetworkShareProtocol}
		>
		return shares.map(normalizeShare)
	}

	async getShareInfo() {
		const shares = await this.getShares()
		return shares.map(({protocol, host, share, mountPath, url}) => ({
			protocol,
			host,
			share,
			mountPath,
			url,
			isMounted: this.mountedShares.has(mountPath),
		}))
	}

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
					} catch (error) {
						this.logger.error(`Failed to keep network share mounted: ${share.mountPath}`, error)
					}
				}),
			)
			this.logger.verbose('Network share watch interval complete')
		}
	}

	async #isMounted(share: NetworkShare): Promise<boolean> {
		try {
			const systemMountPath = await this.#umbreld.files.virtualToSystemPathUnsafe(share.mountPath)
			await $`mountpoint ${systemMountPath}`

			return true
		} catch (error) {
			return false
		}
	}

	async #mountShare(share: NetworkShare): Promise<void> {
		this.logger.log(`Mounting network share: ${share.mountPath}`)

		if (/[\r\n]/.test(share.username) || /[\r\n]/.test(share.password)) {
			throw new Error('Network share username and password cannot contain newlines')
		}

		const systemMountPath = this.#umbreld.files.virtualToSystemPathUnsafe(share.mountPath)
		await fse.ensureDir(systemMountPath)

		try {
			if (share.protocol === 'webdav') {
				await this.#mountWebdavShare(share, systemMountPath)
			} else {
				await this.#mountSmbShare(share, systemMountPath)
			}

			this.mountedShares.add(share.mountPath)
			this.logger.log(`Successfully mounted network share: ${share.mountPath}`)
		} catch (error) {
			this.logger.error(`Failed to mount network share: ${share.mountPath}, cleaning up mount directory`)
			this.#unmountShare(share).catch((cleanupError) =>
				this.logger.error(`Failed to clean up mount directory after mount failure: ${share.mountPath}`, cleanupError),
			)

			throw error
		}
	}

	async #mountSmbShare(share: NetworkShare, systemMountPath: string) {
		const smbPath = `//${share.host}/${share.share}`
		const {userId, groupId} = this.#umbreld.files.fileOwner
		const credentialsDirectory = await fse.mkdtemp(nodePath.join(os.tmpdir(), 'umbrel-cifs-credentials-'))

		try {
			const credentialsPath = nodePath.join(credentialsDirectory, 'credentials')
			await fse.writeFile(credentialsPath, `username=${share.username}\npassword=${share.password}\n`, {mode: 0o600})
			await $`mount -t cifs ${smbPath} ${systemMountPath} -o credentials=${credentialsPath},uid=${userId},gid=${groupId},iocharset=utf8`
		} finally {
			await fse.remove(credentialsDirectory).catch(() => {})
		}
	}

	async #mountWebdavShare(share: NetworkShare, systemMountPath: string) {
		if (!share.url) throw new Error('[invalid-webdav-url]')

		const remoteName = `umbrel-webdav-${randomBytes(4).toString('hex')}`
		const obscuredPassword = await obscurePassword(share.password)
		const remote = buildWebdavRemote(remoteName, {
			url: share.url,
			username: share.username,
			obscuredPassword,
		})
		const {userId, groupId} = this.#umbreld.files.fileOwner

		const configPath = getWebdavConfigPath(this.#umbreld.dataDirectory, share.mountPath)
		const cacheDirectory = getWebdavCacheDirectory(this.#umbreld.dataDirectory, share.mountPath)

		await mountRemote(remote, {systemMountPath, userId, groupId, configPath, cacheDirectory})
	}

	async #unmountShare(share: NetworkShare): Promise<void> {
		this.logger.log(`Unmounting network share: ${share.mountPath}`)
		try {
			const systemMountPath = this.#umbreld.files.virtualToSystemPathUnsafe(share.mountPath)
			if (await this.#isMounted(share)) {
				if (share.protocol === 'webdav') {
					await unmountRemote(systemMountPath, {
						cleanupPaths: {
							configPath: getWebdavConfigPath(this.#umbreld.dataDirectory, share.mountPath),
							cacheDirectory: getWebdavCacheDirectory(this.#umbreld.dataDirectory, share.mountPath),
						},
					})
				} else {
					await $`umount ${systemMountPath}`
				}
			}

			await fse.rmdir(systemMountPath)

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

	async #unmountAllShares(): Promise<void> {
		const shares = await this.getShares()
		await Promise.all(shares.map(async (share) => this.#unmountShare(share)))
	}

	async addShare(newShare: NewNetworkShare) {
		const share = this.#buildShare(newShare)
		const alreadyExists = await this.getShare(share.mountPath)
			.then(() => true)
			.catch(() => false)
		if (alreadyExists) throw new Error(`Share with mount path ${share.mountPath} already exists`)

		await this.#mountShare(share)

		await this.#umbreld.store.getWriteLock(async ({set}) => {
			const shares = await this.getShares()
			if (shares.find((existingShare) => existingShare.mountPath === share.mountPath)) return
			shares.push(share)
			await set('files.networkStorage', shares)
		})

		return share.mountPath
	}

	#buildShare(newShare: NewNetworkShare): NetworkShare {
		if (newShare.protocol === 'webdav') {
			let parsedUrl: URL
			try {
				parsedUrl = new URL(newShare.url)
			} catch {
				throw new Error('[invalid-webdav-url]')
			}
			if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('[invalid-webdav-url]')

			const {host, share} = parseWebdavDisplay(newShare.url, newShare.label)
			return {
				protocol: 'webdav',
				host,
				share,
				url: newShare.url,
				username: newShare.username,
				password: newShare.password,
				mountPath: buildMountPath(host, share),
			}
		}

		return {
			protocol: 'smb',
			host: newShare.host,
			share: newShare.share,
			username: newShare.username,
			password: newShare.password,
			mountPath: buildMountPath(newShare.host, newShare.share),
		}
	}

	async getShare(mountPath: string) {
		const shares = await this.getShares()
		const share = shares.find((share) => share.mountPath === mountPath)
		if (!share) throw new Error(`Share with mount path ${mountPath} not found`)
		return share
	}

	async removeShare(sharePath: string) {
		const share = await this.getShare(sharePath)

		await this.#unmountShare(share)

		await this.#umbreld.store.getWriteLock(async ({set}) => {
			const shares = await this.getShares()
			const newShares = shares.filter((existingShare) => existingShare.mountPath !== sharePath)
			await set('files.networkStorage', newShares)
		})

		return true
	}

	async discoverServers() {
		const avahiBrowse = await $`avahi-browse --resolve --terminate _smb._tcp --parsable`

		const hostname = await getHostname().catch(() => '')

		const servers = avahiBrowse.stdout
			.split('\n')
			.map((line) => line.split(';')[6])
			.filter((line) => typeof line === 'string' && line !== '')
			.filter((line) => line !== `${hostname}.local`)

		return Array.from(new Set(servers))
	}

	async discoverSharesOnServer(host: string, username: string, password: string) {
		const smbclient = await $`smbclient --list //${host} --user ${username} --password ${password} --grepable`

		const shares = smbclient.stdout
			.split('\n')
			.filter((line) => line.split('|').length === 3)
			.map((line) => line.split('|')[1])
			.filter((share) => share !== 'IPC$')

		return shares
	}

	async isServerAnUmbrelDevice(address: string) {
		try {
			const responseText = (await ky(`http://${address}/trpc/system.version`, {timeout: 1000}).text()) as any
			return responseText.toLowerCase().includes('umbrel')
		} catch {
			return false
		}
	}
}
