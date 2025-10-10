import crypto from 'node:crypto'
import nodePath from 'node:path'

import fse from 'fs-extra'
import yaml from 'js-yaml'
import {type Compose} from 'compose-spec-schema'
import {$} from 'execa'
import fetch from 'node-fetch'
import stripAnsi from 'strip-ansi'
import pRetry from 'p-retry'

import getDirectorySize from '../utilities/get-directory-size.js'
import {pullAll} from '../utilities/docker-pull.js'
import FileStore from '../utilities/file-store.js'
import {fillSelectedDependencies} from '../utilities/dependencies.js'
import type Umbreld from '../../index.js'
import {validateManifest, type AppSettings} from './schema.js'
import appScript from './legacy-compat/app-script.js'

async function readYaml(path: string) {
	return yaml.load(await fse.readFile(path, 'utf8'))
}

async function writeYaml(path: string, data: any) {
	return fse.writeFile(path, yaml.dump(data))
}

export async function readManifestInDirectory(dataDirectory: string) {
	const parseYaml = readYaml(`${dataDirectory}/umbrel-app.yml`)
	return parseYaml.then(validateManifest)
}

type AppState =
	| 'unknown'
	| 'installing'
	| 'starting'
	| 'running'
	| 'stopping'
	| 'stopped'
	| 'restarting'
	| 'uninstalling'
	| 'updating'
	| 'ready'
// TODO: Change ready to running.
// Also note that we don't currently handle failing events to update the app state into a failed state.
// That should be ok for now since apps rarely fail, but there will be the potential for state bugs here
// where the app instance state gets out of sync with the actual state of the app.
// We can handle this much more robustly in the future.

export default class App {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	id: string
	dataDirectory: string
	state: AppState = 'unknown'
	stateProgress = 0
	store: FileStore<AppSettings>

	constructor(umbreld: Umbreld, appId: string) {
		// Throw on invalid appId
		if (!/^[a-zA-Z0-9-_]+$/.test(appId)) throw new Error(`Invalid app ID: ${appId}`)

		this.#umbreld = umbreld
		this.id = appId
		this.dataDirectory = `${umbreld.dataDirectory}/app-data/${this.id}`
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLowerCase())
		this.store = new FileStore({filePath: `${this.dataDirectory}/settings.yml`})
	}

	readManifest() {
		return readManifestInDirectory(this.dataDirectory)
	}

	readCompose() {
		return readYaml(`${this.dataDirectory}/docker-compose.yml`) as Promise<Compose>
	}

	async readHiddenService() {
		try {
			return await fse.readFile(`${this.#umbreld.dataDirectory}/tor/data/app-${this.id}/hostname`, 'utf-8')
		} catch (error) {
			this.logger.error(`Failed to read hidden service for app ${this.id}`, error)
			return ''
		}
	}

	async deriveDeterministicPassword() {
		const umbrelSeed = await fse.readFile(`${this.#umbreld.dataDirectory}/db/umbrel-seed/seed`)
		const identifier = `app-${this.id}-seed-APP_PASSWORD`
		const deterministicPassword = crypto.createHmac('sha256', umbrelSeed).update(identifier).digest('hex')

		return deterministicPassword
	}

	writeCompose(compose: Compose) {
		return writeYaml(`${this.dataDirectory}/docker-compose.yml`, compose)
	}

	async patchComposeFile() {
		const manifest = await this.readManifest()
		const appRequestsGpuAccess = manifest.permissions?.includes('GPU')
		const DRI_DEVICE_PATH = '/dev/dri'
		const deviceHasGpu = await fse.exists(DRI_DEVICE_PATH).catch(() => false)

		const compose = await this.readCompose()
		for (const serviceName of Object.keys(compose.services!)) {
			// Temporary patch to fix contianer names for modern docker-compose installs.
			// The contianer name scheme used to be <project-name>_<service-name>_1 but
			// recent versions of docker-compose use <project-name>-<service-name>-1
			// swapping underscores for dashes. This breaks Umbrel in places where the
			// containers are referenced via name and it also breaks referring to other
			// containers via DNS since the hostnames are derived with the same method.
			// We manually force all container names to the old scheme to maintain compatibility.
			if (!compose.services![serviceName].container_name) {
				compose.services![serviceName].container_name = `${this.id}_${serviceName}_1`
			}

			// Migrate downloads volume from old `${UMBREL_ROOT}/data/storage/downloads` path to new
			// `${UMBREL_ROOT}/home/Downloads` path. Also handle raw data directory migration from
			// `${UMBREL_ROOT}/data/storage` to `${UMBREL_ROOT}/home`.
			// We need to do this here to handle any future app updates.
			compose.services![serviceName].volumes = compose.services![serviceName].volumes?.map((volume) => {
				return (volume as string)
					?.replace('/data/storage/downloads', `/home/Downloads`)
					?.replace('/data/storage', `/home`)
			})

			// Pass through host DRI device to all app containers if the app requests it
			const shouldEnableGpuPassthrough = appRequestsGpuAccess && deviceHasGpu
			if (shouldEnableGpuPassthrough) {
				compose.services![serviceName].devices = compose.services![serviceName].devices || []
				compose.services![serviceName].devices.push(DRI_DEVICE_PATH)
			}
		}

		await this.writeCompose(compose)
	}

	async pull() {
		const defaultImages = [
			'getumbrel/app-proxy:1.0.0@sha256:49eb600c4667c4b948055e33171b42a509b7e0894a77e0ca40df8284c77b52fb',
			'getumbrel/tor:0.4.7.8@sha256:2ace83f22501f58857fa9b403009f595137fa2e7986c4fda79d82a8119072b6a',
		]
		const compose = await this.readCompose()
		const images = Object.values(compose.services!)
			.map((service) => service.image)
			.filter(Boolean) as string[]
		await pullAll([...defaultImages, ...images], (progress) => {
			this.stateProgress = Math.max(1, progress * 99)
			this.logger.log(`Downloaded ${this.stateProgress}% of app ${this.id}`)
		})
	}

	async install() {
		this.state = 'installing'
		this.stateProgress = 1

		await this.patchComposeFile()
		await this.pull()

		await pRetry(() => appScript(this.#umbreld, 'install', this.id), {
			onFailedAttempt: (error) => {
				this.logger.error(
					`Attempt ${error.attemptNumber} installing app ${this.id} failed. There are ${error.retriesLeft} retries left.`,
					error,
				)
			},
			retries: 2,
		})
		this.state = 'ready'
		this.stateProgress = 0

		return true
	}

	async update() {
		this.state = 'updating'
		this.stateProgress = 1

		// TODO: Pull images here before the install script and calculate live progress for
		// this.stateProgress so button animations work

		this.logger.log(`Updating app ${this.id}`)

		// Get a reference to the old images
		const compose = await this.readCompose()
		const oldImages = Object.values(compose.services!)
			.map((service) => service.image)
			.filter(Boolean) as string[]

		// Update the app, patching the compose file half way through
		await appScript(this.#umbreld, 'pre-patch-update', this.id)
		await this.patchComposeFile()
		await this.pull()
		await appScript(this.#umbreld, 'post-patch-update', this.id)

		// Delete the old images if we can. Silently fail on error cos docker
		// will return an error even if only one image is still needed.
		try {
			await $({stdio: 'inherit'})`docker rmi ${oldImages}`
		} catch {}

		this.state = 'ready'
		this.stateProgress = 0

		return true
	}

	async start() {
		this.logger.log(`Starting app ${this.id}`)
		this.state = 'starting'
		// We re-run the patch here to fix an edge case where 0.5.x imported apps
		// wont run because they haven't been patched.
		await this.patchComposeFile()
		await pRetry(() => appScript(this.#umbreld, 'start', this.id), {
			onFailedAttempt: (error) => {
				this.logger.error(
					`Attempt ${error.attemptNumber} starting app ${this.id} failed. There are ${error.retriesLeft} retries left.`,
					error,
				)
			},
			retries: 2,
		})
		this.state = 'ready'

		return true
	}

	async stop() {
		this.state = 'stopping'
		await pRetry(() => appScript(this.#umbreld, 'stop', this.id), {
			onFailedAttempt: (error) => {
				this.logger.error(
					`Attempt ${error.attemptNumber} stopping app ${this.id} failed. There are ${error.retriesLeft} retries left.`,
					error,
				)
			},
			retries: 2,
		})
		this.state = 'stopped'

		return true
	}

	async restart() {
		this.state = 'restarting'
		await appScript(this.#umbreld, 'stop', this.id)
		await appScript(this.#umbreld, 'start', this.id)
		this.state = 'ready'

		return true
	}

	async uninstall() {
		this.state = 'uninstalling'
		await pRetry(() => appScript(this.#umbreld, 'stop', this.id), {
			onFailedAttempt: (error) => {
				this.logger.error(
					`Attempt ${error.attemptNumber} stopping app ${this.id} failed. There are ${error.retriesLeft} retries left.`,
					error,
				)
			},
			retries: 2,
		})
		await appScript(this.#umbreld, 'nuke-images', this.id)
		await fse.remove(this.dataDirectory)

		await this.#umbreld.store.getWriteLock(async ({get, set}) => {
			let apps = (await get('apps')) || []
			apps = apps.filter((appId) => appId !== this.id)
			await set('apps', apps)

			// Remove app from recentlyOpenedApps
			let recentlyOpenedApps = (await get('recentlyOpenedApps')) || []
			recentlyOpenedApps = recentlyOpenedApps.filter((appId) => appId !== this.id)
			await set('recentlyOpenedApps', recentlyOpenedApps)

			// Disable any associated widgets
			let widgets = (await get('widgets')) || []
			widgets = widgets.filter((widget) => !widget.startsWith(`${this.id}:`))
			await set('widgets', widgets)
		})

		return true
	}

	async getPids() {
		const compose = await this.readCompose()
		const containers = Object.values(compose.services!).map((service) => service.container_name) as string[]
		containers.push(`${this.id}_app_proxy_1`)
		containers.push(`${this.id}_tor_server_1`)
		try {
			// If we fail to get the PIDs of one container, skip it and continue for
			// the other containers. We'll expect to get it on some misses for the app
			// proxy and tor server containers.
			const cmd = containers.map((container) => `docker top ${container} -o pid 2>/dev/null || true`).join('\n')
			const {stdout} = await $({shell: true})`${cmd}`
			return stdout
				.split('\n') // Split on newline
				.map((line) => line.trim()) // Trim whitespace
				.filter((line) => /^([1-9][0-9]*|0)$/.test(line)) // Keep only integers
				.map((line) => parseInt(line, 10)) // And convert
		} catch (error) {
			this.logger.error(`Failed to get pids for app ${this.id}`, error)
			return []
		}
	}

	async getDiskUsage() {
		try {
			// Disk usage calculations can fail if the app is rapidly moving files around
			// since files in directories will be listed and then iterated over to have
			// their size summed up. If a file is moved between these two operations it
			// will fail. It happens rarely so simply retrying will catch most cases.
			return await pRetry(() => getDirectorySize(this.dataDirectory), {retries: 2})
		} catch (error) {
			this.logger.error(`Failed to get disk usage for app ${this.id}`, error)
			return 0
		}
	}

	async getLogs() {
		const inheritStdio = false
		const result = await appScript(this.#umbreld, 'logs', this.id, inheritStdio)
		return stripAnsi(result.stdout)
	}

	async getContainerIp(service: string) {
		// Retrieve the container name from the compose file
		// This works because we have a temporary patch to force all container names to the old Compose scheme to maintain compatibility between Compose v1 and v2
		const compose = await this.readCompose()
		const containerName = compose.services![service].container_name

		if (!containerName) throw new Error(`No container_name found for service ${service} in app ${this.id}`)

		const {stdout: containerIp} =
			await $`docker inspect -f {{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}} ${containerName}`

		return containerIp
	}

	// Returns a validated list of paths that should be ignored when backing up the app
	// This allows apps to signal to umbrelOS noncritical high churn or high data files
	// that can be ignored from backups like logs/cache/blockchain data/etc.
	async getBackupIgnoredFilePaths() {
		const manifest = await this.readManifest()
		if (!manifest.backupIgnore) return []

		// Sanitise paths
		const backupIgnore = []
		for (let path of manifest.backupIgnore) {
			// Only allow a limited subset of chars to strip out traversals and other weird stuff we don't want to allow
			// while supporting simple '*' globbing that Kopia understands in .kopiaignore
			// TODO: consider adding other globbing chars like '?' (single-char wildcard) and '**' (recursive wildcard).
			if (!/^[-a-zA-Z0-9._\/*]+$/.test(path)) {
				this.logger.error(`Invalid backupIgnore path ${path} for app ${this.id}, skipping`)
				continue // Skip invalid paths
			}

			// Convert to absolute path and normalise traversals
			path = nodePath.join(this.dataDirectory, path)

			// Ensure path doesn't escape the app's data directory
			if (!path.startsWith(this.dataDirectory)) {
				this.logger.error(`Invalid backupIgnore path ${path} for app ${this.id}, skipping`)
				continue // Skip paths that escape the app's data directory
			}

			// Save the sanitised path
			backupIgnore.push(path)
		}

		return backupIgnore
	}

	// Returns a specific widget's info from an app's manifest
	async getWidgetMetadata(widgetName: string) {
		const manifest = await this.readManifest()
		if (!manifest.widgets) throw new Error(`No widgets found for app ${this.id}`)

		const widgetMetadata = manifest.widgets.find((widget) => widget.id === widgetName)
		if (!widgetMetadata) throw new Error(`Invalid widget ${widgetName} for app ${this.id}`)

		return widgetMetadata
	}

	// Returns a specific widget's data
	async getWidgetData(widgetId: string) {
		// Get widget info from the app's manifest
		const widgetMetadata = await this.getWidgetMetadata(widgetId)

		const url = new URL(`http://${widgetMetadata.endpoint}`)
		const service = url.hostname

		url.hostname = await this.getContainerIp(service)

		try {
			const response = await fetch(url)

			if (!response.ok) throw new Error(`Failed to fetch data from ${url}: ${response.statusText}`)

			const widgetData = (await response.json()) as {[key: string]: any}
			return widgetData
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Failed to fetch data from ${url}: ${error.message}`)
			} else {
				throw new Error(`An unexpected error occured while fetching data from ${url}: ${error}`)
			}
		}
	}

	// Get the app's dependencies with selected dependencies applied
	async getDependencies() {
		const [{dependencies}, selectedDependencies] = await Promise.all([
			this.readManifest(),
			this.getSelectedDependencies(),
		])
		return dependencies?.map((dependencyId) => selectedDependencies?.[dependencyId] ?? dependencyId) ?? []
	}

	// Get the app's selected dependencies
	async getSelectedDependencies() {
		const [{dependencies}, selectedDependencies] = await Promise.all([
			this.readManifest(),
			this.store.get('dependencies'),
		])
		return fillSelectedDependencies(dependencies, selectedDependencies)
	}

	// Set the app's selected dependencies
	async setSelectedDependencies(selectedDependencies: Record<string, string>) {
		const {dependencies} = await this.readManifest()
		const filledSelectedDependencies = fillSelectedDependencies(dependencies, selectedDependencies)
		const success = await this.store.set('dependencies', filledSelectedDependencies)
		if (success) {
			this.restart().catch((error) => {
				this.logger.error(`Failed to restart '${this.id}'`, error)
			})
		}
		return success
	}

	// Check if app is ignored from backups
	async isBackupIgnored() {
		return (await this.store.get('backupIgnore')) || false
	}

	// Set if app is ignored from backups
	async setBackupIgnored(backupIgnore: boolean) {
		return this.store.set('backupIgnore', backupIgnore)
	}
}
