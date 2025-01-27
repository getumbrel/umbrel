import nodePath from 'node:path'

import fse from 'fs-extra'
import {$} from 'execa'

import type Umbreld from '../../index.js'
import randomToken from '../utilities/random-token.js'
import {DEFAULT_FILE_MODE, DEFAULT_DIRECTORY_MODE, SUFFIX_SEARCH_MAX_ITERATIONS} from './files.js'

type Share = {
	path: string
	name: string
}

export default class Samba {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	sharePasswordFile: string

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLocaleLowerCase())
		this.sharePasswordFile = nodePath.join(this.#umbreld.dataDirectory, 'secrets', 'share-password')
	}

	async start() {
		this.logger.log('Starting samba')

		// Make sure the share password exists and is applied
		try {
			const sharePassword = await this.getSharePassword()
			await $({
				input: `${sharePassword}\n${sharePassword}\n`,
			})`smbpasswd -s -a umbrel`
		} catch (error) {
			this.logger.error(`Failed to apply share password: ${(error as Error).message}`)
		}

		// Generate share config and start/stop Samba accordingly
		await this.syncShares().catch((error) => this.logger.error(`Failed to synchronize shares: ${error.message}`))
	}

	async stop() {
		this.logger.log('Stopping samba')
		await $`systemctl stop smbd`.catch((error) => this.logger.error(`Failed to stop smbd: ${error.message}`))
	}

	async getSharePassword() {
		let sharePassword: string
		try {
			sharePassword = await fse.readFile(this.sharePasswordFile, 'utf8')
		} catch {
			sharePassword = await randomToken(128)
			await fse.writeFile(this.sharePasswordFile, sharePassword)
		}
		return sharePassword
	}

	async syncShares() {
		// Update our shares configuration that is included in smb.conf
		const shares = (await this.#umbreld.store.get('files.shares')) ?? []
		const usedNames = new Set<string>()
		const configs = (
			await Promise.all(
				shares.map(async (share) => {
					const sanitizedName = share.name.replace(/[\[\]]/g, '_')
					let name = sanitizedName

					// Prettier naming convention for the Samba shares
					if (name === 'Home') {
						const user = await this.#umbreld.user.get()
						const username = user?.name
						if (username) name = `${username}'s Umbrel`
					} else {
						name = `${name} (Umbrel)`
					}
					let nextSuffix = 2
					while (usedNames.has(name)) {
						if (nextSuffix > SUFFIX_SEARCH_MAX_ITERATIONS) {
							this.logger.error(`Gave up searching for a suffix for share '${share.name}'`)
							return null
						}
						name = `${sanitizedName} (${nextSuffix++})`
					}
					usedNames.add(name)
					const path = await this.#umbreld.files.mapVirtualToSystemPath(share.path).catch((error) => {
						this.logger.error(`Failed to map share path '${share.path}' to system path: ${error.message}`)
						return null
					})
					if (!path) return null
					const config = [
						`[${name}]`,
						`path = ${path}`,
						'valid users = umbrel',
						'writeable = yes',
						'force user = root',
						'force group = umbrel',
						'inherit owner = yes',
						`create mask = ${DEFAULT_FILE_MODE.toString(8).padStart(4, '0')}`,
						`directory mask = ${DEFAULT_DIRECTORY_MODE.toString(8).padStart(4, '0')}`,
						'fruit:time machine = yes',
					]
					return config.join('\n') + '\n'
				}),
			)
		).filter((config) => config !== null) as string[]
		await fse
			.writeFile(nodePath.join(this.#umbreld.dataDirectory, 'sambashares.conf'), configs.join('\n'))
			.catch((error) => this.logger.error(`Failed to write samba shares configuration: ${error.message}`))

		// We are not running smbd at boot to initialize things first, and we'd also
		// like to prevent unnecessarily restarting it so network shares aren't
		// unexpectedly disconnected.
		const hasAtLeastOneShare = shares.length > 0
		if (hasAtLeastOneShare) {
			// We know that there is at least one share, so make sure that Samba is
			// running or, in case it already is, that its config is reloaded.
			await $`systemctl start smbd`.catch((error) => this.logger.error(`Failed to start smbd: ${error.message}`))
			await $`smbcontrol smbd reload-config`.catch((error) =>
				this.logger.error(`Failed to reload smbd configuration: ${error.message}`),
			)
		} else {
			// If we don't have at least one share, there is no need to keep Samba
			// running, consuming resources, so make sure that it is stopped.
			await $`systemctl stop smbd`.catch((error) => this.logger.error(`Failed to stop smbd: ${error.message}`))
		}
	}

	async getShares() {
		let shares: Share[]
		let cleaned = false
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const currentShares = (await get('files.shares')) ?? []
			const validShares = (
				await Promise.all(
					currentShares.map(async (share) => {
						try {
							const path = await this.#umbreld.files.mapVirtualToSystemPath(share.path)
							const stats = await fse.stat(path)
							if (!stats.isDirectory()) {
								throw new Error('Share path is not a directory')
							}
							return share
						} catch (error) {
							this.logger.log(
								`Cleaned up invalid share '${share.name}' at '${share.path}': ${(error as Error).message}`,
							)
							return null
						}
					}),
				)
			).filter((share) => share !== null) as Share[]
			if (validShares.length !== currentShares.length) {
				await set('files.shares', validShares)
				cleaned = true
			}
			shares = validShares
		})
		if (cleaned) {
			await this.syncShares().catch((error) => this.logger.error(`Failed to synchronize shares: ${error.message}`))
		}
		return shares!
	}

	async getShare(virtualPath: string) {
		virtualPath = this.#umbreld.files.validateVirtualPath(virtualPath)
		const shares = await this.getShares()
		return shares.find((share) => share.path === virtualPath) ?? null
	}

	async addShare(virtualPath: string) {
		virtualPath = this.#umbreld.files.validateVirtualPath(virtualPath)

		if (this.#umbreld.files.isUnshareable(virtualPath)) {
			throw new Error('ENOTSUP: Cannot share a protected directory')
		}

		const path = await this.#umbreld.files.mapVirtualToSystemPath(virtualPath)

		if (this.#umbreld.files.isTrash(path)) {
			throw new Error('ENOTSUP: Cannot share trash')
		}

		// Check that the path is a directory we can share
		const stats = await fse.stat(path).catch(() => null)
		if (!stats?.isDirectory()) {
			throw new Error('ENOTDIR: Share path is not a directory')
		}

		// Use explicit name when sharing a base directory
		const matchingBaseDirectoryName = this.#umbreld.files.baseDirectories.get(path)

		let share: Share | undefined
		let added = false
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const shares = (await get('files.shares'))?.slice() ?? []
			share = shares.find((share) => share.path === virtualPath)
			if (share) return
			const basename = matchingBaseDirectoryName ?? nodePath.basename(path)
			let name = basename
			let nextSuffix = 2
			do {
				const nameExists = shares.find((share) => share.name === name)
				if (nameExists) {
					if (nextSuffix > SUFFIX_SEARCH_MAX_ITERATIONS) {
						throw new Error('EEXIST: Gave up searching for a suffix')
					}
					name = `${basename} (${nextSuffix++})`
				} else break
			} while (true)
			share = {name, path: virtualPath}
			shares.push(share)
			await set('files.shares', shares)
			added = true
		})
		if (added) {
			await this.syncShares().catch((error) => this.logger.error(`Failed to synchronize shares: ${error.message}`))
		}
		return share!.name
	}

	async deleteShare(virtualPath: string) {
		virtualPath = this.#umbreld.files.validateVirtualPath(virtualPath)
		await this.#umbreld.files.mapVirtualToSystemPath(virtualPath) // for consistency

		let deleted = false
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const shares = (await get('files.shares')) ?? []
			const newShares = shares.filter((share) => share.path !== virtualPath)
			deleted = newShares.length < shares.length
			if (deleted) await set('files.shares', newShares)
		})
		if (deleted) {
			await this.syncShares().catch((error) => this.logger.error(`Failed to synchronize shares: ${error.message}`))
		}
		return deleted
	}

	async #replaceShare(knownGoodVirtualPath: string, newPath: string) {
		const newVirtualPath = await this.#umbreld.files.mapSystemToVirtualPath(newPath)

		if (this.#umbreld.files.isTrash(newPath)) {
			throw new Error('ENOTSUP: Cannot share trash')
		}

		// Check that newPath is a directory
		const stats = await fse.stat(newPath).catch(() => null)
		if (!stats?.isDirectory()) {
			throw new Error('ENOTDIR: New share path is not a directory')
		}
		let replaced = false
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const shares = (await get('files.shares'))?.slice() ?? []
			const share = shares.find((share) => share.path === knownGoodVirtualPath)
			if (!share) return
			share.path = newVirtualPath
			await set('files.shares', shares)
			replaced = true
		})
		if (replaced) {
			await this.syncShares().catch((error) => this.logger.error(`Failed to synchronize shares: ${error.message}`))
		}
		return replaced
	}

	async replaceOrDeleteShare(knownGoodVirtualPath: string, newPath: string) {
		const replaced = await this.#replaceShare(knownGoodVirtualPath, newPath).catch((error) => {
			this.logger.log(`Cannot replace share at '${knownGoodVirtualPath}': ${error.message}`)
			return false
		})
		if (replaced) return true
		return await this.deleteShare(knownGoodVirtualPath).catch((error) => {
			this.logger.error(`Failed to delete share at '${knownGoodVirtualPath}' instead: ${error.message}`)
		})
	}
}
