import crypto from 'node:crypto'
import {constants as fsConstants} from 'node:fs'
import {open} from 'node:fs/promises'
import nodePath from 'node:path'
import {setTimeout} from 'node:timers/promises'

import fse from 'fs-extra'
import yaml from 'js-yaml'
import {type Compose} from 'compose-spec-schema'
import {$} from 'execa'
import fetch from 'node-fetch'
import stripAnsi from 'strip-ansi'
import pRetry from 'p-retry'

import getDirectorySize from '../utilities/get-directory-size.js'
import {
	applyGpuAccelerationToService,
	getGpuAcceleration,
	removeGpuAccelerationFromService,
	removeLegacyDriDeviceMappingsFromService,
	type AppliedGpuAcceleration,
} from '../hardware/gpu.js'
import {pullAll} from '../utilities/docker-pull.js'
import {copyWithProgress} from '../utilities/copy-with-progress.js'
import {removeDurably, renameDurably, syncDirectoryTree, writeFileDurably} from '../utilities/durable-filesystem.js'
import FileStore from '../utilities/file-store.js'
import {fillSelectedDependencies} from '../utilities/dependencies.js'
import type Umbreld from '../../index.js'
import {
	AppCustomMountSchema,
	AppCustomEnvironmentVariableSchema,
	AppDataRootLocationSchema,
	AppDataRootMoveSchema,
	AppEnvironmentVariableSchema,
	AppManifestEnvironmentVariableSchema,
	AppManifestFolderAccessSchema,
	AppFolderAccessSelectionSchema,
	validateManifest,
	type AppCustomMount,
	type AppCustomEnvironmentVariable,
	type AppDataRootLocation,
	type AppDataRootMove,
	type AppEnvironmentVariable,
	type AppManifest,
	type AppManifestEnvironmentVariable,
	type AppFolderAccessSelection,
	type AppSettings,
} from './schema.js'
import appScript from './legacy-compat/app-script.js'
import {readAppGatewayConfig} from '../app-gateway/app-gateway.js'
import {OWNER_USER_ID} from '../user/constants.js'

async function readYaml(path: string) {
	return yaml.load(await fse.readFile(path, 'utf8'))
}

async function writeYaml(path: string, data: any) {
	return fse.writeFile(path, yaml.dump(data))
}

function readEnvironmentValue(environment: unknown, key: string) {
	if (Array.isArray(environment)) {
		for (const value of environment) {
			if (typeof value !== 'string') continue

			const equalsIndex = value.indexOf('=')
			if (equalsIndex === -1) continue

			const environmentKey = value.slice(0, equalsIndex)
			if (environmentKey === key) return value.slice(equalsIndex + 1)
		}
	}

	if (environment && typeof environment === 'object') {
		const value = (environment as Record<string, unknown>)[key]
		if (value !== undefined && value !== null) return String(value)
	}
}

type ParsedVolume = {
	source: string
	target: string
	readOnly: boolean
}

type ParsedComposeMount = ParsedVolume & {
	serviceName: string
}

export type AppFolderAccessSlot = {
	id: string
	name: string
	note?: string
	mounts: Array<{
		serviceName: string
		targetPath: string
		readOnly: boolean
	}>
	defaultSourcePath: string | null
	sourcePath: string | null
}

type ResolvedSettingsMount = {
	serviceName: string
	targetPath: string
	sourcePath: string
	readOnly: boolean
	systemSourcePath: string
}

type ResolvedCustomMount = AppCustomMount & ResolvedSettingsMount

type ResolvedFolderAccess = AppFolderAccessSelection & {
	mounts: ResolvedSettingsMount[]
}

// A partial settings save: undefined fields are left untouched, and null clears
// the auth override so the app follows its default
export type AppSettingsUpdate = {
	appProxyAuthEnabled?: boolean | null
	customMounts?: AppCustomMount[]
	folderAccess?: AppFolderAccessSelection[]
	environment?: AppEnvironmentVariable[]
	customEnvironment?: AppCustomEnvironmentVariable[]
	dependencies?: Record<string, string>
}

const APP_PROXY_SERVICE_NAME = 'app_proxy'
const APP_DATA_ROOT_MOVE_MARKER_PREFIX = '.umbrel-moving-'
const CUSTOM_MOUNT_SOURCE_ROOTS = ['/Home', '/External', '/Network'] as const
const ENVIRONMENT_VARIABLE_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseServiceVolume(volume: unknown): ParsedVolume | null {
	if (typeof volume === 'string') {
		const [source, target, ...options] = volume.split(':')
		if (!source) return null
		if (!target) return {source: '', target: source, readOnly: false}

		return {
			source,
			target,
			readOnly: options.some((option) => option.split(',').includes('ro')),
		}
	}

	if (!isRecord(volume)) return null

	const source = volume.source ?? volume.src ?? volume.host
	const target = volume.target ?? volume.dst ?? volume.destination
	if (typeof target !== 'string' || (source !== undefined && typeof source !== 'string')) return null

	return {
		source: source ?? '',
		target,
		readOnly: volume.read_only === true,
	}
}

function mapServiceVolumeSource<T>(volume: T, mapSource: (source: string) => string): T {
	if (typeof volume === 'string') {
		const separatorIndex = volume.indexOf(':')
		if (separatorIndex === -1) return volume

		const source = volume.slice(0, separatorIndex)
		return `${mapSource(source)}${volume.slice(separatorIndex)}` as T
	}

	if (!isRecord(volume)) return volume

	for (const key of ['source', 'src', 'host']) {
		if (typeof volume[key] !== 'string') continue
		return {...volume, [key]: mapSource(volume[key])} as T
	}

	return volume
}

function redirectAppDataRootSource(source: string) {
	for (const dataDirectory of ['${APP_DATA_DIR}/data', '$APP_DATA_DIR/data']) {
		if (source === dataDirectory) return '${APP_DATA_ROOT}'
		if (!source.startsWith(`${dataDirectory}/`)) continue

		const relativePath = source.slice(dataDirectory.length + 1)
		const normalizedPath = nodePath.posix.normalize(relativePath)
		if (nodePath.posix.isAbsolute(relativePath) || normalizedPath === '..' || normalizedPath.startsWith('../')) {
			throw new Error('[apps-data-root-invalid-compose] App data mounts cannot escape APP_DATA_DIR/data')
		}

		return '${APP_DATA_ROOT}/' + relativePath
	}

	return source
}

function getAppDataRootRelativeSource(source: string) {
	if (source === '${APP_DATA_ROOT}') return ''
	if (!source.startsWith('${APP_DATA_ROOT}/')) return null

	const relativePath = source.slice('${APP_DATA_ROOT}/'.length)
	const normalizedPath = nodePath.posix.normalize(relativePath)
	if (nodePath.posix.isAbsolute(relativePath) || normalizedPath === '..' || normalizedPath.startsWith('../')) {
		throw new Error('[apps-data-root-invalid-compose] App data mounts cannot escape APP_DATA_ROOT')
	}
	return normalizedPath === '.' ? '' : normalizedPath
}

function disableAppDataRootHostPathCreation<T>(volume: T): T {
	const parsedVolume = parseServiceVolume(volume)
	if (!parsedVolume || getAppDataRootRelativeSource(parsedVolume.source) === null) return volume

	if (typeof volume === 'string') {
		const bind: Record<string, unknown> = {create_host_path: false}
		let consistency: string | undefined
		const options = volume
			.split(':')
			.slice(2)
			.flatMap((option) => option.split(','))
			.filter(Boolean)

		for (const option of options) {
			if (option === 'ro' || option === 'rw') continue
			if (['private', 'rprivate', 'shared', 'rshared', 'slave', 'rslave'].includes(option)) {
				bind.propagation = option
				continue
			}
			if (option === 'z' || option === 'Z') {
				bind.selinux = option
				continue
			}
			if (option === 'consistent' || option === 'cached' || option === 'delegated') {
				consistency = option
				continue
			}
			throw new Error(`[apps-data-root-invalid-compose] Unsupported app data bind option '${option}'`)
		}

		return {
			type: 'bind',
			source: parsedVolume.source,
			target: parsedVolume.target,
			read_only: parsedVolume.readOnly,
			...(consistency ? {consistency} : {}),
			bind,
		} as T
	}

	if (!isRecord(volume)) return volume
	return {
		...volume,
		type: 'bind',
		bind: {
			...(isRecord(volume.bind) ? volume.bind : {}),
			create_host_path: false,
		},
	} as T
}

function normalizeContainerPath(path: string) {
	if (!nodePath.posix.isAbsolute(path))
		throw new Error(`[apps-settings-invalid-container-path] Container path '${path}' must be absolute`)

	// Strip trailing slashes so '/data' and '/data/' resolve to the same mount key
	const normalizedPath = nodePath.posix.normalize(path).replace(/\/+$/, '')
	if (normalizedPath === '')
		throw new Error(`[apps-settings-invalid-container-path] Container path '${path}' cannot be the root path`)
	if (normalizedPath.includes('\0') || /[\r\n]/.test(normalizedPath))
		throw new Error(`[apps-settings-invalid-container-path] Invalid container path '${path}'`)

	return normalizedPath
}

function getCustomMountKey(serviceName: string, targetPath: string) {
	return `${serviceName}:${targetPath}`
}

function isDataRootParentPath(path: string) {
	if (!path.startsWith('/')) return false
	const segments = path.split('/').filter(Boolean)
	return segments[0] === 'External' && segments.length >= 2
}

function dataRootLocationsEqual(first: AppDataRootLocation | null, second: AppDataRootLocation | null) {
	if (!first || !second) return first === second
	return (
		first.path === second.path &&
		first.filesystemUuid === second.filesystemUuid &&
		first.host === second.host &&
		first.share === second.share
	)
}

function normalizeVirtualPath(path: string) {
	if (!nodePath.posix.isAbsolute(path))
		throw new Error(`[apps-settings-invalid-source-path] Source path '${path}' must be absolute`)

	const normalizedPath = nodePath.posix.normalize(path)
	if (normalizedPath.includes('\0') || /[\r\n]/.test(normalizedPath))
		throw new Error(`[apps-settings-invalid-source-path] Invalid source path '${path}'`)

	return normalizedPath
}

function isAllowedCustomMountSourcePath(path: string) {
	const segments = path.split('/').filter(Boolean)
	const root = `/${segments[0]}` as (typeof CUSTOM_MOUNT_SOURCE_ROOTS)[number]

	if (!CUSTOM_MOUNT_SOURCE_ROOTS.includes(root)) return false
	if (root === '/Home') return true
	if (root === '/External') return segments.length >= 2
	if (root === '/Network') return segments.length >= 3

	return false
}

function normalizeAllowedSourcePath(path: string) {
	const normalizedPath = normalizeVirtualPath(path.trim())
	if (!isAllowedCustomMountSourcePath(normalizedPath)) {
		throw new Error(
			`[apps-settings-source-not-allowed] Source path '${normalizedPath}' must be in /Home, /External, or a /Network share`,
		)
	}

	return normalizedPath
}

function migrateLegacyStorageSource(source: string) {
	return source.replace('/data/storage/downloads', '/home/Downloads').replace('/data/storage', '/home')
}

function isDownloadsPath(path: string) {
	return path === '/Home/Downloads' || path.startsWith('/Home/Downloads/')
}

function getFolderAccessName(path: string) {
	if (path === '/Home/Downloads') return 'Downloads'
	const name = nodePath.posix.basename(path).replace(/[-_]+/g, ' ').trim()
	return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Folder'
}

function getConfigurableServiceNames(compose: Compose) {
	return Object.keys(compose.services ?? {}).filter((serviceName) => serviceName !== APP_PROXY_SERVICE_NAME)
}

function getComposeMounts(compose: Compose): ParsedComposeMount[] {
	const mounts: ParsedComposeMount[] = []
	const services = compose.services ?? {}

	for (const serviceName of getConfigurableServiceNames(compose)) {
		const service = services[serviceName]
		const volumes = Array.isArray(service?.volumes) ? service.volumes : []

		for (const volume of volumes) {
			const parsedVolume = parseServiceVolume(volume)
			if (!parsedVolume) continue

			let targetPath: string
			try {
				targetPath = normalizeContainerPath(parsedVolume.target)
			} catch {
				continue
			}

			mounts.push({...parsedVolume, serviceName, target: targetPath})
		}
	}

	return mounts
}

export function getFolderAccessSlots(
	umbreld: Umbreld,
	compose: Compose,
	selections: AppFolderAccessSelection[],
	manifest: AppManifest,
): AppFolderAccessSlot[] {
	const serviceNames = getConfigurableServiceNames(compose)
	const composeMounts = getComposeMounts(compose)
	const composeMountsByKey = new Map(
		composeMounts.map((mount) => [getCustomMountKey(mount.serviceName, mount.target), mount]),
	)
	const selectionsById = new Map<string, AppFolderAccessSelection>()
	for (const folder of selections) {
		const id = folder.id.trim()
		if (id) selectionsById.set(id, folder)
	}
	const seenSlotIds = new Set<string>()
	const seenMountKeys = new Set<string>()
	const slots: AppFolderAccessSlot[] = []
	const declaredFolders = Array.isArray(manifest.folderAccess) ? manifest.folderAccess : []
	const composeSourceToVirtualPath = (source: string) => {
		const expandedSource = migrateLegacyStorageSource(
			source.replace(/^\$\{UMBREL_ROOT\}/, umbreld.dataDirectory).replace(/^\$UMBREL_ROOT/, umbreld.dataDirectory),
		)
		try {
			return normalizeAllowedSourcePath(umbreld.files.systemToVirtualPath(expandedSource))
		} catch {
			return null
		}
	}
	const addSlot = ({id, name, note, mounts, defaultSourcePath}: Omit<AppFolderAccessSlot, 'sourcePath'>) => {
		if (!id || !name || mounts.length === 0 || seenSlotIds.has(id)) return
		const mountKeys = mounts.map((mount) => getCustomMountKey(mount.serviceName, mount.targetPath))
		if (new Set(mountKeys).size !== mountKeys.length || mountKeys.some((key) => seenMountKeys.has(key))) return

		seenSlotIds.add(id)
		for (const key of mountKeys) seenMountKeys.add(key)

		const savedFolder = selectionsById.get(id)
		let sourcePath: string | null = null
		if (savedFolder) {
			try {
				sourcePath = normalizeAllowedSourcePath(savedFolder.sourcePath)
			} catch {
				// Ignore malformed saved settings so app updates can drop stale folder access safely.
			}
		}

		slots.push({id, name, note, mounts, defaultSourcePath, sourcePath})
	}

	for (const folderInput of declaredFolders) {
		const parsedFolder = AppManifestFolderAccessSchema.safeParse(folderInput)
		if (!parsedFolder.success) continue

		const folder = parsedFolder.data
		const id = folder.id.trim()
		const name = folder.name.trim()
		const mounts: AppFolderAccessSlot['mounts'] = []
		let invalid = false
		for (const declaredMount of folder.mounts) {
			const serviceName = declaredMount.service?.trim() ?? (serviceNames.length === 1 ? serviceNames[0] : '')
			if (!serviceNames.includes(serviceName)) {
				invalid = true
				break
			}

			let targetPath: string
			try {
				targetPath = normalizeContainerPath(declaredMount.targetPath.trim())
			} catch {
				invalid = true
				break
			}

			const existingMount = composeMountsByKey.get(getCustomMountKey(serviceName, targetPath))
			mounts.push({
				serviceName,
				targetPath,
				readOnly: declaredMount.readOnly ?? existingMount?.readOnly ?? false,
			})
		}
		if (invalid) continue

		const defaultSources = mounts.map((mount) => {
			const composeMount = composeMountsByKey.get(getCustomMountKey(mount.serviceName, mount.targetPath))
			return composeMount ? composeSourceToVirtualPath(composeMount.source) : null
		})
		const defaultSourcePath =
			defaultSources.length > 0 && defaultSources.every((source) => source && source === defaultSources[0])
				? defaultSources[0]
				: null

		addSlot({id, name, note: folder.note, mounts, defaultSourcePath})
	}

	// Existing apps already mount Umbrel's shared Downloads folder in Compose.
	// Turn those mounts into a friendly configurable folder without requiring
	// an App Store update or relying on newer manifest metadata.
	const downloadsGroups = new Map<string, AppFolderAccessSlot['mounts']>()
	for (const mount of composeMounts) {
		const mountKey = getCustomMountKey(mount.serviceName, mount.target)
		if (seenMountKeys.has(mountKey)) continue
		const sourcePath = composeSourceToVirtualPath(mount.source)
		if (!sourcePath || !isDownloadsPath(sourcePath)) continue

		const group = downloadsGroups.get(sourcePath) ?? []
		group.push({serviceName: mount.serviceName, targetPath: mount.target, readOnly: mount.readOnly})
		downloadsGroups.set(sourcePath, group)
	}

	for (const [sourcePath, mounts] of downloadsGroups) {
		const relativePath = nodePath.posix.relative('/Home/Downloads', sourcePath)
		addSlot({
			id: relativePath ? `umbrel-downloads:${relativePath}` : 'umbrel-downloads',
			name: getFolderAccessName(sourcePath),
			mounts,
			defaultSourcePath: sourcePath,
		})
	}

	return slots
}

// Escape '$' as '$$' in every string value so Docker Compose interpolation
// leaves generated override values literal. Keys are untouched since compose
// only interpolates values.
function escapeComposeInterpolation(value: unknown): void {
	if (!value || typeof value !== 'object') return
	for (const [key, nested] of Object.entries(value)) {
		if (typeof nested === 'string') (value as Record<string, unknown>)[key] = nested.replaceAll('$', '$$$$')
		else escapeComposeInterpolation(nested)
	}
}

export async function readManifestInDirectory(dataDirectory: string) {
	const parseYaml = readYaml(`${dataDirectory}/umbrel-app.yml`)
	return parseYaml.then(validateManifest)
}

export function readComposeInDirectory(dataDirectory: string) {
	return readYaml(`${dataDirectory}/docker-compose.yml`) as Promise<Compose>
}

export type AppState =
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
	userSettingsComposePath: string
	#state: AppState = 'unknown'
	stateProgress = 0
	store: FileStore<AppSettings>
	// Set while setSettings() validates, persists, and applies a settings change
	// so lifecycle operations cannot race compose regeneration or a restart.
	#settingsInProgress = false

	constructor(umbreld: Umbreld, appId: string) {
		// Throw on invalid appId
		if (!/^[a-zA-Z0-9-_]+$/.test(appId)) throw new Error(`Invalid app ID: ${appId}`)

		this.#umbreld = umbreld
		this.id = appId
		this.dataDirectory = `${umbreld.dataDirectory}/app-data/${this.id}`
		// TODO: Consider moving this under a hidden `.umbrel/` directory if generated app settings artifacts grow.
		this.userSettingsComposePath = `${this.dataDirectory}/docker-compose.umbrel-user-settings.yml`
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLowerCase())
		this.store = new FileStore({filePath: `${this.dataDirectory}/settings.yml`})
	}

	get state() {
		return this.#state
	}

	// An accessor so every transition is announced, no matter which actor
	// triggered it (dashboard, MCP, CLI) — dashboards react to the event
	// instead of only to their own mutations
	set state(state: AppState) {
		if (state === this.#state) return
		this.#state = state
		this.#umbreld.eventBus.emit('apps:state:change', {appId: this.id, state})
	}

	readManifest() {
		return readManifestInDirectory(this.dataDirectory)
	}

	readCompose() {
		return readComposeInDirectory(this.dataDirectory)
	}

	#getManagedDataRootPath(parentPath: string) {
		return this.#umbreld.files.normalizeVirtualPath(`${parentPath}/${this.id}`)
	}

	#getDataRootParentPath(location: AppDataRootLocation) {
		const path = this.#umbreld.files.normalizeVirtualPath(location.path)
		if (nodePath.posix.basename(path) !== this.id) {
			throw new Error('[apps-data-root-invalid-location] Invalid app data root')
		}
		const parentPath = nodePath.posix.dirname(path)
		if (!isDataRootParentPath(parentPath)) {
			throw new Error('[apps-data-root-invalid-location] Invalid app data root')
		}
		return parentPath
	}

	async getDataRootLocation() {
		const location = await this.store.get('dataRootLocation')
		if (!location) return null
		const parsed = AppDataRootLocationSchema.safeParse(location)
		if (!parsed.success) throw new Error('[apps-data-root-invalid-location] Invalid app data root')
		this.#getDataRootParentPath(parsed.data)
		return parsed.data
	}

	async #dataRootSystemPath(location: AppDataRootLocation | null) {
		if (!location) return nodePath.join(this.dataDirectory, 'data')
		try {
			return await this.#umbreld.files.resolveStorageDestination(location, OWNER_USER_ID)
		} catch {
			throw new Error('[apps-data-root-unavailable] App storage is unavailable')
		}
	}

	async #ensureAppDataRootBindSources(dataRootSystemPath: string) {
		const manifest = await this.readManifest()
		if (manifest.storage?.dataRoot !== 'data') return

		const compose = await this.readCompose()
		const relativeSources = new Set<string>()
		for (const service of Object.values(compose.services ?? {})) {
			for (const volume of service.volumes ?? []) {
				const parsedVolume = parseServiceVolume(volume)
				if (!parsedVolume) continue
				const relativeSource = getAppDataRootRelativeSource(parsedVolume.source)
				if (relativeSource !== null) relativeSources.add(relativeSource)
			}
		}
		if (relativeSources.size === 0) return

		const location = await this.getDataRootLocation()
		if (!location) await fse.ensureDir(dataRootSystemPath)

		let dataRootHandle
		try {
			// Opening the verified root before creating any child pins the real
			// filesystem. If removable or network storage disappears afterwards,
			// operations through this descriptor fail there instead of switching to
			// the internal directory beneath its mountpoint.
			dataRootHandle = await open(dataRootSystemPath, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY)
			const pinnedDataRoot = process.platform === 'linux' ? `/proc/self/fd/${dataRootHandle.fd}` : dataRootSystemPath
			for (const relativeSource of relativeSources) {
				await fse.ensureDir(nodePath.join(pinnedDataRoot, ...relativeSource.split('/').filter(Boolean)))
			}
		} catch (error) {
			if (location) throw new Error('[apps-data-root-unavailable] App storage is unavailable', {cause: error})
			throw error
		} finally {
			await dataRootHandle?.close()
		}
	}

	async getDataRootSystemPath({requireAvailable = true}: {requireAvailable?: boolean} = {}) {
		const location = await this.getDataRootLocation()
		if (location && !requireAvailable) {
			return this.#umbreld.files.virtualToSystemPathUnsafe(location.path)
		}
		return this.#dataRootSystemPath(location)
	}

	async #runAppScript(
		command: string,
		inheritStdio: boolean = true,
		{maxOutputBytes, fallbackToInternal = false}: {maxOutputBytes?: number; fallbackToInternal?: boolean} = {},
	) {
		// Hook-free container teardown and logs do not need bind sources. Keep those
		// recovery actions available when a drive/share is offline; commands that run
		// app hooks or may start/mutate an app must resolve the real storage first.
		const requireAvailable = !['force-stop', 'logs', 'images'].includes(command)
		const {dataRoots, storagePaths} = await this.#umbreld.apps.getRuntimeDataRootContext(this.id, {
			requireAvailable,
			fallbackToInternal,
		})
		// Lifecycle scripts need storage to remain attached, but users may still
		// manage the app's data in Files while those scripts are running. Moves and
		// recovery reserve their paths separately with app-data protection enabled.
		const releaseStorage = this.#umbreld.apps.beginStorageOperation(this.id, storagePaths, {
			protectAsDataRoot: false,
		})
		try {
			if (['install', 'initialize-data-root', 'start', 'restart', 'reinstall', 'update'].includes(command)) {
				await this.#ensureAppDataRootBindSources(dataRoots[this.id])
			}
			return await appScript(this.#umbreld, command, this.id, inheritStdio, {maxOutputBytes, dataRoots})
		} finally {
			releaseStorage()
		}
	}

	// Resolve installed Compose, exports, system fragments and user overrides even
	// when the app is stopped or its external data storage is disconnected.
	async getExpectedImages() {
		const {stdout} = await this.#runAppScript('images', false)
		return stdout.split('\n').filter(Boolean)
	}

	async #readDataRootMove() {
		const move = await this.store.get('dataRootMove')
		if (!move) return null
		const parsed = AppDataRootMoveSchema.safeParse(move)
		if (!parsed.success) throw new Error('[apps-data-root-move-invalid] Invalid app data root move')
		if (parsed.data.source) this.#getDataRootParentPath(parsed.data.source)
		if (parsed.data.destination) this.#getDataRootParentPath(parsed.data.destination)
		if (dataRootLocationsEqual(parsed.data.source, parsed.data.destination)) {
			throw new Error('[apps-data-root-move-invalid] Invalid app data root move')
		}
		return parsed.data
	}

	#dataRootMoveStagingPath(move: AppDataRootMove) {
		return move.destination
			? `${nodePath.posix.dirname(move.destination.path)}/.${this.id}-moving-${move.token}`
			: `/Apps/${this.id}/.data-moving-${move.token}`
	}

	#dataRootMovePhase(move: AppDataRootMove, currentLocation: AppDataRootLocation | null) {
		if (dataRootLocationsEqual(currentLocation, move.source)) return 'copying' as const
		if (dataRootLocationsEqual(currentLocation, move.destination)) return 'committed' as const
		throw new Error('[apps-data-root-move-invalid] App data root move does not match current settings')
	}

	async #resolveMovePath(
		location: AppDataRootLocation | null,
		virtualPath: string,
		{create = false, allowMissing = false}: {create?: boolean; allowMissing?: boolean} = {},
	) {
		if (!location) {
			const systemPath = await this.#umbreld.files.virtualToSystemPath(virtualPath, OWNER_USER_ID)
			if (create) {
				await fse.ensureDir(systemPath)
				await fse.chown(systemPath, this.#umbreld.files.fileOwner.userId, this.#umbreld.files.fileOwner.groupId)
			}
			if (!create && !allowMissing) await fse.lstat(systemPath)
			return systemPath
		}

		const destination = {...location, path: virtualPath}
		const systemPath = await this.#umbreld.files.resolveStorageDestination(destination, OWNER_USER_ID, {
			allowMissing: create || allowMissing,
		})
		if (create) {
			// This is an OS-owned staging path inside a destination already reserved
			// by the app move. Creating it through the user-facing Files write policy
			// would correctly reject the move's own reservation.
			await fse.ensureDir(systemPath)
			await this.#umbreld.files.chownSystemPath(systemPath).catch(() => {})
			// Prove the created path still belongs to the expected drive/share.
			await this.#umbreld.files.resolveStorageDestination(destination, OWNER_USER_ID)
		}
		return systemPath
	}

	#dataRootMoveMarkerPath(systemPath: string, token: string) {
		return nodePath.join(systemPath, `${APP_DATA_ROOT_MOVE_MARKER_PREFIX}${token}`)
	}

	async #readDataRootMoveMarker(systemPath: string, token: string) {
		return fse.readJson(this.#dataRootMoveMarkerPath(systemPath, token)).catch(() => null) as Promise<{
			appId?: string
			token?: string
		} | null>
	}

	async #writeDataRootMoveMarker(systemPath: string, token: string) {
		const markerPath = this.#dataRootMoveMarkerPath(systemPath, token)
		if (await fse.pathExists(markerPath)) {
			throw new Error('[apps-data-root-move-marker-exists] App data conflicts with Umbrel move metadata')
		}
		const temporaryPath = `${markerPath}.tmp`
		await writeFileDurably(markerPath, temporaryPath, JSON.stringify({appId: this.id, token}))
	}

	async #assertDataRootMoveMarker(systemPath: string, token: string) {
		const marker = await this.#readDataRootMoveMarker(systemPath, token)
		if (marker?.appId !== this.id || marker.token !== token) {
			throw new Error('[apps-data-root-not-owned] Refusing to remove storage not created by this move')
		}
	}

	async #removeDataRootMoveMarker(systemPath: string, token: string) {
		const markerPath = this.#dataRootMoveMarkerPath(systemPath, token)
		if (!(await fse.pathExists(markerPath))) return false
		await removeDurably(markerPath)
		return true
	}

	async #removeDataRoot(location: AppDataRootLocation | null, systemPath: string) {
		if (!location) {
			if (nodePath.resolve(systemPath) !== nodePath.resolve(this.dataDirectory, 'data')) {
				throw new Error('[apps-data-root-invalid-location] Refusing to remove an unexpected internal path')
			}
		} else {
			const expectedSystemPath = await this.#dataRootSystemPath(location)
			if (nodePath.resolve(systemPath) !== nodePath.resolve(expectedSystemPath)) {
				throw new Error('[apps-data-root-invalid-location] Refusing to remove an unexpected external path')
			}
		}
		await removeDurably(systemPath)
	}

	async #recoverDataRootMove({
		strict = false,
		cleanCommitted = false,
	}: {strict?: boolean; cleanCommitted?: boolean} = {}) {
		let releaseStorageOperation = () => {}
		let unsafeToStart = false

		try {
			// A journal that fails validation or matches neither endpoint cannot
			// drive any recovery action, it can only block future moves forever.
			// The current data root remains authoritative, so abandon the journal
			// and accept that hidden staging debris may be left behind.
			const abandonJournal = async (error: unknown) => {
				this.logger.error(`Abandoning unusable storage move journal for ${this.id}`, error)
				await this.store.delete('dataRootMove')
			}
			let move: AppDataRootMove | null
			try {
				move = await this.#readDataRootMove()
			} catch (error) {
				await abandonJournal(error)
				return
			}
			if (!move) return
			const currentLocation = await this.getDataRootLocation()
			let phase: 'copying' | 'committed'
			try {
				phase = this.#dataRootMovePhase(move, currentLocation)
			} catch (error) {
				await abandonJournal(error)
				return
			}
			releaseStorageOperation = this.#umbreld.apps.beginStorageOperation(this.id, [
				move.source?.path ?? `/Apps/${this.id}/data`,
				move.destination?.path ?? `/Apps/${this.id}/data`,
				this.#dataRootMoveStagingPath(move),
			])
			const stagingSystemPath = await this.#resolveMovePath(move.destination, this.#dataRootMoveStagingPath(move), {
				allowMissing: true,
			})
			await removeDurably(stagingSystemPath)
			const destinationPath = move.destination?.path ?? `/Apps/${this.id}/data`
			const destinationSystemPath = await this.#resolveMovePath(move.destination, destinationPath, {
				allowMissing: true,
			})

			if (phase === 'copying') {
				if (await fse.pathExists(destinationSystemPath)) {
					// Keep the proof marker inside the incomplete root until the root itself
					// is gone. If deletion is interrupted, the next recovery can verify and
					// retry the same cleanup instead of getting stuck without proof.
					await this.#assertDataRootMoveMarker(destinationSystemPath, move.token)
					await this.#removeDataRoot(move.destination, destinationSystemPath)
				}
			} else {
				unsafeToStart = true
				// Never discard the old root until the committed destination still
				// resolves with its expected drive/share identity and exists.
				const destinationStat = await fse.lstat(destinationSystemPath).catch(() => null)
				if (!destinationStat?.isDirectory()) {
					throw new Error('[apps-data-root-unavailable] The new app storage is unavailable')
				}
				// A move marker is only transaction metadata. Remove it before any app
				// process can observe the committed data root.
				await this.#removeDataRootMoveMarker(destinationSystemPath, move.token)
				unsafeToStart = false
				if (!cleanCommitted) return
				try {
					const sourcePath = move.source?.path ?? `/Apps/${this.id}/data`
					const sourceSystemPath = await this.#resolveMovePath(move.source, sourcePath, {allowMissing: true})
					if (await fse.pathExists(sourceSystemPath)) await this.#removeDataRoot(move.source, sourceSystemPath)
				} catch (error) {
					// The destination is already authoritative. A source on storage that
					// disappeared after commit is only an obsolete copy; leaving it behind
					// must not permanently block this app's lifecycle.
					this.logger.error(`Could not remove the old data root for ${this.id}`, error)
				}
			}

			await this.store.delete('dataRootMove')
		} catch (error) {
			this.logger.error(`Could not finish storage move recovery for ${this.id}`, error)
			if (strict || unsafeToStart)
				throw new Error('[apps-data-root-recovery-needed] Reconnect the previous storage location and try again')
		} finally {
			releaseStorageOperation()
		}
	}

	async moveDataRoot(destinationParentPath: string | null): Promise<boolean> {
		return this.#umbreld.apps.imageCleanup.runOperation(() => this.#moveDataRoot(destinationParentPath))
	}

	async #moveDataRoot(destinationParentPath: string | null) {
		const moveLock = this.#acquireDataRootMoveLock()
		const shouldRestart = moveLock.shouldRestart
		const dependentLocks: Array<{app: App; shouldRestart: boolean; release: () => void}> = []
		const stoppedDependents: App[] = []
		let stoppedForMove = false
		let releaseStorageOperation = () => {}
		let operationError: unknown
		let moveCommitted = false

		try {
			await this.#recoverDataRootMove({strict: true, cleanCommitted: true})
			const [manifest, source] = await Promise.all([this.readManifest(), this.getDataRootLocation()])
			if (manifest.storage?.dataRoot !== 'data' && !source) {
				throw new Error('[apps-data-root-unsupported] This app does not support moving its storage')
			}

			const normalizedParentPath =
				destinationParentPath === null ? null : this.#umbreld.files.normalizeVirtualPath(destinationParentPath)
			if (normalizedParentPath !== null && !isDataRootParentPath(normalizedParentPath)) {
				throw new Error('[apps-data-root-invalid-location] Choose a folder on an external drive')
			}
			if (manifest.storage?.dataRoot !== 'data' && normalizedParentPath !== null) {
				throw new Error(
					'[apps-data-root-contract-removed] This app version only supports moving its storage back to internal storage',
				)
			}
			const destinationPath =
				normalizedParentPath === null ? `/Apps/${this.id}/data` : this.#getManagedDataRootPath(normalizedParentPath)
			const sourceVirtualPath = source?.path ?? `/Apps/${this.id}/data`
			let destination: AppDataRootLocation | null = null
			if (normalizedParentPath !== null) {
				try {
					destination = await this.#umbreld.files.getStorageDestination(destinationPath, OWNER_USER_ID)
				} catch {
					throw new Error('[apps-data-root-invalid-location] Choose an available external drive')
				}
				const filesystemType = destination.filesystemUuid
					? await this.#umbreld.files.getExternalStorageFilesystemType(destination.filesystemUuid)
					: undefined
				if (filesystemType !== 'ext4') {
					throw new Error(
						'[apps-data-root-unsupported-filesystem] App storage can only be moved to an ext4 drive. Reformat it as ext4 in Files to use it. Formatting permanently erases all data on the drive.',
					)
				}
			}

			if (dataRootLocationsEqual(source, destination)) {
				if (source) await this.#dataRootSystemPath(source)
				moveLock.release()
				return true
			}

			// Keep these checks and the reservation together with no await between
			// them. A settings change that began while the destination was resolving
			// is visible to the checks; one that begins later sees the reservation.
			if (this.#umbreld.apps.getDataRootPathRelation(destinationPath)) {
				throw new Error('[apps-data-root-overlap] App storage locations cannot overlap')
			}
			if ([sourceVirtualPath, destinationPath].some((path) => this.#umbreld.apps.hasActiveStoragePathOverlap(path))) {
				throw new Error(
					'[apps-data-root-folder-access-overlap] Choose a location that is not being configured as an app folder',
				)
			}
			const token = crypto.randomUUID()
			const stagingPath =
				normalizedParentPath === null
					? `/Apps/${this.id}/.data-moving-${token}`
					: `${nodePath.posix.dirname(destinationPath)}/.${this.id}-moving-${token}`
			releaseStorageOperation = this.#umbreld.apps.beginStorageOperation(this.id, [
				sourceVirtualPath,
				destinationPath,
				stagingPath,
			])
			const move: AppDataRootMove = {source, destination, token}
			if ((await this.#umbreld.apps.getAppsWithFolderAccessOverlap(destinationPath)).length > 0) {
				throw new Error(
					'[apps-data-root-folder-access-overlap] Choose a location that is not mounted into an app as a user folder',
				)
			}

			const sourceSystemPath = await this.#dataRootSystemPath(source)
			if (!source) await fse.ensureDir(sourceSystemPath)
			const destinationSystemPath = await this.#resolveMovePath(destination, destinationPath, {allowMissing: true})
			const sourcePath = nodePath.resolve(sourceSystemPath)
			const destinationSystemResolvedPath = nodePath.resolve(destinationSystemPath)
			if (
				sourcePath === destinationSystemResolvedPath ||
				sourcePath.startsWith(`${destinationSystemResolvedPath}${nodePath.sep}`) ||
				destinationSystemResolvedPath.startsWith(`${sourcePath}${nodePath.sep}`)
			) {
				throw new Error('[apps-data-root-overlap] The new location cannot contain the current app storage')
			}

			const destinationStat = await fse.lstat(destinationSystemPath).catch((error) => {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
				throw error
			})
			if (destinationStat) {
				const destinationIsEmptyDirectory =
					destinationStat.isDirectory() && (await fse.readdir(destinationSystemPath)).length === 0
				if (destination || !destinationIsEmptyDirectory) {
					throw new Error(
						`[apps-data-root-destination-exists] This location already contains an item named '${this.id}'`,
					)
				}
				await removeDurably(destinationSystemPath)
			}

			// A dependent can bind this app's exported data root. Lock and stop the
			// dependency chain leaf-first so nothing writes to the old root while it
			// is copied, then restart the chain in the opposite order below.
			for (const app of await this.#umbreld.apps.getDependentAppsInStopOrder(this.id)) {
				dependentLocks.push({app, ...app.#acquireDataRootMoveLock()})
			}

			const stagingSystemPath = await this.#resolveMovePath(destination, stagingPath, {allowMissing: true})
			await this.store.set('dataRootMove', move)
			await this.#resolveMovePath(destination, stagingPath, {create: true})

			await this.#umbreld.files.trackOperation(
				{
					type: 'move',
					sourceSystemPath,
					destinationSystemPath,
					destinationVirtualPath: destinationPath,
					appId: this.id,
				},
				async (onProgress) => {
					for (const lock of dependentLocks) {
						if (!lock.shouldRestart) continue
						stoppedDependents.push(lock.app)
						await lock.app.#stop()
					}
					if (shouldRestart) {
						stoppedForMove = true
						await this.#stop()
					}

					// TODO(app-data-root-storage-semantics): Make this copy destination-aware.
					// exFAT, NTFS, and CIFS mounts can synthesize Unix ownership and modes,
					// so an archive copy may fail or change metadata that containers rely on.
					// rsync archive mode also omits hard links, ACLs, and extended attributes.
					// Network filesystems can also be incompatible with database locking and
					// durability requirements. Define the app compatibility contract, then
					// enforce and test it without removing these destinations from the UI.
					await copyWithProgress(
						`${sourceSystemPath}${nodePath.sep}`,
						`${stagingSystemPath}${nodePath.sep}`,
						onProgress,
						{durable: true},
					)
					await syncDirectoryTree(stagingSystemPath)
					await this.#writeDataRootMoveMarker(stagingSystemPath, move.token)
					await renameDurably(stagingSystemPath, destinationSystemPath)

					await this.store.update((settings) => {
						if (destination) settings.dataRootLocation = destination
						else delete settings.dataRootLocation
					})
					this.#umbreld.apps.setDataRootLocation(this.id, destination)
					moveCommitted = true
					await this.#removeDataRootMoveMarker(destinationSystemPath, move.token)
				},
			)

			await this.#umbreld.eventBus.emit('apps:settings:change', {appId: this.id})
		} catch (error) {
			operationError = error
			if (!moveCommitted) await this.#recoverDataRootMove().catch(() => {})
		}

		try {
			let providerReady = !shouldRestart || !stoppedForMove
			if (shouldRestart && stoppedForMove) {
				try {
					await this.#start({cleanCommittedMove: false})
					providerReady = true
				} catch (error) {
					if (!operationError) operationError = error
					else this.logger.error(`Failed to restart ${this.id} after moving its storage`, error)
				}
			}
			if (providerReady) {
				for (const app of [...stoppedDependents].reverse()) {
					try {
						await app.#start()
					} catch (error) {
						if (!operationError) operationError = error
						else this.logger.error(`Failed to restart dependent app ${app.id} after moving ${this.id}`, error)
					}
				}
			}
			if (moveCommitted && providerReady) {
				// Recovery validates the committed destination again before removing
				// the old root. If cleanup cannot finish, the journal safely retries it.
				await this.#recoverDataRootMove({cleanCommitted: true})
			}
			if (operationError && !moveCommitted) throw operationError
			return true
		} finally {
			releaseStorageOperation()
			for (const lock of dependentLocks) lock.release()
			moveLock.release()
		}
	}

	async resetDataRoot(): Promise<boolean> {
		return this.#umbreld.apps.imageCleanup.runOperation(() => this.#resetDataRoot())
	}

	async #resetDataRoot() {
		const moveLock = this.#acquireDataRootMoveLock()
		const shouldRemainRunning = moveLock.shouldRestart
		const dependentLocks: Array<{app: App; shouldRestart: boolean; release: () => void}> = []
		const stoppedDependents: App[] = []
		let releaseStorageOperation = () => {}
		let operationError: unknown
		let resetCommitted = false
		let providerReady = false

		try {
			const source = await this.getDataRootLocation()
			if (!source) throw new Error('[apps-data-root-reset-internal] App storage is already internal')

			const move = await this.#readDataRootMove().catch((error) => {
				this.logger.error(`Could not read the interrupted storage move for ${this.id}; abandoning it`, error)
				return null
			})
			const internalPath = `/Apps/${this.id}/data`
			const operationPaths = [source.path, internalPath, ...(move ? [this.#dataRootMoveStagingPath(move)] : [])]
			if (operationPaths.some((path) => this.#umbreld.apps.hasActiveStoragePathOverlap(path))) {
				throw new Error('[apps-data-root-folder-access-overlap] App storage is currently in use')
			}
			releaseStorageOperation = this.#umbreld.apps.beginStorageOperation(this.id, operationPaths)

			// This action is only for abandoning data that cannot be reached. Always
			// bypass the short status cache before making the destructive decision.
			const status = await this.#umbreld.apps.getDataRootStatus(source, {fresh: true})
			if (status === 'available') {
				throw new Error('[apps-data-root-reset-available] Move the available app storage back instead')
			}

			for (const app of await this.#umbreld.apps.getDependentAppsInStopOrder(this.id)) {
				dependentLocks.push({app, ...app.#acquireDataRootMoveLock()})
			}
			for (const lock of dependentLocks) {
				if (!lock.shouldRestart) continue
				stoppedDependents.push(lock.app)
				await lock.app.#stop()
			}

			// Hooks may depend on the missing data, so tear down the app containers
			// directly. Images are retained for the fresh initialization below.
			await this.#runStateTransition('stopping', () =>
				this.#runAppScript('force-stop', true, {fallbackToInternal: true}),
			)
			this.state = 'stopped'

			// A crash during a move towards internal storage can leave an OS-owned
			// internal staging directory. External remnants are deliberately abandoned.
			if (move && !move.destination) {
				const stagingSystemPath = await this.#resolveMovePath(null, this.#dataRootMoveStagingPath(move), {
					allowMissing: true,
				})
				await removeDurably(stagingSystemPath)
			}

			const internalSystemPath = nodePath.join(this.dataDirectory, 'data')
			await removeDurably(internalSystemPath)
			await fse.ensureDir(internalSystemPath)
			await fse.chown(internalSystemPath, this.#umbreld.files.fileOwner.userId, this.#umbreld.files.fileOwner.groupId)

			// Commit the new authority before starting anything. If umbreld stops
			// here, the pending flag makes the next start retry full initialization.
			await this.store.update((settings) => {
				delete settings.dataRootLocation
				delete settings.dataRootMove
				settings.dataRootResetPending = true
			})
			this.#umbreld.apps.setDataRootLocation(this.id, null)
			resetCommitted = true
			await this.#umbreld.eventBus.emit('apps:settings:change', {appId: this.id})

			await this.#start({persistAutoStart: shouldRemainRunning})
			if (!shouldRemainRunning) await this.#stop()
			providerReady = true
		} catch (error) {
			operationError = error
			if (resetCommitted) {
				this.logger.error(`App storage was reset but ${this.id} did not initialize cleanly`, error)
			}
		}

		try {
			if (providerReady) {
				for (const app of [...stoppedDependents].reverse()) {
					try {
						await app.#start()
					} catch (error) {
						this.logger.error(`Failed to restart dependent app ${app.id} after resetting ${this.id}`, error)
					}
				}
			}
			// Once the durable location switch commits, retrying Start fresh would be
			// misleading. Initialization remains pending and an ordinary start retries it.
			if (operationError && !resetCommitted) throw operationError
			return true
		} finally {
			releaseStorageOperation()
			for (const lock of dependentLocks) lock.release()
			moveLock.release()
		}
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

	async refreshLanIngress() {
		try {
			await this.#umbreld.lanIngress.refresh()
		} catch (error) {
			this.logger.error(`Failed to refresh LAN ingress`, error)
		}
	}

	writeCompose(compose: Compose) {
		return writeYaml(`${this.dataDirectory}/docker-compose.yml`, compose)
	}

	async #runStateTransition<T>(
		state: Extract<AppState, 'starting' | 'stopping' | 'restarting'>,
		operation: () => Promise<T>,
	): Promise<T> {
		this.state = state
		try {
			return await operation()
		} catch (error) {
			// A failed lifecycle command may have only partially changed the
			// containers, so don't claim the app is running or stopped. `unknown`
			// is the existing recoverable state exposed by the UI.
			this.state = 'unknown'
			throw error
		}
	}

	async patchComposeFile() {
		const manifest = await this.readManifest()
		const hasMovableDataRoot = manifest.storage?.dataRoot === 'data'
		const appRequestsGpuAccess = manifest.permissions?.includes('GPU')
		const gpuAcceleration = appRequestsGpuAccess ? await getGpuAcceleration() : undefined

		type ComposeWithGpuPatch = Compose & {
			'x-umbrel-gpu-patches'?: Record<string, AppliedGpuAcceleration>
		}
		const compose = (await this.readCompose()) as ComposeWithGpuPatch
		const previousGpuPatches = compose['x-umbrel-gpu-patches'] ?? {}
		const gpuPatches: Record<string, AppliedGpuAcceleration> = {}
		for (const serviceName of Object.keys(compose.services!)) {
			removeGpuAccelerationFromService(compose.services![serviceName], previousGpuPatches[serviceName])
			removeLegacyDriDeviceMappingsFromService(compose.services![serviceName])

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
				const migratedVolume = mapServiceVolumeSource(volume, (source) => {
					const migratedSource = migrateLegacyStorageSource(source)

					// App definitions keep using the stable, backwards-compatible
					// APP_DATA_DIR/data path. On supported umbrelOS versions we patch
					// only those bind sources to the movable root at install/update time.
					return hasMovableDataRoot ? redirectAppDataRootSource(migratedSource) : migratedSource
				})

				// A moved root may disappear while Docker still owns the container.
				// Prevent a later container restart from recreating the missing bind
				// source on the internal filesystem beneath that mountpoint.
				return hasMovableDataRoot ? disableAppDataRootHostPathCreation(migratedVolume) : migratedVolume
			})

			// Add every acceleration path available on the host. Mixed systems can
			// expose DRI/Vulkan, ROCm, and NVIDIA CUDA/Vulkan simultaneously.
			if (gpuAcceleration) {
				gpuPatches[serviceName] = applyGpuAccelerationToService(compose.services![serviceName], gpuAcceleration)
			}
		}
		if (Object.values(gpuPatches).some((patch) => Object.keys(patch).length > 0)) {
			compose['x-umbrel-gpu-patches'] = gpuPatches
		} else {
			delete compose['x-umbrel-gpu-patches']
		}

		await this.writeCompose(compose)
	}

	async hasAppProxy() {
		const compose = await this.readCompose()
		return Boolean(compose.services?.app_proxy)
	}

	async getAppProxyAuthOverride() {
		const override = await this.store.get('appProxyAuthEnabled')
		return typeof override === 'boolean' ? override : undefined
	}

	async getAppProxyAuth() {
		const compose = await this.readCompose()
		const appProxyService = compose.services?.app_proxy
		if (!appProxyService) {
			return {
				supported: false,
				defaultEnabled: null,
				override: null,
				enabled: null,
			}
		}

		// Prefer the gateway's rendered config for the default since it resolves
		// compose interpolation and .env.app_proxy. It's only rendered once a
		// compose action runs, so for an app left stopped since the update that
		// introduced it we fall back to the raw compose environment with the
		// gateway's fail-safe semantics: on unless PROXY_AUTH_ADD is exactly 'false'.
		const gatewayConfig = await readAppGatewayConfig(this.id, this.dataDirectory, compose)
		const proxyAuthAdd = readEnvironmentValue(appProxyService.environment, 'PROXY_AUTH_ADD')
		const defaultEnabled = gatewayConfig?.auth ?? proxyAuthAdd?.trim().toLowerCase() !== 'false'

		const override = await this.getAppProxyAuthOverride()

		return {
			supported: true,
			defaultEnabled,
			override: override ?? null,
			enabled: override ?? defaultEnabled,
		}
	}

	#getConfigurableServiceImages(compose: Compose) {
		const serviceImages: Record<string, string | null> = {}

		for (const serviceName of getConfigurableServiceNames(compose)) {
			const image = compose.services?.[serviceName]?.image
			serviceImages[serviceName] = typeof image === 'string' ? image : null
		}

		return serviceImages
	}

	#getFolderAccessMountKeys(folders: Array<{mounts: Array<{serviceName: string; targetPath: string}>}>) {
		return new Set(
			folders.flatMap((folder) => folder.mounts.map((mount) => getCustomMountKey(mount.serviceName, mount.targetPath))),
		)
	}

	async #resolveCustomMounts(
		customMounts: AppCustomMount[],
		compose?: Compose,
		{
			reservedMountKeys = new Set<string>(),
			strict = true,
			stat = true,
		}: {reservedMountKeys?: Set<string>; strict?: boolean; stat?: boolean} = {},
	) {
		compose ??= await this.readCompose()

		const serviceNames = new Set(getConfigurableServiceNames(compose))
		const seenMountKeys = new Set<string>()
		const resolvedCustomMounts: ResolvedCustomMount[] = []

		for (const rawMount of customMounts) {
			// Stored settings aren't schema-validated on read and this also resolves
			// on every app start, so a corrupt entry must be skipped, not crash
			const parsedMount = AppCustomMountSchema.safeParse(rawMount)
			if (!parsedMount.success) {
				if (strict) throw new Error('[apps-settings-mount-invalid] Invalid custom mount')
				this.logger.error(`Skipping malformed custom mount in settings for app ${this.id}`)
				continue
			}
			const mount = parsedMount.data

			const serviceName = mount.serviceName.trim()
			if (!serviceNames.has(serviceName)) {
				if (strict) throw new Error(`[apps-settings-service-not-found] Service '${mount.serviceName}' does not exist`)
				continue
			}

			let targetPath: string
			let sourcePath: string
			try {
				targetPath = normalizeContainerPath(mount.targetPath.trim())
				sourcePath = normalizeAllowedSourcePath(mount.sourcePath)
			} catch (error) {
				if (strict) throw error
				continue
			}
			const mountKey = getCustomMountKey(serviceName, targetPath)

			if (seenMountKeys.has(mountKey)) {
				if (strict)
					throw new Error(
						`[apps-settings-mount-duplicate-target] Only one custom mount can target '${targetPath}' in service '${serviceName}'`,
					)
				continue
			}
			seenMountKeys.add(mountKey)

			if (reservedMountKeys.has(mountKey)) {
				if (strict)
					throw new Error(
						`[apps-settings-mount-already-exists] Mount '${targetPath}' in service '${serviceName}' already exists`,
					)
				continue
			}

			// A missing source (e.g. an offline network share or unplugged drive) throws
			// even in non-strict mode. Silently dropping the mount would start the app
			// against the default folder and write new data there while the user's real
			// data lives at the custom source. Failing the lifecycle operation is safer.
			// Read-only inspection paths can skip filesystem access so an offline
			// source can still be reported, fixed, or protected from ejection.
			const systemSourcePath = stat
				? await this.#umbreld.files.virtualToSystemPath(sourcePath, OWNER_USER_ID)
				: this.#umbreld.files.virtualToSystemPathUnsafe(sourcePath)
			if (stat) {
				if (this.#umbreld.apps.getDataRootPathRelation(sourcePath)) {
					throw new Error('[apps-settings-source-managed] App-managed storage cannot be mounted as a user folder')
				}
				const sourceStat = await fse.stat(systemSourcePath).catch(() => null)
				if (!sourceStat) throw new Error(`[apps-settings-source-missing] Source path '${sourcePath}' does not exist`)
				if (!sourceStat.isDirectory())
					throw new Error(`[apps-settings-source-not-directory] Source path '${sourcePath}' must be a folder`)
			}

			resolvedCustomMounts.push({
				serviceName,
				targetPath,
				sourcePath,
				readOnly: mount.readOnly,
				systemSourcePath,
			})
		}

		return resolvedCustomMounts
	}

	async #resolveFolderAccess(
		folderAccess: AppFolderAccessSelection[],
		compose: Compose,
		manifest: AppManifest,
		{strict = true, stat = true}: {strict?: boolean; stat?: boolean} = {},
	) {
		// Slot definitions come from the manifest and recognized packaged mounts;
		// saved selections are validated against those current definitions below.
		const slotsById = new Map(getFolderAccessSlots(this.#umbreld, compose, [], manifest).map((slot) => [slot.id, slot]))
		const seenIds = new Set<string>()
		const resolvedFolderAccess: ResolvedFolderAccess[] = []

		for (const rawFolder of folderAccess) {
			// Stored settings aren't schema-validated on read and this also resolves
			// on every app start, so a corrupt entry must be skipped, not crash
			const parsedFolder = AppFolderAccessSelectionSchema.safeParse(rawFolder)
			if (!parsedFolder.success) {
				if (strict) throw new Error('[apps-settings-folder-invalid] Invalid folder access selection')
				this.logger.error(`Skipping malformed folder access selection in settings for app ${this.id}`)
				continue
			}
			const folder = parsedFolder.data

			const id = folder.id.trim()
			if (!id) {
				if (strict) throw new Error('[apps-settings-folder-id-required] Folder access id is required')
				continue
			}
			if (seenIds.has(id)) {
				if (strict) throw new Error(`[apps-settings-folder-duplicate-id] Only one folder selection can use id '${id}'`)
				continue
			}
			seenIds.add(id)

			const slot = slotsById.get(id)
			if (!slot) {
				if (strict)
					throw new Error(`[apps-settings-folder-not-supported] Folder access '${id}' is not supported by this app`)
				continue
			}

			let sourcePath: string
			try {
				sourcePath = normalizeAllowedSourcePath(folder.sourcePath)
			} catch (error) {
				if (strict) throw error
				continue
			}

			const systemSourcePath = stat
				? await this.#umbreld.files.virtualToSystemPath(sourcePath, OWNER_USER_ID)
				: this.#umbreld.files.virtualToSystemPathUnsafe(sourcePath)
			if (stat) {
				if (this.#umbreld.apps.getDataRootPathRelation(sourcePath)) {
					throw new Error('[apps-settings-source-managed] App-managed storage cannot be mounted as a user folder')
				}
				const sourceStat = await fse.stat(systemSourcePath).catch(() => null)
				if (!sourceStat) throw new Error(`[apps-settings-source-missing] Source path '${sourcePath}' does not exist`)
				if (!sourceStat.isDirectory())
					throw new Error(`[apps-settings-source-not-directory] Source path '${sourcePath}' must be a folder`)
			}

			resolvedFolderAccess.push({
				id,
				sourcePath,
				mounts: slot.mounts.map((mount) => ({
					...mount,
					sourcePath,
					systemSourcePath,
				})),
			})
		}

		return resolvedFolderAccess
	}

	async getCustomMounts() {
		return (await this.store.get('customMounts')) ?? []
	}

	async getFolderAccess() {
		return (await this.store.get('folderAccess')) ?? []
	}

	async getStorageSettings() {
		const [compose, customMounts, folderAccess, manifest, dataRootLocation] = await Promise.all([
			this.readCompose(),
			this.getCustomMounts(),
			this.getFolderAccess(),
			this.readManifest(),
			this.getDataRootLocation(),
		])
		const folderAccessSlots = getFolderAccessSlots(this.#umbreld, compose, folderAccess, manifest)
		const occupiedTargets = getComposeMounts(compose).map(({serviceName, target}) => ({
			serviceName,
			targetPath: target,
		}))
		const folderAccessMountKeys = this.#getFolderAccessMountKeys(
			folderAccessSlots.filter((folder) => folder.sourcePath !== null),
		)
		// Saved custom mounts are re-resolved non-strictly so stale entries (e.g. after
		// an app update changed the compose file) are hidden. The stat is skipped so
		// mounts on offline sources still show up and can be fixed.
		const visibleCustomMounts = (
			await this.#resolveCustomMounts(customMounts, compose, {
				reservedMountKeys: folderAccessMountKeys,
				strict: false,
				stat: false,
			})
		).map(({systemSourcePath, ...mount}): AppCustomMount => mount)

		// Report which source folders are currently unavailable (e.g. an offline
		// network share or unplugged drive) so the UI can explain why the app
		// can't run instead of showing paths that look healthy
		const referencedSourcePaths = new Set([
			...folderAccessSlots.flatMap((folder) => {
				const sourcePath = folder.sourcePath ?? folder.defaultSourcePath
				return sourcePath ? [sourcePath] : []
			}),
			...visibleCustomMounts.map((mount) => mount.sourcePath),
		])
		// Checks run concurrently and race a timeout since a stale network mount
		// can block stat calls for a long time and this runs on the frequently
		// queried apps.list path. The underlying stats are single-flighted and
		// briefly cached by the apps module so repeated queries can't pile hung
		// stats onto the threadpool.
		const missingSourcePaths: string[] = []
		await Promise.all(
			[...referencedSourcePaths].map(async (sourcePath) => {
				const isDirectory = await Promise.race([
					this.#umbreld.apps.isStorageSourceAvailable(sourcePath),
					setTimeout(3000, false, {ref: false}),
				])
				if (!isDirectory) missingSourcePaths.push(sourcePath)
			}),
		)

		const dataRoot =
			manifest.storage?.dataRoot === 'data' || dataRootLocation
				? {
						location: dataRootLocation?.path ?? null,
						canMoveExternally: manifest.storage?.dataRoot === 'data',
						status: dataRootLocation
							? await Promise.race([
									this.#umbreld.apps.getDataRootStatus(dataRootLocation),
									setTimeout(3000, 'checking' as const, {ref: false}),
								])
							: ('available' as const),
					}
				: null

		return {
			dataRoot,
			occupiedTargets,
			services: getConfigurableServiceNames(compose),
			serviceImages: this.#getConfigurableServiceImages(compose),
			folderAccess: folderAccessSlots,
			customMounts: visibleCustomMounts,
			missingSourcePaths,
		}
	}

	// Resolved folder-access sources that actually apply to the current
	// compose/manifest. Stat checks are skipped so an offline-but-effective source
	// still counts for lifecycle and conflict checks.
	async #resolveEffectiveFolderAccessSourcePaths(
		compose: Compose,
		customMounts: AppCustomMount[],
		folderAccess: AppFolderAccessSelection[],
		manifest: AppManifest,
	) {
		const folderAccessSlots = getFolderAccessSlots(this.#umbreld, compose, folderAccess, manifest)
		const resolvedFolderAccess = await this.#resolveFolderAccess(folderAccess, compose, manifest, {
			strict: false,
			stat: false,
		})
		const folderAccessMountKeys = this.#getFolderAccessMountKeys(resolvedFolderAccess)
		const resolvedCustomMounts = await this.#resolveCustomMounts(customMounts, compose, {
			reservedMountKeys: folderAccessMountKeys,
			strict: false,
			stat: false,
		})

		return Array.from(
			new Set([
				...resolvedCustomMounts.map((mount) => mount.sourcePath),
				...resolvedFolderAccess.map((folder) => folder.sourcePath),
				...folderAccessSlots.flatMap((folder) =>
					!folder.sourcePath && folder.defaultSourcePath ? [folder.defaultSourcePath] : [],
				),
			]),
		)
	}

	async getEffectiveFolderAccessSourcePaths() {
		const [compose, customMounts, folderAccess, manifest] = await Promise.all([
			this.readCompose(),
			this.getCustomMounts(),
			this.getFolderAccess(),
			this.readManifest(),
		])
		return this.#resolveEffectiveFolderAccessSourcePaths(compose, customMounts, folderAccess, manifest)
	}

	// Used only as a fail-safe while ejecting storage. It intentionally reads the
	// saved source paths without depending on the current manifest or Compose, so
	// an app update cannot make Umbrel forget storage a running app may still use.
	async getConfiguredFolderAccessSourcePaths() {
		const [customMounts, folderAccess] = await Promise.all([this.getCustomMounts(), this.getFolderAccess()])
		const paths = [...customMounts, ...folderAccess].flatMap((entry) => {
			try {
				return [normalizeAllowedSourcePath(entry.sourcePath)]
			} catch {
				return []
			}
		})
		return [...new Set(paths)]
	}

	#getFolderAccessOperationPaths(
		customMounts: AppCustomMount[],
		folderAccess: AppFolderAccessSelection[],
		compose: Compose,
		manifest: AppManifest,
	) {
		const paths = new Set<string>()
		for (const folder of getFolderAccessSlots(this.#umbreld, compose, folderAccess, manifest)) {
			const sourcePath = folder.sourcePath ?? folder.defaultSourcePath
			if (sourcePath) paths.add(sourcePath)
		}
		for (const customMount of customMounts) {
			const parsedMount = AppCustomMountSchema.safeParse(customMount)
			if (!parsedMount.success) continue
			try {
				paths.add(normalizeAllowedSourcePath(parsedMount.data.sourcePath))
			} catch {
				// Strict settings validation reports malformed paths below. They cannot
				// reference real storage, so there is nothing to reserve first.
			}
		}
		return [...paths]
	}

	async getEffectiveStorageSourcePaths() {
		return Array.from(
			new Set([
				...(await this.#umbreld.apps.getDataRootStoragePaths(this.id)),
				...(await this.getEffectiveFolderAccessSourcePaths()),
			]),
		)
	}

	// App-declared environment values are identified only by name. Their service
	// targets always come from the current manifest, so an app update can change
	// its internal service layout without changing the user's setting.
	#resolveEnvironmentVariables(variables: unknown, {strict = true}: {strict?: boolean} = {}) {
		const variableInputs = Array.isArray(variables) ? variables : []
		const seenNames = new Set<string>()
		const resolvedVariables: AppEnvironmentVariable[] = []

		for (const variableInput of variableInputs) {
			const parsedVariable = AppEnvironmentVariableSchema.safeParse(variableInput)
			if (!parsedVariable.success) {
				if (strict) throw new Error('[apps-settings-environment-invalid] Invalid environment variable')
				continue
			}

			const name = parsedVariable.data.name.trim()
			if (!ENVIRONMENT_VARIABLE_NAME_REGEX.test(name)) {
				if (strict)
					throw new Error(
						`[apps-settings-environment-invalid-name] Invalid environment variable name '${parsedVariable.data.name}'`,
					)
				continue
			}
			if (seenNames.has(name)) {
				if (strict)
					throw new Error(
						`[apps-settings-environment-duplicate] Only one value can be set for environment variable '${name}'`,
					)
				continue
			}
			seenNames.add(name)

			resolvedVariables.push({name, value: parsedVariable.data.value})
		}

		return resolvedVariables
	}

	// Advanced variables deliberately target one exact service. A missing service
	// leaves a saved value dormant; strict API validation still rejects it when
	// the user is actively editing settings.
	#resolveCustomEnvironmentVariables(
		variables: unknown,
		compose: Compose,
		{strict = true, requireCurrentService = true}: {strict?: boolean; requireCurrentService?: boolean} = {},
	) {
		const variableInputs = Array.isArray(variables) ? variables : []
		const serviceNames = new Set(getConfigurableServiceNames(compose))
		const seenKeys = new Set<string>()
		const resolvedVariables: AppCustomEnvironmentVariable[] = []

		for (const variableInput of variableInputs) {
			const parsedVariable = AppCustomEnvironmentVariableSchema.safeParse(variableInput)
			if (!parsedVariable.success) {
				if (strict) throw new Error('[apps-settings-environment-invalid] Invalid environment variable')
				continue
			}

			const serviceName = parsedVariable.data.serviceName.trim()
			if (!serviceName || (requireCurrentService && !serviceNames.has(serviceName))) {
				if (strict)
					throw new Error(
						`[apps-settings-service-not-found] Service '${parsedVariable.data.serviceName}' does not exist`,
					)
				continue
			}

			const name = parsedVariable.data.name.trim()
			if (!ENVIRONMENT_VARIABLE_NAME_REGEX.test(name)) {
				if (strict)
					throw new Error(
						`[apps-settings-environment-invalid-name] Invalid environment variable name '${parsedVariable.data.name}'`,
					)
				continue
			}

			const key = `${serviceName}:${name}`
			if (seenKeys.has(key)) {
				if (strict)
					throw new Error(
						`[apps-settings-environment-duplicate] Only one value can be set for environment variable '${name}' in service '${serviceName}'`,
					)
				continue
			}
			seenKeys.add(key)

			resolvedVariables.push({serviceName, name, value: parsedVariable.data.value})
		}

		return resolvedVariables
	}

	// Environment variables the app developer exposes in the manifest, with UI
	// notes and default placeholders
	#getExposedEnvironmentVariables(manifest: AppManifest, compose: Compose) {
		const exposedInputs = Array.isArray(manifest.environment) ? manifest.environment : []
		const serviceNames = new Set(getConfigurableServiceNames(compose))
		const seenNames = new Set<string>()
		const exposedVariables: AppManifestEnvironmentVariable[] = []

		for (const exposedInput of exposedInputs) {
			// Parse defensively so app updates can't brick settings with a malformed
			// manifest entry. validateManifest() doesn't run schema validation.
			const parsedVariable = AppManifestEnvironmentVariableSchema.safeParse(exposedInput)
			if (!parsedVariable.success) continue

			const name = parsedVariable.data.name.trim()
			if (!ENVIRONMENT_VARIABLE_NAME_REGEX.test(name)) continue
			if (seenNames.has(name)) continue
			const services = [...new Set(parsedVariable.data.services.map((service) => service.trim()))]
			if (services.length === 0 || services.some((service) => !serviceNames.has(service))) continue
			seenNames.add(name)

			exposedVariables.push({...parsedVariable.data, name, services})
		}

		return exposedVariables
	}

	async getEnvironmentVariables() {
		return (await this.store.get('environment')) ?? []
	}

	async getCustomEnvironmentVariables() {
		return (await this.store.get('customEnvironment')) ?? []
	}

	async getEnvironmentSettings() {
		const [compose, manifest, environmentVariables, customEnvironmentVariables] = await Promise.all([
			this.readCompose(),
			this.readManifest(),
			this.getEnvironmentVariables(),
			this.getCustomEnvironmentVariables(),
		])
		const valuesByName = new Map(
			this.#resolveEnvironmentVariables(environmentVariables, {strict: false}).map((variable) => [
				variable.name,
				variable.value,
			]),
		)
		const exposed = this.#getExposedEnvironmentVariables(manifest, compose).map((variable) => ({
			name: variable.name,
			services: variable.services,
			default: variable.default ?? null,
			options: variable.options ?? null,
			note: variable.note ?? null,
			value: valuesByName.get(variable.name) ?? null,
		}))
		const custom = this.#resolveCustomEnvironmentVariables(customEnvironmentVariables, compose, {strict: false})

		return {
			exposed,
			custom,
			services: getConfigurableServiceNames(compose),
			serviceImages: this.#getConfigurableServiceImages(compose),
		}
	}

	// The auth override is deliberately absent here: authentication lives in
	// umbreld's app gateway which reads the override from the settings store
	// directly, so it never flows through compose
	async regenerateUserSettingsCompose() {
		const [
			compose,
			manifest,
			customMounts,
			folderAccess,
			environmentVariables,
			customEnvironmentVariables,
			dataRootLocation,
		] = await Promise.all([
			this.readCompose(),
			this.readManifest(),
			this.getCustomMounts(),
			this.getFolderAccess(),
			this.getEnvironmentVariables(),
			this.getCustomEnvironmentVariables(),
			this.getDataRootLocation(),
		])
		const userSettingsCompose: {services: Record<string, any>} = {services: {}}
		this.#umbreld.apps.setFolderAccessSourcePaths(
			this.id,
			await this.#resolveEffectiveFolderAccessSourcePaths(compose, customMounts, folderAccess, manifest),
		)

		if (dataRootLocation && manifest.storage?.dataRoot !== 'data') {
			throw new Error(
				'[apps-data-root-contract-removed] This app version no longer supports its moved storage; move it back to internal storage first',
			)
		}

		const resolvedFolderAccess = await this.#resolveFolderAccess(folderAccess, compose, manifest, {
			strict: false,
		})
		const folderAccessMountKeys = this.#getFolderAccessMountKeys(resolvedFolderAccess)
		const resolvedCustomMounts = await this.#resolveCustomMounts(customMounts, compose, {
			reservedMountKeys: folderAccessMountKeys,
			strict: false,
		})
		const folderAccessMounts = resolvedFolderAccess.flatMap((folder) => folder.mounts)
		for (const mount of [...resolvedCustomMounts, ...folderAccessMounts]) {
			const service = (userSettingsCompose.services[mount.serviceName] ??= {})
			service.volumes ??= []
			service.volumes.push({
				type: 'bind',
				source: mount.systemSourcePath,
				target: mount.targetPath,
				read_only: mount.readOnly,
				bind: {
					create_host_path: false,
				},
			})
		}

		// App-declared values follow the current manifest's service targets. Advanced
		// exact-service values are applied afterward, so they intentionally win.
		const exposedVariablesByName = new Map(
			this.#getExposedEnvironmentVariables(manifest, compose).map((variable) => [variable.name, variable]),
		)
		const resolvedEnvironmentVariables = this.#resolveEnvironmentVariables(environmentVariables, {strict: false})
		for (const variable of resolvedEnvironmentVariables) {
			const exposedVariable = exposedVariablesByName.get(variable.name)
			if (!exposedVariable) continue

			for (const serviceName of exposedVariable.services) {
				const service = (userSettingsCompose.services[serviceName] ??= {})
				service.environment ??= {}
				service.environment[variable.name] = variable.value
			}
		}
		const resolvedCustomEnvironmentVariables = this.#resolveCustomEnvironmentVariables(
			customEnvironmentVariables,
			compose,
			{strict: false},
		)
		for (const variable of resolvedCustomEnvironmentVariables) {
			const service = (userSettingsCompose.services[variable.serviceName] ??= {})
			service.environment ??= {}
			service.environment[variable.name] = variable.value
		}

		if (Object.keys(userSettingsCompose.services).length === 0) {
			await fse.remove(this.userSettingsComposePath)
			return
		}

		// Docker Compose interpolates $VAR and ${VAR} in every compose file it loads,
		// including this override, so a literal '$' in a value (e.g. a password like
		// 'pa$$word' or a folder path) would be mangled into a variable reference.
		// Escaping '$' to '$$' at serialization keeps every generated value literal.
		escapeComposeInterpolation(userSettingsCompose)

		await fse.writeFile(
			this.userSettingsComposePath,
			`# Generated by Umbrel. Changes will be overwritten.\n${yaml.dump(userSettingsCompose)}`,
		)
	}

	// Drop and report saved storage settings that no longer apply after an app
	// update. Keeping them hidden in settings would let a later app version
	// silently reactivate an old folder permission.
	async #notifyIfStorageSettingsInvalidated() {
		const [customMounts, folderAccess] = await Promise.all([this.getCustomMounts(), this.getFolderAccess()])
		if (customMounts.length === 0 && folderAccess.length === 0) return

		// Mirror the resolution regenerateUserSettingsCompose() applies so the
		// notification fires exactly when a saved setting stopped applying
		const [compose, manifest] = await Promise.all([this.readCompose(), this.readManifest()])
		const resolvedFolderAccess = await this.#resolveFolderAccess(folderAccess, compose, manifest, {
			strict: false,
			stat: false,
		})
		const folderAccessMountKeys = this.#getFolderAccessMountKeys(resolvedFolderAccess)
		const resolvedCustomMounts = await this.#resolveCustomMounts(customMounts, compose, {
			reservedMountKeys: folderAccessMountKeys,
			strict: false,
			stat: false,
		})

		const invalidatedMounts = resolvedCustomMounts.length < customMounts.length
		const invalidatedFolders = resolvedFolderAccess.length < folderAccess.length
		if (invalidatedMounts || invalidatedFolders) {
			const normalizedCustomMounts = resolvedCustomMounts.map(({systemSourcePath, ...mount}) => mount)
			const normalizedFolderAccess = resolvedFolderAccess.map(({id, sourcePath}) => ({id, sourcePath}))
			const saved = await this.store.update((settings) => {
				if (normalizedCustomMounts.length > 0) settings.customMounts = normalizedCustomMounts
				else delete settings.customMounts
				if (normalizedFolderAccess.length > 0) settings.folderAccess = normalizedFolderAccess
				else delete settings.folderAccess
			})
			if (!saved) throw new Error(`[apps-settings-save-failed] Failed to normalize settings for app '${this.id}'`)
			await this.#umbreld.notifications.add(`app-storage-settings-changed:${this.id}`)
			await this.#umbreld.eventBus.emit('apps:settings:change', {appId: this.id})
		}
	}

	// Lifecycle actions are blocked while a settings change is being applied.
	// Most importantly, starting the app while its files are being copied between
	// folders would let it write to the old location, and a 'move' transfer would
	// then delete those writes.
	#assertNoSettingsInProgress() {
		if (this.#settingsInProgress) {
			throw new Error(
				`[apps-settings-applying] Cannot start or modify app '${this.id}' while its settings are being applied`,
			)
		}
	}

	// Settings changes are applied by restarting the app so we block them during
	// lifecycle operations where a restart would conflict with the operation in
	// progress. A single settings save triggers at most one restart, so transient
	// states simply reject instead of queueing.
	#assertSettingsChangeAllowed() {
		const blockedStates: AppState[] = ['installing', 'updating', 'uninstalling', 'starting', 'restarting', 'stopping']
		if (blockedStates.includes(this.state)) {
			throw new Error(`[apps-settings-blocked] Cannot change settings for app '${this.id}' while it is ${this.state}`)
		}
	}

	#acquireDataRootMoveLock() {
		this.#assertSettingsChangeAllowed()
		if (this.#settingsInProgress) throw new Error('[apps-settings-in-progress] Another settings change is in progress')

		this.#settingsInProgress = true
		const shouldRestart = this.state !== 'stopped'
		let released = false
		return {
			shouldRestart,
			release: () => {
				if (released) return
				released = true
				this.#settingsInProgress = false
			},
		}
	}

	// Save any combination of app settings in one operation: one write, one
	// compose regenerate, at most one restart. Fields left undefined are
	// untouched (and never re-validated, so e.g. storage settings staled by an
	// app update don't block an unrelated auth change). For the auth override,
	// null clears it so the app follows its default.
	async setSettings(settings: AppSettingsUpdate): Promise<boolean> {
		return this.#umbreld.apps.imageCleanup.runOperation(() => this.#setSettings(settings))
	}

	async #setSettings({
		appProxyAuthEnabled,
		customMounts,
		folderAccess,
		environment,
		customEnvironment,
		dependencies,
	}: AppSettingsUpdate) {
		this.#assertSettingsChangeAllowed()
		if (this.#settingsInProgress) {
			throw new Error(
				`[apps-settings-in-progress] Cannot change settings for app '${this.id}' while another settings change is in progress`,
			)
		}
		// Claimed synchronously (no awaits since the check above) so a concurrent
		// save or lifecycle operation can't slip in while settings are applied.
		this.#settingsInProgress = true

		let settingsPersisted = false
		let releaseStorageOperation = () => {}
		try {
			const storageProvided = customMounts !== undefined || folderAccess !== undefined
			const environmentProvided = environment !== undefined || customEnvironment !== undefined

			if (appProxyAuthEnabled !== undefined && !(await this.hasAppProxy())) {
				throw new Error(`[apps-settings-auth-unsupported] App ${this.id} does not support app proxy authentication`)
			}

			const [
				compose,
				manifest,
				previousAuthOverride,
				previousCustomMounts,
				previousFolderAccess,
				previousEnvironment,
				previousCustomEnvironment,
				previousDependencies,
			] = await Promise.all([
				this.readCompose(),
				this.readManifest(),
				this.store.get('appProxyAuthEnabled'),
				this.getCustomMounts(),
				this.getFolderAccess(),
				this.getEnvironmentVariables(),
				this.getCustomEnvironmentVariables(),
				this.store.get('dependencies'),
			])
			const resolvedDependencies =
				dependencies !== undefined ? fillSelectedDependencies(manifest.dependencies, dependencies) : undefined
			const dependencyDataRootPaths = resolvedDependencies
				? await this.#umbreld.apps.getDataRootPathsForApps(Object.values(resolvedDependencies))
				: []
			const storageOperationPaths = [
				...(storageProvided
					? this.#getFolderAccessOperationPaths(
							customMounts ?? previousCustomMounts,
							folderAccess ?? previousFolderAccess,
							compose,
							manifest,
						)
					: []),
				...dependencyDataRootPaths,
			]
			if (storageOperationPaths.length > 0) {
				releaseStorageOperation = this.#umbreld.apps.beginStorageOperation(this.id, storageOperationPaths, {
					protectAsDataRoot: false,
				})
			}

			// Resolve provided fields strictly so invalid input fails before anything
			// is written.
			let normalizedCustomMounts = previousCustomMounts
			let normalizedFolderAccess = previousFolderAccess
			if (storageProvided) {
				const resolvedFolderAccess = await this.#resolveFolderAccess(
					folderAccess ?? previousFolderAccess,
					compose,
					manifest,
				)
				const folderAccessMountKeys = this.#getFolderAccessMountKeys(resolvedFolderAccess)
				const resolvedCustomMounts = await this.#resolveCustomMounts(customMounts ?? previousCustomMounts, compose, {
					reservedMountKeys: folderAccessMountKeys,
				})
				normalizedCustomMounts = resolvedCustomMounts.map(({systemSourcePath, ...mount}) => mount)
				normalizedFolderAccess = resolvedFolderAccess.map(({id, sourcePath}) => ({id, sourcePath}))
			}
			const previousResolvedEnvironment = this.#resolveEnvironmentVariables(previousEnvironment, {strict: false})
			const previousResolvedCustomEnvironment = this.#resolveCustomEnvironmentVariables(
				previousCustomEnvironment,
				compose,
				{strict: false, requireCurrentService: false},
			)
			const resolvedEnvironment =
				environment !== undefined ? this.#resolveEnvironmentVariables(environment) : previousResolvedEnvironment
			const resolvedCustomEnvironment =
				customEnvironment !== undefined
					? this.#resolveCustomEnvironmentVariables(customEnvironment, compose)
					: previousResolvedCustomEnvironment
			let normalizedEnvironment = previousResolvedEnvironment
			if (environment !== undefined) {
				const exposedVariablesByName = new Map(
					this.#getExposedEnvironmentVariables(manifest, compose).map((variable) => [variable.name, variable]),
				)
				const unsupportedVariable = resolvedEnvironment.find((variable) => !exposedVariablesByName.has(variable.name))
				if (unsupportedVariable) {
					throw new Error(
						`[apps-settings-environment-not-supported] Environment variable '${unsupportedVariable.name}' is not exposed by this app`,
					)
				}
				const previousValuesByName = new Map(
					previousResolvedEnvironment.map((variable) => [variable.name, variable.value]),
				)
				const invalidOption = resolvedEnvironment.find((variable) => {
					const options = exposedVariablesByName.get(variable.name)?.options
					return (
						options && !options.includes(variable.value) && previousValuesByName.get(variable.name) !== variable.value
					)
				})
				if (invalidOption) {
					throw new Error(
						`[apps-settings-environment-invalid-option] '${invalidOption.value}' is not a valid value for environment variable '${invalidOption.name}'`,
					)
				}
				// The UI can only edit variables exposed by the current app version.
				// Replace that visible subset while retaining values whose declarations
				// are temporarily absent so an unrelated edit cannot silently erase them.
				normalizedEnvironment = [
					...previousResolvedEnvironment.filter((variable) => !exposedVariablesByName.has(variable.name)),
					...resolvedEnvironment,
				]
			}
			const currentServiceNames = new Set(getConfigurableServiceNames(compose))
			const normalizedCustomEnvironment =
				customEnvironment === undefined
					? previousResolvedCustomEnvironment
					: [
							...previousResolvedCustomEnvironment.filter((variable) => !currentServiceNames.has(variable.serviceName)),
							...resolvedCustomEnvironment,
						]
			for (const path of dependencyDataRootPaths) {
				if (this.#umbreld.apps.getDataRootPathRelation(path)?.includes('active')) {
					throw new Error('[apps-settings-source-managed] App-managed storage is currently changing')
				}
			}

			// One write for every provided field
			const success = await this.store.update((settings) => {
				if (appProxyAuthEnabled !== undefined) {
					if (appProxyAuthEnabled === null) delete settings.appProxyAuthEnabled
					else settings.appProxyAuthEnabled = appProxyAuthEnabled
				}
				if (storageProvided) {
					if (normalizedCustomMounts.length > 0) settings.customMounts = normalizedCustomMounts
					else delete settings.customMounts
					if (normalizedFolderAccess.length > 0) settings.folderAccess = normalizedFolderAccess
					else delete settings.folderAccess
				}
				if (environment !== undefined) {
					if (normalizedEnvironment.length > 0) settings.environment = normalizedEnvironment
					else delete settings.environment
				}
				if (customEnvironment !== undefined) {
					if (normalizedCustomEnvironment.length > 0) settings.customEnvironment = normalizedCustomEnvironment
					else delete settings.customEnvironment
				}
				if (resolvedDependencies !== undefined) settings.dependencies = resolvedDependencies
			})
			if (!success) throw new Error(`[apps-settings-save-failed] Failed to save settings for app '${this.id}'`)
			settingsPersisted = true

			// The user has reviewed their storage settings so any pending
			// notification about invalidated settings is resolved
			if (storageProvided) {
				await this.#umbreld.notifications.clear(`app-storage-settings-changed:${this.id}`).catch(() => {})
			}

			await this.regenerateUserSettingsCompose()

			// The settings and generated compose are in place so lifecycle operations
			// can proceed again.
			this.#settingsInProgress = false

			// Skip the restart if nothing actually changed
			const authChanged =
				appProxyAuthEnabled !== undefined && (appProxyAuthEnabled ?? undefined) !== previousAuthOverride
			const storageChanged =
				storageProvided &&
				(JSON.stringify(previousCustomMounts) !== JSON.stringify(normalizedCustomMounts) ||
					JSON.stringify(previousFolderAccess) !== JSON.stringify(normalizedFolderAccess))
			const environmentChanged =
				environmentProvided &&
				(JSON.stringify(previousResolvedEnvironment) !== JSON.stringify(resolvedEnvironment) ||
					JSON.stringify(previousResolvedCustomEnvironment) !== JSON.stringify(resolvedCustomEnvironment))
			// Compare filled records so saving the default selections for the first
			// time doesn't count as a change
			const dependenciesChanged =
				resolvedDependencies !== undefined &&
				JSON.stringify(fillSelectedDependencies(manifest.dependencies, previousDependencies)) !==
					JSON.stringify(resolvedDependencies)
			if (storageChanged || environmentChanged || dependenciesChanged) {
				await this.applySettingsChange()
			} else if (authChanged) {
				// The app gateway reads the auth override when routes are rebuilt,
				// so an auth-only change applies instantly without a restart
				await this.refreshLanIngress()
			}

			return success
		} catch (error) {
			this.#settingsInProgress = false
			throw error
		} finally {
			releaseStorageOperation()
			if (settingsPersisted) {
				await this.#umbreld.eventBus.emit('apps:settings:change', {appId: this.id})
			}
		}
	}

	async pull() {
		const defaultImages = [
			'ghcr.io/getumbrel/tor:0.4.9.11@sha256:e382b8629c0dfef6ceb396b062622d4e4e955b19d6f16b883fd2c0723ad5671a',
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

	async install(options: {
		dependencies: Record<string, string>
		folderAccess?: AppFolderAccessSelection[]
	}): Promise<boolean> {
		return this.#umbreld.apps.imageCleanup.runOperation(() => this.#install(options), {cleanupAfter: true})
	}

	async #install({
		dependencies,
		folderAccess = [],
	}: {
		dependencies: Record<string, string>
		folderAccess?: AppFolderAccessSelection[]
	}) {
		// Install choices must be in place before Compose is generated or any app
		// lifecycle script runs. Resolve them against the copied template so the
		// backend, not the UI, remains the authority on valid folder access.
		const [compose, manifest] = await Promise.all([this.readCompose(), this.readManifest()])
		const dependencyDataRootPaths = await this.#umbreld.apps.getDataRootPathsForApps(Object.values(dependencies))
		const releaseStorageOperation = this.#umbreld.apps.beginStorageOperation(
			this.id,
			[...this.#getFolderAccessOperationPaths([], folderAccess, compose, manifest), ...dependencyDataRootPaths],
			{protectAsDataRoot: false},
		)
		try {
			const resolvedFolderAccess = await this.#resolveFolderAccess(folderAccess, compose, manifest)
			for (const path of dependencyDataRootPaths) {
				if (this.#umbreld.apps.getDataRootPathRelation(path)?.includes('active')) {
					throw new Error('[apps-settings-source-managed] App-managed storage is currently changing')
				}
			}
			const settingsSaved = await this.store.update((settings) => {
				settings.dependencies = dependencies
				if (resolvedFolderAccess.length > 0) {
					settings.folderAccess = resolvedFolderAccess.map(({id, sourcePath}) => ({id, sourcePath}))
				} else {
					delete settings.folderAccess
				}
			})
			if (!settingsSaved) throw new Error(`Failed to save install settings for app '${this.id}'`)
		} finally {
			releaseStorageOperation()
		}

		await this.patchComposeFile()
		await this.regenerateUserSettingsCompose()
		await this.pull()
		await this.refreshLanIngress()

		try {
			await pRetry(() => this.#runAppScript('install'), {
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
		} finally {
			await this.refreshLanIngress()
		}
	}

	async update(): Promise<boolean> {
		return this.#umbreld.apps.imageCleanup.runOperation(() => this.#update(), {cleanupAfter: true})
	}

	async #update() {
		this.#assertNoSettingsInProgress()
		this.#assertSettingsChangeAllowed()
		this.state = 'updating'
		this.stateProgress = 1

		// TODO: Pull images here before the install script and calculate live progress for
		// this.stateProgress so button animations work

		this.logger.log(`Updating app ${this.id}`)

		try {
			await this.#recoverDataRootMove()

			// Update the app, patching the compose file half way through
			await this.#runAppScript('pre-patch-update')
			await this.patchComposeFile()
			await this.regenerateUserSettingsCompose()
			await this.#notifyIfStorageSettingsInvalidated().catch((error) => {
				this.logger.error(`Failed to check storage settings after updating app ${this.id}`, error)
			})
			await this.pull()
			await this.refreshLanIngress()
			await this.#runStartOrDataRootInitialization()
			await this.#runAppScript('post-patch-update')

			this.state = 'ready'
			this.stateProgress = 0

			// Enable auto-start on boot
			await this.setAutoStart(true)
			await this.#recoverDataRootMove({cleanCommitted: true})

			return true
		} catch (error) {
			// Don't leave the app stuck in 'updating' which blocks settings changes,
			// otherwise a failure caused by bad settings (e.g. a custom mount on an
			// offline network share) can never be fixed by the user.
			this.state = 'unknown'
			this.stateProgress = 0
			throw error
		} finally {
			await this.refreshLanIngress()
		}
	}

	async #runStartOrDataRootInitialization() {
		const resetPending = (await this.store.get('dataRootResetPending')) === true
		await pRetry(() => this.#runAppScript(resetPending ? 'initialize-data-root' : 'start'), {
			onFailedAttempt: (error) => {
				this.logger.error(
					`Attempt ${error.attemptNumber} starting app ${this.id} failed. There are ${error.retriesLeft} retries left.`,
					error,
				)
			},
			retries: 2,
		})
		if (resetPending) await this.store.delete('dataRootResetPending')
	}

	async #start({
		cleanCommittedMove = true,
		persistAutoStart = true,
	}: {cleanCommittedMove?: boolean; persistAutoStart?: boolean} = {}) {
		this.logger.log(`Starting app ${this.id}`)
		try {
			await this.#runStateTransition('starting', async () => {
				await this.#recoverDataRootMove()
				// We re-run the patch here to fix an edge case where 0.5.x imported apps
				// wont run because they haven't been patched.
				await this.patchComposeFile()
				await this.regenerateUserSettingsCompose()
				await this.refreshLanIngress()
				await this.#runStartOrDataRootInitialization()
			})
			this.state = 'ready'

			// Enable auto-start on boot
			if (persistAutoStart) await this.setAutoStart(true)
			if (cleanCommittedMove) await this.#recoverDataRootMove({cleanCommitted: true})

			return true
		} finally {
			await this.refreshLanIngress()
		}
	}

	async start() {
		return this.#umbreld.apps.imageCleanup.runOperation(() => {
			this.#assertNoSettingsInProgress()
			return this.#start()
		})
	}

	async #stop({persistState = false}: {persistState?: boolean} = {}) {
		try {
			await this.#runStateTransition('stopping', async () => {
				await pRetry(
					async () => {
						try {
							await this.#runAppScript('stop')
						} catch (error) {
							if (!(error instanceof Error) || !error.message.includes('[apps-data-root-unavailable]')) throw error
							this.logger.log(`App storage for ${this.id} is unavailable; stopping containers without hooks`)
							await this.#runAppScript('force-stop', true, {fallbackToInternal: true})
						}
					},
					{
						onFailedAttempt: (error) => {
							this.logger.error(
								`Attempt ${error.attemptNumber} stopping app ${this.id} failed. There are ${error.retriesLeft} retries left.`,
								error,
							)
						},
						retries: 2,
					},
				)
			})
			this.state = 'stopped'

			// Disable auto-start on boot
			if (persistState) {
				await this.setAutoStart(false)
			}

			return true
		} finally {
			await this.refreshLanIngress()
		}
	}

	async stop(options: {persistState?: boolean} = {}) {
		return this.#umbreld.apps.imageCleanup.runOperation(() => {
			this.#assertNoSettingsInProgress()
			return this.#stop(options)
		})
	}

	async restart(): Promise<boolean> {
		return this.#umbreld.apps.imageCleanup.runOperation(() => this.#restart())
	}

	async #restart(): Promise<boolean> {
		this.#assertNoSettingsInProgress()
		try {
			await this.#runStateTransition('restarting', async () => {
				await this.#recoverDataRootMove()
				const resetPending = (await this.store.get('dataRootResetPending')) === true
				await this.#runAppScript(resetPending ? 'force-stop' : 'stop', true, {
					fallbackToInternal: resetPending,
				})
				await this.patchComposeFile()
				await this.regenerateUserSettingsCompose()
				await this.#runStartOrDataRootInitialization()
			})
			this.state = 'ready'

			// Enable auto-start on boot
			await this.setAutoStart(true)
			await this.#recoverDataRootMove({cleanCommitted: true})

			return true
		} finally {
			await this.refreshLanIngress()
		}
	}

	async uninstall(): Promise<boolean> {
		return this.#umbreld.apps.imageCleanup.runOperation(() => this.#uninstall(), {cleanupAfter: true})
	}

	async #uninstall() {
		this.#assertNoSettingsInProgress()
		this.#assertSettingsChangeAllowed()
		this.state = 'uninstalling'
		try {
			// Uninstalling the local app must not depend on removable or network
			// storage being online. Recovery is still worth attempting so reachable
			// staging/obsolete roots are cleaned up, but any inaccessible data is safer
			// left behind than deleted through an unverified mount path.
			await this.#recoverDataRootMove({cleanCommitted: true}).catch((error) =>
				this.logger.error(`Could not recover app storage before uninstalling ${this.id}; leaving it behind`, error),
			)
			await pRetry(() => this.#runAppScript('stop'), {
				onFailedAttempt: (error) => {
					this.logger.error(
						`Attempt ${error.attemptNumber} stopping app ${this.id} failed. There are ${error.retriesLeft} retries left.`,
						error,
					)
				},
				retries: 2,
			}).catch((error) => {
				// A malformed storage record must not make local container teardown and
				// uninstall impossible. force-stop below performs the hook-free teardown.
				this.logger.error(`Could not run stop hooks while uninstalling ${this.id}; forcing container teardown`, error)
			})
			await this.#runAppScript('force-stop', true, {fallbackToInternal: true})
			// Revoke references before deleting app data so a later reinstall cannot
			// inherit favorites or access granted to the previous installation.
			await this.#umbreld.files.removeReferencesWithin(`/Apps/${this.id}`)
			const dataRootLocation = await this.getDataRootLocation().catch((error) => {
				this.logger.error(`Could not read app storage while uninstalling ${this.id}; leaving it behind`, error)
				return null
			})
			if (dataRootLocation) {
				try {
					const dataRootSystemPath = await this.#dataRootSystemPath(dataRootLocation)
					await this.#removeDataRoot(dataRootLocation, dataRootSystemPath)
				} catch (error) {
					this.logger.error(
						`Could not safely remove app storage while uninstalling ${this.id}; leaving it behind`,
						error,
					)
				}
			}
			await fse.remove(this.dataDirectory)

			// Clear any pending storage settings notification for this app
			await this.#umbreld.notifications.clear(`app-storage-settings-changed:${this.id}`).catch(() => {})

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
		} catch (error) {
			this.state = 'unknown'
			throw error
		} finally {
			// Regenerate from current app state so partial uninstalls don't leave stale LAN ingress routes.
			await this.refreshLanIngress()
		}
	}

	async applySettingsChange() {
		if (this.state === 'ready' || this.state === 'running') {
			this.restart().catch((error) => {
				this.logger.error(`Failed to restart '${this.id}' after settings change`, error)
			})
			return
		}

		// Stopped apps keep their manual stop. An unknown app with auto-start still
		// represents an app Umbrel should be running, so retry it after a settings fix.
		if (this.state !== 'unknown') return

		if (!(await this.shouldAutoStart()) || this.state !== 'unknown') return
		await this.#umbreld.apps.startApp(this.id).catch((error) => {
			this.logger.error(`Failed to start '${this.id}' after settings change`, error)
		})
	}

	async getContainerNames() {
		const compose = await this.readCompose()
		const containers = Object.entries(compose.services!)
			.filter(([serviceName]) => serviceName !== 'app_proxy')
			.map(([, service]) => service.container_name) as string[]
		containers.push(`${this.id}_tor_server_1`)
		return containers
	}

	async getPids() {
		const containers = await this.getContainerNames()
		try {
			// If we fail to get the PIDs of one container, skip it and continue for
			// the other containers. We'll expect to get it on some misses for the app
			// proxy and tor server containers.
			const outputs = await Promise.all(
				containers.map(async (container) => {
					try {
						const {stdout} = await $`docker top ${container} -o pid`
						return stdout
					} catch {
						return ''
					}
				}),
			)
			return outputs
				.join('\n')
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
		const paths = [`/Apps/${this.id}`]
		const dataRootLocation = await this.getDataRootLocation()
		if (dataRootLocation) paths.push(dataRootLocation.path)

		// Resolve each location independently so unavailable external app data does
		// not hide the usage that remains available on internal storage.
		const sizes = await Promise.all(
			paths.map(async (path) => {
				try {
					const systemPath = await this.#umbreld.files.virtualToSystemPath(path, OWNER_USER_ID)
					// Files can move while du is walking an active app's data. Keep the
					// original retry behavior for these transient measurement failures.
					return await pRetry(() => getDirectorySize(systemPath), {retries: 2})
				} catch (error) {
					this.logger.error(`Failed to get disk usage for app ${this.id}`, error)
					return 0
				}
			}),
		)
		return sizes.reduce((total, size) => total + size, 0)
	}

	async getLogs(maxOutputBytes?: number) {
		const inheritStdio = false
		const result = await this.#runAppScript('logs', inheritStdio, {maxOutputBytes})
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
		const dataRootLocation = await this.getDataRootLocation().catch((error) => {
			this.logger.error(`Failed to read app storage while resolving backupIgnore for ${this.id}`, error)
			return undefined
		})

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

			// `data` is the manifest's movable root. Definition files and legacy
			// paths beside it remain relative to the internal app directory.
			const isDataRootPath = path === 'data' || path.startsWith('data/')
			// Moved data roots live beneath /External or /Network, both of which are
			// excluded from backups wholesale. Do not touch an offline mount merely to
			// produce a redundant ignore path.
			if (isDataRootPath && dataRootLocation !== null) continue
			const basePath = isDataRootPath ? nodePath.join(this.dataDirectory, 'data') : this.dataDirectory
			const relativePath = isDataRootPath ? path.slice('data'.length).replace(/^\//, '') : path
			path = nodePath.join(basePath, relativePath)

			// Ensure normalisation cannot escape the selected base directory.
			if (path !== basePath && !path.startsWith(`${basePath}${nodePath.sep}`)) {
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
	async setSelectedDependencies(selectedDependencies: Record<string, string>): Promise<boolean> {
		return this.#umbreld.apps.imageCleanup.runOperation(() => this.#setSelectedDependencies(selectedDependencies))
	}

	async #setSelectedDependencies(selectedDependencies: Record<string, string>) {
		this.#assertNoSettingsInProgress()
		this.#assertSettingsChangeAllowed()
		const {dependencies} = await this.readManifest()
		const filledSelectedDependencies = fillSelectedDependencies(dependencies, selectedDependencies)
		const success = await this.store.set('dependencies', filledSelectedDependencies)
		if (success) await this.applySettingsChange()
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

	// Set if app should auto start on boot
	async setAutoStart(autoStart: boolean) {
		return this.store.set('autoStart', autoStart)
	}

	// Get if app should auto start on boot
	async shouldAutoStart() {
		return (await this.store.get('autoStart')) ?? true
	}
}
