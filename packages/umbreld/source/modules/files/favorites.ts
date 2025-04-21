import type Umbreld from '../../index.js'

import type {FileChangeEvent} from './watcher.js'

export default class Favorites {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	#removeFileChangeListener?: () => void

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(`files:${name.toLocaleLowerCase()}`)
	}

	// Add listener
	async start() {
		this.logger.log('Starting favorites')

		// Attach listener
		this.#removeFileChangeListener = this.#umbreld.eventBus.on(
			'files:watcher:change',
			this.#handleFileChange.bind(this),
		)
	}

	// Get favorites
	async #get() {
		const favorites = await this.#umbreld.store.get('files.favorites')
		return favorites || []
	}

	// Remove favorites on deletion
	// TODO: It would be nice if we could handle updating favorites when the favorited directory is
	// moved/renamed. It's not trivial because this can happen via something external like an app or SMB
	// and there's no way to tell the difference between a move/rename and a deletion/recreation.
	async #handleFileChange(event: FileChangeEvent) {
		if (event.type !== 'delete') return
		const favorites = await this.#get()
		const virtualDeletedPath = this.#umbreld.files.systemToVirtualPath(event.path)
		const deletedFavorites = favorites.filter((favorite) => favorite.startsWith(virtualDeletedPath))
		for (const favorite of deletedFavorites) await this.removeFavorite(favorite)
	}

	// List favorited directories
	async listFavorites() {
		// Get favorites from the store
		const favorites = await this.#get()

		// Strip out any favorites that aren't existing directories
		const mappedFavorites = await Promise.all(
			favorites.map(async (favorite) => {
				const systemPath = await this.#umbreld.files.virtualToSystemPath(favorite)
				const file = await this.#umbreld.files.status(systemPath).catch(() => undefined)
				if (file?.type !== 'directory') return undefined
				return favorite
			}),
		)
		const filteredFavorites = mappedFavorites.filter((favorite) => favorite !== undefined)

		return filteredFavorites
	}

	// Save a favorite directory
	async addFavorite(virtualPath: string) {
		// Check operation is allowed
		const allowedOperations = await this.#umbreld.files.getAllowedOperations(virtualPath)
		if (!allowedOperations.includes('favorite')) throw new Error('[operation-not-allowed]')

		// Save entry in the store
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const favorites = await this.#get()
			let favorite = favorites.find((favorite) => favorite === virtualPath)
			if (favorite) return
			favorites.push(virtualPath)
			await set('files.favorites', favorites)
		})

		return true
	}

	// Remove a favorite directory
	async removeFavorite(virtualPath: string) {
		let deleted = false
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const favorites = await this.#get()
			const newFavorites = favorites.filter((favorite) => favorite !== virtualPath)
			deleted = newFavorites.length < favorites.length
			if (deleted) await set('files.favorites', newFavorites)
		})
		return deleted
	}

	// Remove listener
	async stop() {
		this.logger.log('Stopping favorites')
		this.#removeFileChangeListener?.()
	}
}
