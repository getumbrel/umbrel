import type Umbreld from '../../index.js'

import type {FileChangeEvent} from './watcher.js'
import {OWNER_USER_ID} from '../user/constants.js'
import AsyncBurstCache from '../utilities/async-burst-cache.js'
import AppDirectoryMonitor from './app-directory-monitor.js'

const WATCHER_SNAPSHOT_TTL_MS = 1000

export default class Favorites {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	#removeFileChangeListener?: () => void
	#appDirectories: AppDirectoryMonitor
	#watcherFavorites: AsyncBurstCache<Awaited<ReturnType<Umbreld['user']['getAllAccountFavorites']>>>

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		this.#watcherFavorites = new AsyncBurstCache(
			() => this.#umbreld.user.getAllAccountFavorites(),
			WATCHER_SNAPSHOT_TTL_MS,
		)
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(`files:${name.toLocaleLowerCase()}`)
		this.#appDirectories = new AppDirectoryMonitor({
			listPaths: async () => (await umbreld.user.getAllAccountFavorites()).flatMap(({favorites}) => favorites ?? []),
			systemPath: (path) => umbreld.files.virtualToSystemPathUnsafe(path),
			onDelete: (path) => this.removeWithin(path),
			logger: this.logger,
		})
	}

	// Add listener
	async start() {
		this.logger.log('Starting favorites')

		// Attach listener
		this.#removeFileChangeListener = this.#umbreld.eventBus.on(
			'files:watcher:change',
			this.#handleFileChange.bind(this),
		)
		await this.#appDirectories.start()
	}

	// Get favorites
	async #get(userId: string) {
		const favorites = await this.#umbreld.user.getAccountFavorites(userId)
		return this.#normalizeFavorites(favorites ?? this.#defaultFavorites(userId))
	}

	// Remove favorites on deletion
	// TODO: It would be nice if we could handle updating favorites when the favorited directory is
	// moved/renamed. It's not trivial because this can happen via something external like an app or SMB
	// and there's no way to tell the difference between a move/rename and a deletion/recreation.
	async #handleFileChange(event: FileChangeEvent) {
		if (event.type !== 'delete') return
		await this.removeWithin(this.#umbreld.files.systemToVirtualPath(event.path))
	}

	async removeWithin(virtualDeletedPath: string) {
		const accounts = await this.#watcherFavorites.get()
		for (const {userId, favorites: storedFavorites} of accounts) {
			const favorites = this.#normalizeFavorites(storedFavorites ?? this.#defaultFavorites(userId))
			const deletedFavorites = favorites.filter(
				(favorite) => favorite === virtualDeletedPath || favorite.startsWith(`${virtualDeletedPath}/`),
			)
			for (const favorite of deletedFavorites) {
				await this.removeFavorite(favorite, userId).catch((error) =>
					this.logger.error(`Failed to remove deleted favorite ${favorite} for ${userId}`, error),
				)
			}
		}
	}

	// List favorited directories
	async listFavorites(userId: string = OWNER_USER_ID) {
		// Get favorites from the store
		const favorites = await this.#get(userId)

		// Strip out any favorites that aren't existing directories (or no longer
		// resolve, e.g. the directory was replaced with an escaping symlink)
		const mappedFavorites = await Promise.all(
			favorites.map(async (favorite) => {
				const systemPath = await this.#umbreld.files.virtualToSystemPath(favorite, userId).catch(() => undefined)
				if (!systemPath) return undefined
				const file = await this.#umbreld.files.status(systemPath).catch(() => undefined)
				if (file?.type !== 'directory') return undefined
				return favorite
			}),
		)
		const filteredFavorites = mappedFavorites.filter((favorite) => favorite !== undefined)

		return filteredFavorites
	}

	// Save a favorite directory
	async addFavorite(virtualPath: string, userId: string = OWNER_USER_ID) {
		virtualPath = this.#umbreld.files.normalizeVirtualPath(virtualPath)

		// Authorize before inspecting path capabilities so an account cannot use
		// the error shape to probe inaccessible directories.
		await this.#umbreld.files.virtualToSystemPath(virtualPath, userId)

		// Check operation is allowed
		const allowedOperations = await this.#umbreld.files.getAllowedOperations(virtualPath, userId)
		if (!allowedOperations.includes('favorite')) throw new Error('[operation-not-allowed]')

		// Save entry in the store
		await this.#umbreld.user.updateAccountFavorites(userId, (stored) => {
			const favorites = this.#normalizeFavorites(stored ?? this.#defaultFavorites(userId))
			if (favorites.includes(virtualPath)) return undefined
			return [...favorites, virtualPath]
		})
		this.#watcherFavorites.clear()
		this.#appDirectories.forget(virtualPath)
		await this.#appDirectories.refresh()

		return true
	}

	// Remove a favorite directory
	async removeFavorite(virtualPath: string, userId: string = OWNER_USER_ID) {
		virtualPath = this.#umbreld.files.normalizeVirtualPath(virtualPath)
		let deleted = false
		await this.#umbreld.user.updateAccountFavorites(userId, (stored) => {
			const favorites = this.#normalizeFavorites(stored ?? this.#defaultFavorites(userId))
			const newFavorites = favorites.filter((favorite) => favorite !== virtualPath)
			deleted = newFavorites.length < favorites.length
			return deleted ? newFavorites : undefined
		})
		this.#watcherFavorites.clear()
		return deleted
	}

	#defaultFavorites(userId: string) {
		const home = userId === OWNER_USER_ID ? '/Home' : `/Users/${userId}`
		return ['Downloads', 'Documents', 'Photos', 'Videos'].map((folder) => `${home}/${folder}`)
	}

	#normalizeFavorites(favorites: string[]) {
		return [...new Set(favorites.map((favorite) => this.#umbreld.files.normalizeVirtualPath(favorite)))]
	}

	// Remove listener
	async stop() {
		this.logger.log('Stopping favorites')
		this.#removeFileChangeListener?.()
		await this.#appDirectories.stop()
	}
}
