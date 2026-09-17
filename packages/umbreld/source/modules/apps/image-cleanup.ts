import Dockerode from 'dockerode'

import type Umbreld from '../../index.js'

type Logger = Pick<Umbreld['logger'], 'log' | 'error'>

// App operations can run concurrently, but a sweep needs a stable view of both
// installed Compose files and Docker. Nested operations also hold the sweep off.
export default class ImageCleanup {
	#enabled = true
	#activeOperations = 0
	#pending = false
	#sweep?: Promise<void>
	#timer?: ReturnType<typeof setTimeout>

	constructor(
		private readonly cleanup: () => Promise<void>,
		private readonly logger: Logger,
	) {}

	get enabled() {
		return this.#enabled
	}

	set enabled(enabled: boolean) {
		this.#enabled = enabled
		if (!enabled) {
			clearTimeout(this.#timer)
			this.#timer = undefined
		}
	}

	// Delay all pending cleanup, without holding up app operations in the meantime.
	schedule(delay = 0) {
		this.#pending = true
		clearTimeout(this.#timer)
		this.#timer = undefined
		if (!this.enabled) return
		if (delay > 0) {
			this.#timer = setTimeout(() => {
				this.#timer = undefined
				this.#cleanIfIdle()
			}, delay)
			this.#timer.unref()
		} else {
			this.#cleanIfIdle()
		}
	}

	async runOperation<T>(operation: () => Promise<T>, {cleanupAfter = false} = {}): Promise<T> {
		while (this.#sweep) await this.#sweep
		this.#activeOperations++
		try {
			return await operation()
		} finally {
			if (cleanupAfter) this.#pending = true
			this.#activeOperations--
			this.#cleanIfIdle()
		}
	}

	#cleanIfIdle() {
		if (!this.enabled || !this.#pending || this.#timer || this.#activeOperations > 0 || this.#sweep) return
		this.#pending = false
		this.#sweep = Promise.resolve()
			.then(() => this.cleanup())
			.catch((error) => this.logger.error('Failed to clean up unused Docker images', error))
			.finally(() => {
				this.#sweep = undefined
			})
	}
}

const isMissingImage = (error: unknown) => (error as {statusCode?: number})?.statusCode === 404

// Call only after collecting the complete expected set. An unreadable installed
// app must abort the sweep, rather than accidentally making its images unused.
export async function removeUnusedImages(expectedImages: string[], logger: Logger, docker = new Dockerode()) {
	const expectedIds = new Set<string>()
	for (const reference of new Set(expectedImages)) {
		try {
			expectedIds.add((await docker.getImage(reference).inspect()).Id)
		} catch (error) {
			// A failed pull can leave an expected image absent. Other inspect errors
			// mean we cannot establish which images are safe to remove.
			if (!isMissingImage(error)) throw error
		}
	}

	const images = await docker.listImages({all: true})
	const containerImages = new Set((await docker.listContainers({all: true})).map((container) => container.ImageID))
	for (const image of images) {
		if (expectedIds.has(image.Id) || containerImages.has(image.Id)) continue
		try {
			// Removing by ID refuses images with multiple repository references.
			// Remove their references individually, without forcing or pruning parents.
			const references = [...(image.RepoTags ?? []), ...(image.RepoDigests ?? [])].filter(
				(reference) => reference !== '<none>:<none>' && reference !== '<none>@<none>',
			)
			for (const reference of new Set([...references, image.Id])) {
				try {
					await docker.getImage(reference).remove({force: false, noprune: true})
				} catch (error) {
					// Removing the last tag also removes its digests and image ID.
					if (!isMissingImage(error)) throw error
				}
			}
			logger.log(`Removed unused Docker image ${image.Id}`)
		} catch (error) {
			// Docker remains the final authority, including if a container starts
			// using this image while we are trying to delete it.
			logger.error(`Could not remove unused Docker image ${image.Id}`, error)
		}
	}
}
