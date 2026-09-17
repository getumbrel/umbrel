import {fileURLToPath} from 'node:url'
import {dirname, join, posix} from 'node:path'

import fse from 'fs-extra'
import {$} from 'execa'
import pRetry from 'p-retry'

import randomToken from '../../modules/utilities/random-token.js'
import type Umbreld from '../../index.js'
import {CLOUD_DESTINATION_MISSING_ERROR} from '../files/cloud-types.js'
import appEnvironment from './legacy-compat/app-environment.js'
import type {AppDataRootLocation, AppFolderAccessSelection, AppSettings} from './schema.js'
import App, {
	getFolderAccessSlots,
	readComposeInDirectory,
	readManifestInDirectory,
	type AppSettingsUpdate,
} from './app.js'
import type {AppManifest} from './schema.js'
import {fillSelectedDependencies} from '../utilities/dependencies.js'
import {OWNER_USER_ID} from '../user/constants.js'
import {assertManifestVersionCompatible} from './manifest-compatibility.js'
import ImageCleanup, {removeUnusedImages} from './image-cleanup.js'

export type AppDataRootStatus = 'available' | 'storage-unavailable' | 'data-missing'

type InstallOptions = {
	alternatives?: AppSettings['dependencies']
	folderAccess?: AppFolderAccessSelection[]
}

export default class Apps {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	instances: App[] = []
	readonly imageCleanup: ImageCleanup
	isTorBeingToggled = false
	#storageChangeUnsubscribes: Array<() => void> = []
	#storageRetryInFlight = false
	#storageRetryQueued = false
	#storageSourceChecks = new Map<string, {isDirectory: Promise<boolean>; settledAt?: number}>()
	#dataRootChecks = new Map<string, {status: Promise<AppDataRootStatus>; settledAt?: number}>()
	#dataRootLocations = new Map<string, AppDataRootLocation>()
	#folderAccessSourcePaths = new Map<string, string[]>()
	#storageBlocks = new Map<symbol, string[]>()
	#storageOperations = new Map<symbol, {appId: string; paths: string[]; protectAsDataRoot: boolean}>()
	#installsInProgress = new Set<string>()

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLowerCase())
		this.imageCleanup = new ImageCleanup(() => this.#cleanUnusedImages(), this.logger)
	}

	async #cleanUnusedImages() {
		// Include persisted IDs as well as instances: a missing config or a partial
		// install must never silently drop an installed app from the keep set.
		const installedIds = await this.#umbreld.store.get('apps')
		if (!Array.isArray(installedIds)) throw new Error('Installed app list is unavailable')
		const appIds = new Set([...installedIds, ...this.instances.map((app) => app.id)])
		const expectedImages = await appEnvironment(this.#umbreld, 'images')
		if (!expectedImages?.length) throw new Error('System image list is unavailable')
		for (const appId of appIds) {
			const app = this.instances.find((app) => app.id === appId) ?? new App(this.#umbreld, appId)
			expectedImages.push(...(await app.getExpectedImages()))
		}
		this.logger.log('Cleaning up unused Docker images')
		await removeUnusedImages(expectedImages, this.logger)
	}

	// This is a really brutal and heavy handed way of cleaning up old Docker state.
	// We should only do this sparingly. It's needed if an old version of Docker
	// didn't shutdown cleanly and then we update to a new version of Docker.
	// The next version of Docker can have issues starting containers if the old
	// containers/networks are still hanging around. We had this issue because sometimes
	// 0.5.4 installs didn't clean up properly on shutdown and it causes critical errors
	// bringing up containers in 1.0.
	async cleanDockerState() {
		try {
			const containerIds = (await $`docker ps -aq`).stdout.split('\n').filter(Boolean)
			if (containerIds.length) {
				this.logger.log('Cleaning up old containers...')
				await $({stdio: 'inherit'})`docker stop --time 30 ${containerIds}`
				await $({stdio: 'inherit'})`docker rm ${containerIds}`
			}
		} catch (error) {
			this.logger.error(`Failed to clean containers`, error)
		}
		try {
			this.logger.log('Cleaning up old networks...')
			await $({stdio: 'inherit'})`docker network prune -f`
		} catch (error) {
			this.logger.error(`Failed to clean networks`, error)
		}
	}

	async start() {
		return this.imageCleanup.runOperation(async () => {
			try {
				await this.#start()
			} finally {
				// Let startup and initial user activity finish before low-priority cleanup.
				this.imageCleanup.schedule(10 * 60 * 1000)
			}
		})
	}

	async #start() {
		this.imageCleanup.enabled = true
		// Set apps to empty array on first start
		if ((await this.#umbreld.store.get('apps')) === undefined) {
			await this.#umbreld.store.set('apps', [])
		}

		// Set torEnabled to false on first start
		if ((await this.#umbreld.store.get('torEnabled')) === undefined) {
			await this.#umbreld.store.set('torEnabled', false)
		}

		// Set recentlyOpenedApps to empty array on first start
		if ((await this.#umbreld.store.get('recentlyOpenedApps')) === undefined) {
			await this.#umbreld.store.set('recentlyOpenedApps', [])
		}

		// Create a random umbrel seed on first start if one doesn't exist.
		// This is only used to determinstically derive app seed, app password
		// and custom app specific environment variables. It's needed to maintain
		// compatibility with legacy apps. In the future we'll migrate to apps
		// storing their own random seed/password/etc inside their own data directory.
		const umbrelSeedFile = `${this.#umbreld.dataDirectory}/db/umbrel-seed/seed`
		if (!(await fse.exists(umbrelSeedFile))) {
			this.logger.log('Creating Umbrel seed')
			await fse.ensureFile(umbrelSeedFile)
			await fse.writeFile(umbrelSeedFile, randomToken(256))
		}

		// Setup bin dir
		try {
			const currentFilename = fileURLToPath(import.meta.url)
			const currentDirname = dirname(currentFilename)
			const binSourcePath = join(currentDirname, 'legacy-compat/bin')
			const binDestPath = `${this.#umbreld.dataDirectory}/bin`
			await fse.mkdirp(binDestPath)
			const bins = await fse.readdir(binSourcePath)
			this.logger.log(`Copying bins to ${binDestPath}`)
			for (const bin of bins) {
				this.logger.log(`Copying ${bin}`)
				const source = join(binSourcePath, bin)
				const dest = join(binDestPath, bin)
				await fse.copyFile(source, dest)
			}
		} catch (error) {
			this.logger.error(`Failed to copy bins`, error)
		}

		// Create app instances
		const appIds = await this.#umbreld.store.get('apps')
		this.instances = appIds.map((appId) => new App(this.#umbreld, appId))
		this.#dataRootLocations.clear()
		await Promise.all(
			this.instances.map(async (app) => {
				const location = await app.getDataRootLocation().catch(() => null)
				if (location) this.#dataRootLocations.set(app.id, location)
			}),
		)

		// Don't save references to any apps that don't have a data directory on
		// startup. This will allow apps that were excluded from backups to be
		// reinstalled when the system is restored. Otherwise they'll have an id
		// entry but no data dir and will be stuck in a `not-running` state.
		const appIdsMissingDataDir: string[] = []
		for (const app of this.instances) {
			const appDataDirectoryExists = await fse.pathExists(app.dataDirectory).catch(() => false)
			if (!appDataDirectoryExists) {
				this.logger.error(`App ${app.id} does not have a data directory, removing from instances`)
				this.instances = this.instances.filter((instanceApp) => instanceApp.id !== app.id)
				appIdsMissingDataDir.push(app.id)
			}
		}
		this.#folderAccessSourcePaths.clear()
		await Promise.all(this.instances.map((app) => this.refreshFolderAccessSourcePaths(app)))

		// Force the app state to starting so users don't get confused.
		// They aren't actually starting yet, we need to make sure the app env is up first.
		// But if that takes a long time users see all their apps listed as not running and
		// get confused.
		for (const app of this.instances) app.state = 'starting'

		// Storage that apps depend on via custom folders (network shares, external
		// drives) can become available after an app has already failed to start,
		// e.g. a NAS that's still booting when apps auto-start after a reboot.
		// Retry those apps whenever storage is mounted.
		let initialAppStartsSettled = false
		let retryAfterInitialAppStarts = false
		const onStorageChange = () => {
			// Re-check source availability from scratch so recovery shows promptly
			this.#storageSourceChecks.clear()
			this.#dataRootChecks.clear()
			// A mount can finish after an app checks storage but before its failed
			// start changes state from starting to unknown. The event-time retry then
			// skips it, so remember to retry once all initial starts have settled.
			if (!initialAppStartsSettled) retryAfterInitialAppStarts = true
			this.startAppsAwaitingStorage()
		}
		this.#storageChangeUnsubscribes.push(
			this.#umbreld.eventBus.on('files:external-storage:change', onStorageChange),
			this.#umbreld.eventBus.on('files:network-storage:change', onStorageChange),
		)

		// Attempt to pre-load local Docker images
		try {
			// Loop over iamges in /images
			const images = await fse.readdir(`/images`)
			await Promise.all(
				images.map(async (image) => {
					try {
						this.logger.log(`Pre-loading local Docker image ${image}`)
						await $({stdio: 'inherit'})`docker load --input /images/${image}`
					} catch (error) {
						this.logger.error(`Failed to pre-load local Docker image ${image}`, error)
					}
				}),
			)
		} catch (error) {
			this.logger.error(`Failed to pre-load local Docker images`, error)
		}

		// Start app environment
		try {
			try {
				await appEnvironment(this.#umbreld, 'up')
			} catch (error) {
				this.logger.error(`Failed to start app environment`, error)
				this.logger.log('Attempting to clean Docker state before retrying...')
				await this.cleanDockerState()
			}
			await pRetry(() => appEnvironment(this.#umbreld, 'up'), {
				onFailedAttempt: (error) => {
					this.logger.error(
						`Attempt ${error.attemptNumber} starting app environmnet failed. There are ${error.retriesLeft} retries left.`,
						error,
					)
				},
				retries: 7, // This will do exponential backoff for 1s, 2s, 4s, 8s, 16s, 32s, 64s (~2 minutes total)
			})
		} catch (error) {
			// Log the error but continue to try to bring apps up to make it a less bad failure
			this.logger.error(`Failed to start app environment`, error)
		}

		try {
			// Set permissions for tor data directory
			await $`sudo chown -R 1000:1000 ${this.#umbreld.dataDirectory}/tor`
		} catch (error) {
			this.logger.error(`Failed to set permissions for Tor data directory`, error)
		}

		this.logger.log('Starting apps')
		// Snapshot of currently installed apps (minus apps missing their data directories that will be reinstalled)
		// We start these apps (save Promise), fire reinstalls without awaiting, then await the starts.
		const appsToStart = [...this.instances]
		const startAppsPromise = Promise.allSettled(
			appsToStart.map(async (app) => {
				const shouldStart = await app.shouldAutoStart()
				if (!shouldStart) {
					this.logger.log(`Skipping app ${app.id} (autoStart disabled)`)
					app.state = 'stopped'
					return
				}

				return app.start().catch((error) => {
					// We handle individual errors here to prevent apps start from throwing
					// if a single app fails.
					app.state = 'unknown'
					this.logger.error(`Failed to start app ${app.id}`, error)
				})
			}),
		)

		// If this is the first boot after a backup restore, we kick off reinstalls of any apps that are missing their data directory.
		// e.g., due to restoring a backup where the app was excluded.
		// We fire and forget here so users see apps installing as soon as possible.
		this.reinstallMissingAppsAfterRestore(appIdsMissingDataDir).catch((error) =>
			this.logger.error('Failed to schedule app reinstalls after restore', error),
		)

		// Wait for current installed apps to finish starting
		const startResults = await startAppsPromise
		for (const [index, result] of startResults.entries()) {
			if (result.status !== 'rejected') continue
			appsToStart[index].state = 'unknown'
			this.logger.error(`Failed to start app ${appsToStart[index].id}`, result.reason)
		}
		initialAppStartsSettled = true
		if (retryAfterInitialAppStarts) await this.startAppsAwaitingStorage()
		await this.#umbreld.lanIngress
			.refresh()
			.catch((error) => this.logger.error('Failed to refresh LAN ingress after starting apps', error))
	}

	private async reinstallMissingAppsAfterRestore(appIds: string[]) {
		return this.imageCleanup.runOperation(() => this.#reinstallMissingAppsAfterRestore(appIds))
	}

	async #reinstallMissingAppsAfterRestore(appIds: string[]) {
		// Only run on the first start after a backup restore
		if (!this.#umbreld.isBackupRestoreFirstStart) return

		// If there are no apps to reinstall, return early
		if (appIds.length === 0) return

		this.logger.log(`Detected ${appIds.length} app(s) missing a data directory after restore, reinstalling...`)
		try {
			// Best effort retry to ensure app repositories are pulled before reinstalling
			// app stores are excluded from backups so first boot after recovery won't have them.
			await pRetry(
				async () => {
					await this.#umbreld.appStore.update()
				},
				{
					retries: 3,
					onFailedAttempt: (error) => {
						this.logger.error(
							`Failed to update app store before reinstalls (attempt ${error.attemptNumber}, ${error.retriesLeft} retries left).`,
							error,
						)
					},
				},
			)
		} catch (error) {
			this.logger.error('Exhausted retries updating app store before reinstalls', error)

			// If we fail, we return early because no appstore repos exist and installs will fail
			// We won't retry on a later boot (marker file already deleted).
			return
		}

		for (const appId of appIds) {
			// Fire off all installs in parallel without blocking
			// TODO: Consider adding concurrency limiting for app installs to avoid overwhelming system resources
			this.install(appId).catch((error) => this.logger.error(`Failed to reinstall app ${appId}`, error))
		}
	}

	// Returns the names of installed apps that use storage at or under the given
	// virtual path, including data roots inherited through app dependencies. Used
	// to block removing network shares or ejecting drives out from under active apps.
	// Only an explicitly stopped app releases its storage. `unknown` can mean a
	// lifecycle command failed after changing only some containers, so treating it
	// as inactive could allow storage to be removed from a container still using it.
	async #getFolderAccessSourcePaths(app: App) {
		try {
			return await app.getEffectiveFolderAccessSourcePaths()
		} catch (error) {
			this.logger.error(`Could not resolve effective folder access for ${app.id}; using saved paths`, error)
			return app.getConfiguredFolderAccessSourcePaths()
		}
	}

	async getAppsUsingStorageSource(virtualPath: string) {
		const appNames: string[] = []
		for (const app of this.instances) {
			if (app.state === 'stopped') continue
			const sourcePaths = new Set(await this.getDataRootStoragePaths(app.id))
			for (const path of await this.#getFolderAccessSourcePaths(app)) sourcePaths.add(path)
			const usesPath = [...sourcePaths].some(
				(sourcePath) => sourcePath === virtualPath || sourcePath.startsWith(`${virtualPath}/`),
			)
			if (usesPath) {
				const name = await app
					.readManifest()
					.then((manifest) => manifest.name)
					.catch(() => app.id)
				appNames.push(name)
			}
		}

		return appNames
	}

	#storagePathsOverlap(first: string, second: string) {
		return first === second || first.startsWith(`${second}/`) || second.startsWith(`${first}/`)
	}

	// Register source and destination paths before a move performs any async work.
	// Drive/share removal registers its block the same way, so whichever operation
	// starts first wins without a check-then-unmount race.
	beginStorageOperation(
		appId: string,
		paths: string[],
		{protectAsDataRoot = true}: {protectAsDataRoot?: boolean} = {},
	) {
		const normalizedPaths = paths.map((path) => posix.normalize(path))
		for (const blockedPaths of this.#storageBlocks.values()) {
			if (normalizedPaths.some((path) => blockedPaths.some((blocked) => this.#storagePathsOverlap(path, blocked)))) {
				throw new Error('[apps-storage-blocked] Storage is being disconnected')
			}
		}

		const token = Symbol('app-storage-operation')
		this.#storageOperations.set(token, {appId, paths: normalizedPaths, protectAsDataRoot})
		let released = false
		return () => {
			if (released) return
			released = true
			this.#storageOperations.delete(token)
		}
	}

	// Register the block synchronously before inspecting apps. An operation that
	// began first is visible below; one that begins later sees the block and fails.
	// Unrelated app lifecycle work never waits on this path-specific coordination.
	async blockStoragePaths(paths: string[]) {
		const roots = paths.map((path) => posix.normalize(path))
		const token = Symbol('app-storage-block')
		this.#storageBlocks.set(token, roots)

		try {
			const appIds = new Set<string>()
			for (const operation of this.#storageOperations.values()) {
				if (operation.paths.some((path) => roots.some((root) => this.#storagePathsOverlap(path, root)))) {
					appIds.add(operation.appId)
				}
			}

			const names = new Set<string>()
			for (const root of roots) {
				for (const name of await this.getAppsUsingStorageSource(root)) names.add(name)
			}
			for (const appId of appIds) {
				const name = await this.getApp(appId)
					.readManifest()
					.then((manifest) => manifest.name)
					.catch(() => appId)
				names.add(name)
			}

			if (names.size > 0) throw new Error(`[storage-in-use-by-apps] ${[...names].join(', ')}`)

			let released = false
			return () => {
				if (released) return
				released = true
				this.#storageBlocks.delete(token)
			}
		} catch (error) {
			this.#storageBlocks.delete(token)
			throw error
		}
	}

	async #getDependencyAppIds(appId: string) {
		const appIds: string[] = []
		const visited = new Set<string>()
		const visit = async (id: string) => {
			if (visited.has(id)) return
			visited.add(id)
			appIds.push(id)
			const app = this.instances.find((candidate) => candidate.id === id)
			if (!app) return
			for (const dependencyId of await app.getDependencies()) await visit(dependencyId)
		}
		await visit(appId)
		return appIds
	}

	async getDataRootStoragePaths(appId: string) {
		const paths = new Set<string>()
		for (const id of await this.#getDependencyAppIds(appId)) {
			const location = this.#dataRootLocations.get(id)
			if (location) paths.add(location.path)
		}
		return [...paths]
	}

	async getDataRootPathsForApps(appIds: string[]) {
		const paths = new Set<string>()
		for (const appId of appIds) {
			for (const id of await this.#getDependencyAppIds(appId)) {
				paths.add(this.#dataRootLocations.get(id)?.path ?? `/Apps/${id}/data`)
			}
		}
		return [...paths]
	}

	async getAppsWithFolderAccessOverlap(virtualPath: string) {
		const path = posix.normalize(virtualPath)
		const appIds: string[] = []
		for (const app of this.instances) {
			const sourcePaths = await this.#getFolderAccessSourcePaths(app)
			if (sourcePaths.some((sourcePath) => this.#storagePathsOverlap(path, sourcePath))) appIds.push(app.id)
		}
		return appIds
	}

	// A restored backup can include a move journal referencing storage this
	// machine has never seen, where waiting for that storage to reconnect can
	// never succeed. The restored data root location is authoritative, so drop
	// the journal instead of blocking future moves on it.
	async clearRestoredDataRootMoves() {
		const appIds = (await this.#umbreld.store.get('apps')) ?? []
		for (const appId of appIds) {
			const app = new App(this.#umbreld, appId)
			const move = await app.store.get('dataRootMove')
			if (move === undefined) continue
			this.logger.log(`Dropping restored storage move journal for app ${appId}`)
			await app.store.delete('dataRootMove')
		}
	}

	setDataRootLocation(appId: string, location: AppDataRootLocation | null) {
		if (location) this.#dataRootLocations.set(appId, location)
		else this.#dataRootLocations.delete(appId)
		this.#dataRootChecks.clear()
	}

	setFolderAccessSourcePaths(appId: string, sourcePaths: string[]) {
		const normalizedPaths = [...new Set(sourcePaths.map((path) => posix.normalize(path)))]
		if (normalizedPaths.length > 0) this.#folderAccessSourcePaths.set(appId, normalizedPaths)
		else this.#folderAccessSourcePaths.delete(appId)
	}

	async refreshFolderAccessSourcePaths(app: App) {
		try {
			this.setFolderAccessSourcePaths(app.id, await app.getEffectiveFolderAccessSourcePaths())
		} catch (error) {
			this.logger.error(`Could not refresh effective folder access for ${app.id}; using saved paths`, error)
			try {
				this.setFolderAccessSourcePaths(app.id, await app.getConfiguredFolderAccessSourcePaths())
			} catch (fallbackError) {
				// Preserve the last known paths instead of briefly allowing destructive
				// operations when an app definition or settings file cannot be read.
				this.logger.error(`Could not refresh saved folder access for ${app.id}`, fallbackError)
			}
		}
	}

	// A configured folder source remains ordinary writable user storage. Protect
	// only the source itself and ancestors that would carry it along if moved;
	// descendants stay fully mutable so users and apps can manage their data.
	getFolderAccessPathRelation(
		virtualPath: string,
	): 'folder-root' | 'contains-folder-root' | 'inside-folder-root' | null {
		const path = posix.normalize(virtualPath)
		let isInsideRoot = false
		for (const sourcePaths of this.#folderAccessSourcePaths.values()) {
			for (const root of sourcePaths) {
				if (path === root) return 'folder-root'
				if (root.startsWith(`${path}/`)) return 'contains-folder-root'
				if (path.startsWith(`${root}/`)) isInsideRoot = true
			}
		}
		return isInsideRoot ? 'inside-folder-root' : null
	}

	// The selected folder remains ordinary user storage, but the managed root
	// beneath it must not be moved, deleted, or shared behind the app lifecycle.
	// Files protects the root and its ancestors from destructive actions,
	// and uses the inside relation to keep the app-owned subtree unshareable.
	getDataRootPathRelation(
		virtualPath: string,
	): 'active-root' | 'contains-root' | 'contains-active-root' | 'inside-root' | 'inside-active-root' | null {
		const path = posix.normalize(virtualPath)
		let isInsideRoot = false
		let isInsideActiveRoot = false
		const relationTo = (root: string) => {
			if (path === root) return 'root' as const
			if (root.startsWith(`${path}/`)) return 'contains-root' as const
			if (path.startsWith(`${root}/`)) return 'inside-root' as const
			return null
		}
		for (const operation of this.#storageOperations.values()) {
			if (!operation.protectAsDataRoot) continue
			for (const root of operation.paths) {
				const relation = relationTo(root)
				if (relation === 'root') return 'active-root'
				if (relation === 'contains-root') return 'contains-active-root'
				if (relation === 'inside-root') isInsideActiveRoot = true
			}
		}
		for (const location of this.#dataRootLocations.values()) {
			const relation = relationTo(location.path)
			if (relation === 'root' || relation === 'contains-root') return 'contains-root'
			if (relation === 'inside-root') isInsideRoot = true
		}
		if (isInsideActiveRoot) return 'inside-active-root'
		return isInsideRoot ? 'inside-root' : null
	}

	hasActiveStoragePathOverlap(virtualPath: string) {
		const path = posix.normalize(virtualPath)
		return [...this.#storageOperations.values()].some((operation) =>
			operation.paths.some((operationPath) => this.#storagePathsOverlap(path, operationPath)),
		)
	}

	async getRuntimeDataRootContext(
		appId: string,
		{
			requireAvailable = true,
			fallbackToInternal = false,
		}: {requireAvailable?: boolean; fallbackToInternal?: boolean} = {},
	) {
		const dataRoots: Record<string, string> = {}
		const storagePaths = new Set<string>()
		const appIds = await this.#getDependencyAppIds(appId).catch((error) => {
			if (fallbackToInternal) return [appId]
			throw error
		})
		for (const id of appIds) {
			const app = this.instances.find((candidate) => candidate.id === id)
			const internalPath = `${this.#umbreld.dataDirectory}/app-data/${id}/data`
			dataRoots[id] = app
				? await app.getDataRootSystemPath({requireAvailable}).catch((error) => {
						if (fallbackToInternal) return internalPath
						throw error
					})
				: internalPath
			const location = await app?.getDataRootLocation().catch((error) => {
				if (fallbackToInternal) return null
				throw error
			})
			if (location) storagePaths.add(location.path)
		}
		return {dataRoots, storagePaths: [...storagePaths]}
	}

	// Dependents are returned leaf-first so a provider can stop every consumer
	// before changing its storage, then restart them in reverse order.
	async getDependentAppsInStopOrder(appId: string) {
		const dependencies = new Map(
			await Promise.all(this.instances.map(async (app) => [app.id, await app.getDependencies()] as const)),
		)
		const dependents: App[] = []
		const visited = new Set([appId])
		const visit = async (dependencyId: string) => {
			for (const app of this.instances) {
				if (visited.has(app.id) || !dependencies.get(app.id)?.includes(dependencyId)) continue
				visited.add(app.id)
				await visit(app.id)
				dependents.push(app)
			}
		}
		await visit(appId)
		return dependents
	}

	// Whether a storage source path currently resolves to an accessible folder.
	// This runs for every referenced source on the frequently queried apps.list
	// path and a stat on a dead network mount can hang the libuv threadpool for
	// minutes, so checks are single-flighted per path (a hung stat is reused,
	// never duplicated) and cached briefly once they settle. The cache is
	// cleared on storage change events so recovery shows promptly.
	async isStorageSourceAvailable(virtualPath: string) {
		const ttl = 15_000
		let check = this.#storageSourceChecks.get(virtualPath)
		if (!check || (check.settledAt !== undefined && Date.now() - check.settledAt > ttl)) {
			const entry: {isDirectory: Promise<boolean>; settledAt?: number} = {
				isDirectory: (async () => {
					try {
						const systemPath = await this.#umbreld.files.virtualToSystemPath(virtualPath, OWNER_USER_ID)
						const stat = await fse.stat(systemPath)
						return stat.isDirectory()
					} catch {
						return false
					}
				})(),
			}
			entry.isDirectory.finally(() => (entry.settledAt = Date.now()))
			check = entry
			this.#storageSourceChecks.set(virtualPath, check)
		}

		return check.isDirectory
	}

	// Data roots carry a filesystem/share identity, so availability must prove
	// that the expected storage is mounted rather than merely statting a stale
	// mountpoint directory on the internal disk.
	async getDataRootStatus(location: AppDataRootLocation, {fresh = false}: {fresh?: boolean} = {}) {
		const ttl = 15_000
		const key = JSON.stringify(location)
		if (fresh) this.#dataRootChecks.delete(key)
		let check = this.#dataRootChecks.get(key)
		if (!check || (check.settledAt !== undefined && Date.now() - check.settledAt > ttl)) {
			const entry: {status: Promise<AppDataRootStatus>; settledAt?: number} = {
				status: (async () => {
					try {
						// allowMissing still verifies the expected drive/share identity, but
						// lets us distinguish a missing app directory from missing storage.
						const systemPath = await this.#umbreld.files.resolveStorageDestination(location, OWNER_USER_ID, {
							allowMissing: true,
						})
						const stat = await fse.lstat(systemPath).catch(() => null)
						return stat?.isDirectory() ? 'available' : 'data-missing'
					} catch (error) {
						if (error instanceof Error && error.message === CLOUD_DESTINATION_MISSING_ERROR) {
							return 'storage-unavailable'
						}
						return 'data-missing'
					}
				})(),
			}
			entry.status.finally(() => (entry.settledAt = Date.now()))
			check = entry
			this.#dataRootChecks.set(key, check)
		}
		return check.status
	}

	private async startAppsAwaitingStorage() {
		// Storage events can fire in bursts (e.g. a NAS with several shares coming
		// online mounts them concurrently) so runs are single-flighted with one
		// queued re-run, otherwise the same app gets multiple concurrent starts
		if (this.#storageRetryInFlight) {
			this.#storageRetryQueued = true
			return
		}
		this.#storageRetryInFlight = true
		try {
			do {
				this.#storageRetryQueued = false
				await Promise.all(
					this.instances.map(async (app) => {
						try {
							// Only retry apps that failed to start and depend on custom storage
							if (app.state !== 'unknown') return
							if (!(await app.shouldAutoStart())) return
							if ((await app.getEffectiveStorageSourcePaths()).length === 0) return

							// Re-check the state since the checks above may have raced a state change
							if (app.state !== 'unknown') return
							this.logger.log(`Storage changed, retrying start of app ${app.id}`)
							// Via startApp() so a downed app environment is repaired first
							await this.startApp(app.id)
						} catch (error) {
							this.logger.error(`Failed to start app ${app.id} after storage change`, error)
						}
					}),
				)
			} while (this.#storageRetryQueued)
		} finally {
			this.#storageRetryInFlight = false
		}
	}

	async stop() {
		return this.imageCleanup.runOperation(() => this.#stop())
	}

	async #stop() {
		// A backup restore can replace app files after shutdown. Any pending
		// cleanup must wait for the next startup to establish the installed set.
		this.imageCleanup.enabled = false
		this.logger.log('Stopping apps')
		this.#storageChangeUnsubscribes.forEach((unsubscribe) => unsubscribe())
		this.#storageChangeUnsubscribes = []
		await Promise.all(
			this.instances.map((app) =>
				app.stop().catch((error) => {
					// We handle individual errors here to prevent apps stop from throwing
					// if a single app fails.
					this.logger.error(`Failed to stop app ${app.id}`, error)
				}),
			),
		)

		this.logger.log('Stopping app environment')
		await pRetry(() => appEnvironment(this.#umbreld, 'down'), {
			onFailedAttempt: (error) => {
				this.logger.error(
					`Attempt ${error.attemptNumber} stopping app environmnet failed. There are ${error.retriesLeft} retries left.`,
				)
			},
			retries: 2,
		})
	}

	async isInstalled(appId: string) {
		return this.instances.some((app) => app.id === appId)
	}

	// ── Member shares ───────────────────────────────────────────────────────
	// Apps the owner has shared with member accounts. Shared apps show on the
	// member's desktop and are allowed through the app proxy. They do not grant
	// raw app data access under /Apps. 'all' also covers members created in the
	// future, mirroring file shares.

	// List all app shares (owner management view)
	async listMemberShares(): Promise<{appId: string; sharedWith: 'all' | string[]}[]> {
		return (await this.#umbreld.store.get('appMemberShares')) ?? []
	}

	// List the app shares that apply to a given member
	async memberSharesForUser(userId: string): Promise<{appId: string; sharedWith: 'all' | string[]}[]> {
		const shares = await this.listMemberShares()
		return shares.filter((share) => share.sharedWith === 'all' || share.sharedWith.includes(userId))
	}

	// The app ids shared with a given member. The '*' sentinel shares every
	// installed app, including apps installed in the future.
	async sharedAppIdsForUser(userId: string): Promise<string[]> {
		const shares = await this.memberSharesForUser(userId)
		if (shares.some((share) => share.appId === '*')) return this.instances.map((app) => app.id)
		return shares.map((share) => share.appId)
	}

	// Share an app with all members or a specific list of members. Upserts, so
	// sharing an already shared app updates who it's shared with.
	async addMemberShare(appId: string, sharedWith: 'all' | string[]) {
		// '*' shares all apps, including apps installed in the future
		if (appId !== '*' && !(await this.isInstalled(appId))) throw new Error('[app-not-installed]')

		// Validate the member ids exist
		if (sharedWith !== 'all') {
			const members = await this.#umbreld.user.listMembers()
			const memberIds = new Set(members.map((member) => member.id))
			const uniqueIds = [...new Set(sharedWith)]
			if (uniqueIds.length === 0) throw new Error('[no-users] Share with all users or at least one user')
			for (const id of uniqueIds) {
				if (!memberIds.has(id)) throw new Error(`[unknown-user] '${id}'`)
			}
			sharedWith = uniqueIds
		}

		const share = {appId, sharedWith}
		let previousSharedWith: 'all' | string[] = []
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const shares = (await get('appMemberShares')) ?? []
			previousSharedWith = shares.find((existingShare) => existingShare.appId === appId)?.sharedWith ?? []
			const otherShares = shares.filter((existingShare) => existingShare.appId !== appId)
			await set('appMemberShares', [...otherShares, share])
		})
		this.#emitMemberSharesChange(previousSharedWith, sharedWith)
		await this.#umbreld.auth.appAccessChanged(appId)

		this.logger.log(`Shared app ${appId} with ${sharedWith === 'all' ? 'all users' : sharedWith.join(', ')}`)
		return share
	}

	// Stop sharing an app
	async removeMemberShare(appId: string): Promise<boolean> {
		let removed = false
		let removedSharedWith: 'all' | string[] = []
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const shares = (await get('appMemberShares')) ?? []
			removedSharedWith = shares.find((share) => share.appId === appId)?.sharedWith ?? []
			const remainingShares = shares.filter((share) => share.appId !== appId)
			removed = remainingShares.length !== shares.length
			if (removed) await set('appMemberShares', remainingShares)
		})
		if (removed) {
			this.#emitMemberSharesChange(removedSharedWith)
			await this.#umbreld.auth.appAccessChanged(appId)
			this.logger.log(`Stopped sharing app ${appId}`)
		}
		return removed
	}

	// Remove a deleted member from any explicit app share lists. Shares left
	// with nobody are removed entirely, including 'all' shares once no members
	// remain — otherwise they'd linger invisibly and silently grant access to
	// the next member created.
	async removeUserFromMemberShares(userId: string) {
		const hasMembers = (await this.#umbreld.user.listMembers()).length > 0
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			const shares = (await get('appMemberShares')) ?? []
			const updatedShares = shares
				.map((share) => {
					if (share.sharedWith === 'all') return share
					return {...share, sharedWith: share.sharedWith.filter((id) => id !== userId)}
				})
				.filter((share) => (share.sharedWith === 'all' ? hasMembers : share.sharedWith.length > 0))
			await set('appMemberShares', updatedShares)
		})
		this.#emitMemberSharesChange([userId])
		await this.#umbreld.auth.appAccessChanged('*')
	}

	// Notify listeners (e.g. member UIs) which accounts an app share change
	// affects. Pass every sharedWith list the change touched (e.g. old and new
	// grantees of an upsert) so nobody who lost access misses the event.
	#emitMemberSharesChange(...sharedWithLists: ('all' | string[])[]) {
		const sharedWith = sharedWithLists.includes('all')
			? 'all'
			: [...new Set(sharedWithLists.filter((list): list is string[] => list !== 'all').flat())]
		this.#umbreld.eventBus.emit('apps:member-shares:change', {sharedWith})
	}

	getApp(appId: string) {
		const app = this.instances.find((app) => app.id === appId)
		if (!app) throw new Error(`App ${appId} not found`)

		return app
	}

	async #readCompatibleAppTemplate(appId: string) {
		const appTemplatePath = await this.#umbreld.appStore.getAppTemplateFilePath(appId)

		let manifest: AppManifest
		try {
			manifest = await readManifestInDirectory(appTemplatePath)
		} catch {
			throw new Error('App template not found')
		}
		assertManifestVersionCompatible(manifest.manifestVersion, this.#umbreld.version)

		return {appTemplatePath, manifest}
	}

	async getInstallReview(appId: string) {
		const {appTemplatePath, manifest} = await this.#readCompatibleAppTemplate(appId)
		const compose = await readComposeInDirectory(appTemplatePath)
		const requiredFolders = getFolderAccessSlots(this.#umbreld, compose, [], manifest).flatMap(
			({id, name, note, defaultSourcePath, mounts}) =>
				defaultSourcePath
					? [{id, name, note: note ?? null, defaultSourcePath, readOnly: mounts.every((mount) => mount.readOnly)}]
					: [],
		)

		return {
			requiredFolders,
			gpuAccess: manifest.permissions?.includes('GPU') ?? false,
		}
	}

	async install(appId: string, options: InstallOptions = {}) {
		return this.imageCleanup.runOperation(() => this.#installOperation(appId, options), {cleanupAfter: true})
	}

	async #installOperation(appId: string, options: InstallOptions = {}) {
		if (this.#installsInProgress.has(appId)) throw new Error(`App ${appId} is already being installed`)
		this.#installsInProgress.add(appId)
		try {
			return await this.#install(appId, options)
		} finally {
			this.#installsInProgress.delete(appId)
		}
	}

	async #install(appId: string, {alternatives, folderAccess}: InstallOptions) {
		if (await this.isInstalled(appId)) throw new Error(`App ${appId} is already installed`)

		this.logger.log(`Installing app ${appId}`)
		const {appTemplatePath, manifest} = await this.#readCompatibleAppTemplate(appId)
		// Machine port forwards and app ports share the host namespace. Check
		// the canonical machine definitions before installing so a later app
		// cannot silently steal a stable port promised to a VM.
		await this.#umbreld.machines.assertAppPortAvailable(manifest.port)

		this.logger.log(`Setting up data directory for ${appId}`)
		const appDataDirectory = `${this.#umbreld.dataDirectory}/app-data/${appId}`
		await fse.mkdirp(appDataDirectory)

		// We use rsync to copy to preserve permissions
		await $`rsync --archive --verbose --exclude ".gitkeep" ${appTemplatePath}/. ${appDataDirectory}`

		// Save reference to app instance
		const app = new App(this.#umbreld, appId)
		const dependencies = fillSelectedDependencies(manifest.dependencies, alternatives)
		// The instance becomes reachable as soon as it is added below, so claim the
		// lifecycle state before the first await. Settings and data-root changes must
		// never observe a half-installed app as idle.
		app.state = 'installing'
		app.stateProgress = 1
		this.instances.push(app)

		// Complete the install process via the app script
		try {
			// We quickly try to start the app env before installing the app. In most normal cases
			// this just quickly returns and does nothing since the app env is already running.
			// However in the case where the app env is down this ensures we start it again.
			await appEnvironment(this.#umbreld, 'up')
			await app.install({dependencies, folderAccess})
		} catch (error) {
			this.logger.error(`Failed to install app ${appId}`, error)
			this.instances = this.instances.filter((app) => app.id !== appId)
			this.#folderAccessSourcePaths.delete(appId)
			this.#umbreld.eventBus.emit('apps:state:change', {appId, state: 'not-installed'})
			await this.#umbreld.lanIngress
				.refresh()
				.catch((refreshError) =>
					this.logger.error('Failed to refresh LAN ingress after failed app install', refreshError),
				)
			throw error
		}

		// Save installed app
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			let apps = await get('apps')
			apps.push(appId)
			// Make sure we never add dupes
			// This can happen after restoring a backup with an excluded app and then reinstalling it
			apps = [...new Set(apps)]
			await set('apps', apps)
		})

		return true
	}

	async uninstall(appId: string) {
		return this.imageCleanup.runOperation(() => this.#uninstallOperation(appId), {cleanupAfter: true})
	}

	async #uninstallOperation(appId: string) {
		const dataRootPath = this.#dataRootLocations.get(appId)?.path ?? `/Apps/${appId}/data`
		if (this.hasActiveStoragePathOverlap(dataRootPath)) {
			throw new Error('[apps-settings-source-managed] App storage is currently in use')
		}
		const releaseStorageOperation = this.beginStorageOperation(appId, [dataRootPath])
		try {
			return await this.#uninstall(appId)
		} finally {
			releaseStorageOperation()
		}
	}

	async #uninstall(appId: string) {
		// If we can't read an app's dependencies for any reason just skip that app, don't abort the uninstall
		const allDependencies = await Promise.all(this.instances.map((app) => app.getDependencies().catch(() => null)))
		const isDependency = allDependencies.some((dependencies) => dependencies?.includes(appId))
		if (isDependency) throw new Error(`App ${appId} is a dependency of another app and cannot be uninstalled`)

		const app = this.getApp(appId)

		// Revoke any direct share before uninstalling so access closes immediately
		// and a crash partway through uninstall cannot leave a stale grant. The '*'
		// share is intentionally retained because it covers future installations.
		await this.removeMemberShare(appId)
		// MCP bookkeeping is best effort, a failure here must never abort the uninstall
		await this.#umbreld.mcp
			.removeAppGrant(appId)
			.catch((error) => this.logger.error(`Failed to remove MCP grant for app ${appId}`, error))

		const uninstalled = await app.uninstall()
		if (uninstalled) {
			// Remove app instance
			this.instances = this.instances.filter((app) => app.id !== appId)
			this.#dataRootLocations.delete(appId)
			this.#folderAccessSourcePaths.delete(appId)
			this.#umbreld.eventBus.emit('apps:state:change', {appId, state: 'not-installed'})

			// Close a concurrent share added while uninstall was in progress. Once the
			// instance is removed, addMemberShare() will reject further direct shares.
			await this.removeMemberShare(appId)
			await this.#umbreld.mcp
				.removeAppGrant(appId)
				.catch((error) => this.logger.error(`Failed to remove MCP grant for app ${appId}`, error))
		}
		return uninstalled
	}

	async startApp(appId: string) {
		return this.imageCleanup.runOperation(() => this.#startApp(appId))
	}

	async #startApp(appId: string) {
		const app = this.getApp(appId)

		// We quickly try to start the app env before starting the app. In most normal cases
		// this just quickly returns and does nothing since the app env is already running.
		// However in the case where the app env is down this ensures we start it again.
		await appEnvironment(this.#umbreld, 'up')
		return app.start()
	}

	async restart(appId: string) {
		return this.imageCleanup.runOperation(() => this.#restart(appId))
	}

	async #restart(appId: string) {
		const app = this.getApp(appId)

		// We quickly try to start the app env before restarting the app. In most normal cases
		// this just quickly returns and does nothing since the app env is already running.
		// However in the case where the app env is down this ensures we start it again.
		await appEnvironment(this.#umbreld, 'up')
		return app.restart()
	}

	async update(appId: string) {
		return this.imageCleanup.runOperation(() => this.#update(appId), {cleanupAfter: true})
	}

	async #update(appId: string) {
		const app = this.getApp(appId)
		await this.#readCompatibleAppTemplate(appId)

		return app.update()
	}

	async trackOpen(appId: string) {
		const app = this.getApp(appId)

		// Save installed app
		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			let recentlyOpenedApps = await get('recentlyOpenedApps')

			// Add app.id to the beginning of the array
			recentlyOpenedApps.unshift(app.id)

			// Remove duplicates
			recentlyOpenedApps = [...new Set(recentlyOpenedApps)]

			// Limit to 10
			recentlyOpenedApps = recentlyOpenedApps.slice(0, 10)

			await set('recentlyOpenedApps', recentlyOpenedApps)
		})

		return true
	}

	async recentlyOpened() {
		return this.#umbreld.store.get('recentlyOpenedApps')
	}

	async setTorEnabled(torEnabled: boolean) {
		return this.imageCleanup.runOperation(() => this.#setTorEnabled(torEnabled))
	}

	async #setTorEnabled(torEnabled: boolean) {
		if (this.isTorBeingToggled) {
			throw new Error(
				'Tor is already in the process of being toggled. Please wait until the current process is finished.',
			)
		}
		this.isTorBeingToggled = true
		try {
			const currentTorEnabled = await this.#umbreld.store.get('torEnabled')

			// Check if we're applying the current setting
			if (currentTorEnabled === torEnabled) {
				throw new Error(`Tor is already ${torEnabled ? 'enabled' : 'disabled'}`)
			}

			// Toggle Tor
			await this.stop()
			await this.#umbreld.store.set('torEnabled', torEnabled)
			await this.start()

			return true
		} finally {
			this.isTorBeingToggled = false
		}
	}

	async getTorEnabled() {
		return this.#umbreld.store.get('torEnabled')
	}

	async setSelectedDependencies(appId: string, dependencies: Record<string, string>) {
		const app = this.getApp(appId)
		return app.setSelectedDependencies(dependencies)
	}

	// All app settings (proxy auth, storage, environment) save through this one
	// method: one write, one restart
	async setSettings(appId: string, settings: AppSettingsUpdate) {
		const app = this.getApp(appId)
		return app.setSettings(settings)
	}

	async moveDataRoot(appId: string, destinationParentPath: string | null) {
		return this.getApp(appId).moveDataRoot(destinationParentPath)
	}

	async resetDataRoot(appId: string) {
		return this.getApp(appId).resetDataRoot()
	}

	async getDependents(appId: string) {
		const allDependencies = await Promise.all(
			this.instances.map(async (app) => ({
				id: app.id,
				// If we can't read an app's dependencies for any reason just skip that app, don't abort
				dependencies: await app.getDependencies().catch(() => [] as string[]),
			})),
		)
		return allDependencies.filter(({dependencies}) => dependencies.includes(appId)).map(({id}) => id)
	}

	async setHideCredentialsBeforeOpen(appId: string, value: boolean) {
		const app = this.getApp(appId)
		return app.store.set('hideCredentialsBeforeOpen', value)
	}
}
