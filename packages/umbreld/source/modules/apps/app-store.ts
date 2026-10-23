import pRetry from 'p-retry'

import type Umbreld from '../../index.ts'
import runEvery from '../utilities/run-every.ts'
import AppRepository from './app-repository.ts'
import {isManifestVersionCompatible} from './manifest-compatibility.ts'

type RepositoryRegistry = Awaited<ReturnType<AppRepository['readRegistry']>>
type RegistryApp = RepositoryRegistry['apps'][number]

// Only app-store presentation and install-planning fields cross the API
// boundary. Repository manifests are untrusted extensible YAML, so spreading a
// parsed manifest here would expose arbitrary fields to every member account.
export function sanitizeRegistryApp(app: RegistryApp, umbrelVersion: string) {
	const {
		appStoreId,
		manifestVersion,
		id,
		name,
		tagline,
		icon,
		category,
		version,
		description,
		website,
		developer,
		submitter,
		submission,
		repo,
		support,
		gallery,
		releaseNotes,
		dependencies,
		optimizedForUmbrelHome,
		installSize,
		implements: implements_,
		requiresHttps,
	} = app

	return {
		appStoreId,
		manifestVersion,
		id,
		name,
		tagline,
		icon,
		category,
		version,
		description,
		website,
		developer,
		submitter,
		submission,
		repo,
		support,
		gallery,
		releaseNotes,
		dependencies,
		optimizedForUmbrelHome,
		installSize,
		implements: implements_,
		requiresHttps,
		compatible: isManifestVersionCompatible(manifestVersion, umbrelVersion),
	}
}

export function sanitizeRegistry(registry: RepositoryRegistry[], umbrelVersion: string) {
	return registry.map(({meta, apps}) => ({
		meta: {id: meta.id, name: meta.name},
		apps: apps.map((app) => sanitizeRegistryApp(app, umbrelVersion)),
	}))
}

export default class AppStore {
	#umbreld: Umbreld
	#stopUpdating?: () => void
	logger: Umbreld['logger']
	updateInterval = '5m'
	defaultAppStoreRepo: string
	attemptedInitialAppStoreUpdate = false

	constructor(umbreld: Umbreld, {defaultAppStoreRepo}: {defaultAppStoreRepo: string}) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLowerCase())
		this.defaultAppStoreRepo = defaultAppStoreRepo
	}

	async start() {
		this.logger.log('Initialising app store')

		// Set default app repository on first start
		if ((await this.#umbreld.store.get('appRepositories')) === undefined) {
			await this.#umbreld.store.set('appRepositories', [this.defaultAppStoreRepo])
		}

		// Initialise repositories
		this.logger.log(`Initialising default repository...`)
		this.attemptedInitialAppStoreUpdate = false
		try {
			const defaultRepository = await this.getDefaultRepository()
			if (!defaultRepository) throw new Error(`Default repository ${this.defaultAppStoreRepo} not found`)
			await pRetry(
				async () => {
					await defaultRepository.update().finally(() => (this.attemptedInitialAppStoreUpdate = true))
				},
				{
					onFailedAttempt: (error) => {
						this.logger.error(
							`Failed to initialise default repository ${defaultRepository.url}, will retry ${error.retriesLeft} more times.`,
							error,
						)
					},
					retries: 5, // This will do exponential backoff for 1s, 2s, 4s, 8s, 16s
				},
			)
			this.logger.log(`Default repository initialised!`)
		} catch (error) {
			this.logger.error(`Failed to initialise default repository`, error)
		}

		// Kick off update loop
		this.logger.log(`Checking repositories for updates every ${this.updateInterval}`)
		this.#stopUpdating = runEvery(this.updateInterval, () => this.update(), {runInstantly: true})
	}

	async stop() {
		if (this.#stopUpdating) this.#stopUpdating()
	}

	async getRepositories() {
		const repositoryUrls = await this.#umbreld.store.get('appRepositories')
		const repositories = repositoryUrls.map((url) => new AppRepository(this.#umbreld, url))

		return repositories
	}

	async getDefaultRepository() {
		const repositories = await this.getRepositories()
		return repositories.find((repository) => repository.url === this.defaultAppStoreRepo)
	}

	async update() {
		const repositories = await this.getRepositories()
		if (!repositories) throw new Error('App store not initialised')
		for (const repository of repositories) {
			try {
				await repository.update()
			} catch (error) {
				this.logger.error(`Failed to update ${repository.url}`, error)
			}
		}
	}

	async registry() {
		const repositories = await this.getRepositories()
		if (!repositories) throw new Error('App store not initialised')
		const registryPromises = repositories.map((repository) =>
			repository.readRegistry().catch((error) => {
				this.logger.error(`Failed to read registry from ${repository.url}`, error)
				return null
			}),
		)
		const registry = await Promise.all(registryPromises)

		// Remove failed reads and fix type definition to not be maybe null
		return registry.filter(Boolean) as Array<Awaited<ReturnType<typeof AppRepository.prototype.readRegistry>>>
	}

	// Public app-store data shared with both owner and member dashboards. Keep
	// repository locations and arbitrary manifest extensions out of this DTO.
	async publicRegistry() {
		return sanitizeRegistry(await this.registry(), this.#umbreld.version)
	}

	// Resolve duplicate app IDs using repository order. This is the canonical
	// lookup used by installs, updates, and update-availability checks.
	async resolvedApps() {
		const resolvedApps = new Map<string, {app: RegistryApp; repository: RepositoryRegistry}>()
		for (const repository of await this.registry()) {
			for (const app of repository.apps) {
				if (!resolvedApps.has(app.id)) resolvedApps.set(app.id, {app, repository})
			}
		}
		return resolvedApps
	}

	// Repository URLs are management data and remain owner-only.
	async listRepositories() {
		return (await this.registry()).map(({url, meta}) => ({
			url,
			meta: {id: meta.id, name: meta.name},
		}))
	}

	async addRepository(url: string) {
		// Check if repo already exists
		const existingRepositories = await this.getRepositories()
		if (existingRepositories.some((existingRepo) => existingRepo.url === url)) {
			throw new Error(`Repository ${url} already exists`)
		}

		this.logger.log(`Adding new repository: ${url}`)

		// Create repository instance and initialise it
		const repository = new AppRepository(this.#umbreld, url)
		await repository.update()

		// Save the repository URL
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const repositoryUrls = await get('appRepositories')
			repositoryUrls.push(url)
			await set('appRepositories', [...new Set(repositoryUrls)])
		})

		this.logger.log(`Added new repository: ${url}`)
		return true
	}

	async removeRepository(url: string) {
		if (this.defaultAppStoreRepo === url) {
			throw new Error(`Cannot remove default repository`)
		}

		// Check if repo exists
		const existingRepositories = await this.getRepositories()
		if (!existingRepositories.some((existingRepo) => existingRepo.url === url)) {
			throw new Error(`Repository ${url} does not exist`)
		}

		this.logger.log(`Removing repository: ${url}`)

		// Remove the repository URL
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const repositoryUrls = await get('appRepositories')
			const updatedRepositoryUrls = repositoryUrls.filter((repoUrl) => repoUrl !== url)
			await set('appRepositories', updatedRepositoryUrls)
		})

		this.logger.log(`Removed repository: ${url}`)
		return true
	}

	async getAppTemplateFilePath(appId: string) {
		// Throw on invalid appId
		if (!/^[a-zA-Z0-9-_]+$/.test(appId)) throw new Error(`Invalid app ID: ${appId}`)

		const resolvedApp = (await this.resolvedApps()).get(appId)
		if (!resolvedApp) throw new Error(`App with ID ${appId} not found in any repository`)

		const repositories = await this.getRepositories()
		const repoPath = repositories.find((repository) => repository.url === resolvedApp.repository.url)?.path
		if (!repoPath) throw new Error(`Repository path not found for ${resolvedApp.repository.url}`)

		return `${repoPath}/${appId}`
	}
}
