import {stat} from 'node:fs/promises'

type Options = {
	listPaths: () => Promise<string[]>
	systemPath: (virtualPath: string) => string
	onDelete: (virtualPath: string) => Promise<unknown>
	logger: {error: (message: string, error: unknown) => void}
	intervalMs?: number
}

// Check explicitly favorited or shared directories at startup and once a day.
// Comparing identities also detects a delete/recreate between polls. Never enumerate any
// children: a share containing a million Docker files costs one stat per poll.
export default class AppDirectoryMonitor {
	#identities = new Map<string, string>()
	#started = false
	#timer?: ReturnType<typeof setTimeout>
	#pending?: Promise<void>
	#refreshAgain = false

	constructor(private readonly options: Options) {}

	async start() {
		if (this.#started) return
		this.#started = true
		await this.refresh()
		this.#schedule()
	}

	// An explicit new favorite/share applies to the directory present now,
	// even if the previous directory at this path was replaced between polls.
	forget(path: string) {
		this.#identities.delete(path)
	}

	#schedule() {
		if (!this.#started) return
		this.#timer = setTimeout(
			() => {
				void this.refresh().finally(() => this.#schedule())
			},
			this.options.intervalMs ?? 24 * 60 * 60 * 1000,
		)
		this.#timer.unref()
	}

	async refresh() {
		if (!this.#started) return
		if (this.#pending) {
			this.#refreshAgain = true
			return this.#pending
		}
		this.#pending = (async () => {
			do {
				this.#refreshAgain = false
				await this.#check().catch((error) => this.options.logger.error('Failed to check app directories', error))
			} while (this.#started && this.#refreshAgain)
		})()
		try {
			await this.#pending
		} finally {
			this.#pending = undefined
		}
	}

	async #check() {
		const paths = new Set((await this.options.listPaths()).filter((path) => path.startsWith('/Apps/')))
		for (const path of this.#identities.keys()) {
			if (!paths.has(path)) this.#identities.delete(path)
		}
		for (const path of paths) {
			if (!this.#started) return
			try {
				const stats = await stat(this.options.systemPath(path), {bigint: true}).catch(
					(error: NodeJS.ErrnoException) => {
						if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined
						throw error
					},
				)
				const identity = stats?.isDirectory() ? `${stats.dev}:${stats.ino}:${stats.birthtimeNs}` : undefined
				const previous = this.#identities.get(path)
				if (!identity || (previous !== undefined && identity !== previous)) {
					await this.options.onDelete(path)
					this.#identities.delete(path)
				} else {
					this.#identities.set(path, identity)
				}
			} catch (error) {
				// Retain the previous identity and retry; an I/O error is not deletion.
				this.options.logger.error(`Failed to check app directory '${path}'`, error)
			}
		}
	}

	async stop() {
		this.#started = false
		if (this.#timer) clearTimeout(this.#timer)
		await this.#pending
		this.#identities.clear()
	}
}
