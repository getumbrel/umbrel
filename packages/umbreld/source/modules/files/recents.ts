import PQueue from 'p-queue'
import fse from 'fs-extra'
import type Umbreld from '../../index.js'
import type {Stats} from './files.js'

const maxRecents = 50
const saveDelay = 10000
const queue = new PQueue({concurrency: 1})

class Recents {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	files: string[] = []
	saveTimeout: NodeJS.Timeout | null = null

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLocaleLowerCase())
	}

	async start() {
		this.files = (await this.#umbreld.store.get('files.recents')) ?? []
		const {watcher} = this.#umbreld.files
		watcher.addListener('create', this.#change)
		watcher.addListener('update', this.#change)
		watcher.addListener('delete', this.#delete)
	}

	async stop() {
		const {watcher} = this.#umbreld.files
		watcher.removeListener('create', this.#change)
		watcher.removeListener('update', this.#change)
		watcher.removeListener('delete', this.#delete)
		await this.saveNow()
	}

	#change = (path: string) => queue.add(() => this.touch(path))

	#delete = (path: string) => queue.add(() => this.prune(path))

	async get() {
		return (
			await Promise.all(
				this.files.map(async (virtualPath) => {
					const path = await this.#umbreld.files.mapVirtualToSystemPath(virtualPath).catch(() => null)
					if (!path) return null
					const stats = await this.#umbreld.files.stat(path, virtualPath).catch(() => null)
					if (!stats || stats.error || stats.type === 'directory') return null
					return stats
				}),
			)
		).filter((stats) => stats !== null) as Stats[]
	}

	async touch(path: string) {
		let virtualPath: string
		try {
			virtualPath = this.#umbreld.files.mapSystemToVirtualPath(path)
		} catch {
			return // skip unmappable files
		}
		const stats = await fse.stat(path).catch(() => null)
		if (!stats?.isFile()) {
			return // skip inexistent and non-files
		}
		if (path.endsWith('/.DS_Store') || path.endsWith('/.directory')) return // Prevent loads of .DS_Store (macOS) and .directory (KDE Dolphin) results
		this.files = this.files.filter((recent) => recent !== virtualPath)
		this.files.unshift(virtualPath)
		this.files = this.files.slice(0, maxRecents)
		this.save()
	}

	async prune(path: string) {
		let virtualPath: string
		try {
			virtualPath = this.#umbreld.files.mapSystemToVirtualPath(path)
		} catch {
			return // skip unmappable files
		}
		this.files = this.files.filter((recent) => recent !== virtualPath)
		this.save()
	}

	save() {
		// Debounce store to disk to avoid excessive writes
		if (this.saveTimeout) clearTimeout(this.saveTimeout)
		this.saveTimeout = setTimeout(() => this.saveNow(), saveDelay)
	}

	async saveNow() {
		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout)
			this.saveTimeout = null
		}
		await this.#umbreld.store
			.set('files.recents', this.files)
			.catch((error) => this.logger.error(`Failed to save recents: ${error.message}`))
	}
}

export default Recents
