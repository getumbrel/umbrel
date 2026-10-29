import {randomUUID} from 'node:crypto'
import {constants as fsConstants} from 'node:fs'
import {open, statfs} from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import nodePath from 'node:path'
import readline from 'node:readline'
import {inspect, type InspectOptionsStylized} from 'node:util'

import {execa, type ExecaChildProcess, type ExecaError, type ExecaReturnValue} from 'execa'
import fse from 'fs-extra'
import pWaitFor from 'p-wait-for'

import randomToken from '../utilities/random-token.ts'

import {
	CLOUD_INVALID_ACCOUNT_CONFIG_ERROR,
	CLOUD_JUNK_FILTER,
	UUID_PATTERN,
	type CloudSyncActivity,
	type Provider,
	type RemoteRef,
} from './cloud-types.ts'

export const CLOUD_RCLONE_REMOTE = 'cloud'

const PROCESS_STOP_TIMEOUT = 15_000
const CONFIG_START_TIMEOUT = 5_000
const CONFIG_CONTROL_TIMEOUT = 30_000
const MAX_COMMAND_OUTPUT = 32 * 1024 * 1024
const MAX_RC_RESPONSE = 8 * 1024 * 1024
const MAX_CONFIG_SIZE = 4 * 1024 * 1024
const MAX_LOG_RECORDS = 200
const MAX_INSPECT_LOG_RECORDS = 20
const MAX_INSPECT_LOG_STRING_LENGTH = 2 * 1024
const TEMPORARY_CONFIG_PATTERN = /^rclone-.+\.tmp$/

export const cloudTransferBudget = (freeBytes: bigint, minimumFreeBytes: bigint) =>
	freeBytes > minimumFreeBytes ? freeBytes - minimumFreeBytes : undefined

const RCLONE_PROVIDER_TYPES: Record<Provider, string> = {
	'google-drive': 'drive',
	dropbox: 'dropbox',
	onedrive: 'onedrive',
	webdav: 'webdav',
	icloud: 'iclouddrive',
}

// Verified against rclone v1.74.4: generic WebDAV and iCloud do not reliably
// expose the hashes used by the default track-renames strategy.
// iCloud reports the uncompressed size of package documents such as Pages
// files, but serves them as smaller ZIP archives.
// Verified against rclone v1.75.2: those ZIPs ignore Range requests, so a package
// reported above the 256 MiB multi-thread cutoff gets the whole ZIP written into
// each 64 MiB chunk and fails. rclone can't tell packages apart, so iCloud files
// download as single streams.
const RCLONE_SYNC_PROVIDER_FLAGS: Record<Provider, string[]> = {
	'google-drive': ['--track-renames', '--drive-skip-dangling-shortcuts', '--tpslimit', '5', '--tpslimit-burst', '10'],
	dropbox: ['--track-renames'],
	onedrive: ['--track-renames'],
	webdav: [],
	icloud: ['--ignore-size', '--multi-thread-streams', '0'],
}

type FileOwner = {userId: number; groupId: number}

type AccountPaths = {
	directory: string
	config: string
	cache: string
	temp: string
	filter: string
}

type ProcessExit = {
	code: number | null
	signal: NodeJS.Signals | null
	error?: Error
}

export type RcloneLogRecord = {
	time?: string
	level?: string
	msg?: string
	stats?: {
		bytes?: number
		speed?: number
		transfers?: number
		totalTransfers?: number
		totalBytes?: number
	}
	[key: string]: unknown
}

export type RcloneBrowseEntry = {
	name: string
	path: string
	type: 'directory' | 'file'
	id?: string
}

export type RcloneBrowseResult = {
	entries: RcloneBrowseEntry[]
	truncated: boolean
}

export class RcloneProcessError extends Error {
	code: number | null
	signal: NodeJS.Signals | null
	records: RcloneLogRecord[]

	constructor(command: string, exit: ProcessExit, records: RcloneLogRecord[]) {
		super(`rclone ${command} failed${exit.code === null ? '' : ` with exit code ${exit.code}`}`)
		this.name = 'RcloneProcessError'
		this.code = exit.code
		this.signal = exit.signal
		this.records = records
		if (exit.error) this.cause = exit.error
	}

	[inspect.custom](_depth: number, options: InspectOptionsStylized) {
		const details = inspect(
			{
				code: this.code,
				signal: this.signal,
				records: this.records.slice(-MAX_INSPECT_LOG_RECORDS),
			},
			{
				...options,
				depth: 3,
				maxArrayLength: MAX_INSPECT_LOG_RECORDS,
				maxStringLength: MAX_INSPECT_LOG_STRING_LENGTH,
			},
		)
		return `${this.stack ?? `${this.name}: ${this.message}`}\n${details}`
	}
}

export class RcloneAbortedError extends Error {
	constructor() {
		super('[cloud-cancelled]')
		this.name = 'RcloneAbortedError'
	}
}

export class RcloneRcError extends Error {
	statusCode: number

	constructor(statusCode: number, message: string) {
		super(`rclone RC request failed (${statusCode}): ${message}`)
		this.name = 'RcloneRcError'
		this.statusCode = statusCode
	}
}

const processExit = (result: ExecaReturnValue<string> | ExecaError<string>): ProcessExit => ({
	code: Number.isInteger(result.exitCode) ? result.exitCode : null,
	signal: (result.signal as NodeJS.Signals | undefined) ?? null,
	...('originalMessage' in result && result.originalMessage ? {error: new Error(result.originalMessage)} : {}),
})

const stopProcess = async (process: ExecaChildProcess<string>) => {
	if (process.exitCode !== null || process.signalCode !== null) return process
	process.kill('SIGINT')
	const forceKillTimer = setTimeout(() => process.kill('SIGKILL'), PROCESS_STOP_TIMEOUT)
	forceKillTimer.unref()
	try {
		return await process
	} finally {
		clearTimeout(forceKillTimer)
	}
}

const appendWithLimit = (current: string, chunk: Buffer | string, limit: number) => {
	const next = current + chunk.toString()
	if (Buffer.byteLength(next) > limit) throw new Error('[cloud-rclone-output-too-large]')
	return next
}

const createLineCollector = (input: NodeJS.ReadableStream | null, onRecord?: (record: RcloneLogRecord) => void) => {
	const records: RcloneLogRecord[] = []

	const addLine = (line: string) => {
		if (!line) return
		let record: RcloneLogRecord
		try {
			record = JSON.parse(line) as RcloneLogRecord
		} catch {
			record = {level: 'error', msg: line}
		}
		records.push(record)
		if (records.length > MAX_LOG_RECORDS) records.shift()
		onRecord?.(record)
	}

	if (!input) return {records, finished: Promise.resolve()}
	const lines = readline.createInterface({input, crlfDelay: Infinity})
	lines.on('line', addLine)
	const finished = new Promise<void>((resolve) => lines.once('close', resolve))
	return {records, finished}
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

// Verified against rclone v1.74.4: progress is carried by these numeric stats
// fields. Log messages are not activity data, and SIGINT may end without a final
// JSON error record, so cancellation remains based on caller abort state.
export const activityFromRcloneStats = (
	syncId: string,
	stats: NonNullable<RcloneLogRecord['stats']>,
): CloudSyncActivity | undefined => {
	if (
		!isFiniteNumber(stats.bytes) ||
		!isFiniteNumber(stats.speed) ||
		!isFiniteNumber(stats.transfers) ||
		!isFiniteNumber(stats.totalTransfers)
	) {
		return
	}

	const activity: CloudSyncActivity = {
		syncId,
		bytesPerSecond: Math.max(0, stats.speed),
		transferredFiles: Math.max(0, stats.transfers),
		transferredBytes: Math.max(0, stats.bytes),
	}

	if (stats.totalTransfers > 0) activity.totalFiles = stats.totalTransfers
	if (isFiniteNumber(stats.totalBytes) && stats.totalBytes > 0) {
		activity.totalBytes = stats.totalBytes
		activity.percent = Math.min(100, Math.max(0, (stats.bytes / stats.totalBytes) * 100))
	}

	return activity
}

const normalizeRemotePath = (remotePath: string) => {
	if (remotePath.includes('\0')) throw new Error('[cloud-invalid-remote-path]')
	const components = remotePath.replaceAll('\\', '/').split('/').filter(Boolean)
	if (components.some((component) => component === '.' || component === '..'))
		throw new Error('[cloud-invalid-remote-path]')
	return components.join('/')
}

const inlineOption = (value: string) => {
	if (!value || value.includes(',') || value.includes(':') || value.includes('\0')) {
		throw new Error('[cloud-invalid-remote-identity]')
	}
	return value
}

// Verified against rclone v1.74.4: root_folder_id selects the chosen root itself,
// so Google and OneDrive sources must not append a display path. Per-operation
// inline IDs let one canonical account config address multiple provider locations.
export const buildRcloneRemoteSource = (provider: Provider, remote: RemoteRef) => {
	if (typeof remote.path !== 'string') throw new Error('[cloud-invalid-remote]')
	const keys = Object.keys(remote)
	const hasOnlyKeys = (allowed: string[]) => keys.every((key) => allowed.includes(key))
	if (provider === 'google-drive') {
		if (!hasOnlyKeys(['path', 'folderId', 'sharedDriveId']) || !remote.folderId) {
			throw new Error('[cloud-invalid-remote]')
		}
		const options = [
			...(remote.sharedDriveId ? [`team_drive=${inlineOption(remote.sharedDriveId)}`] : []),
			`root_folder_id=${inlineOption(remote.folderId)}`,
		]
		return `${CLOUD_RCLONE_REMOTE},${options.join(',')}:`
	}

	if (provider === 'onedrive') {
		if (
			!hasOnlyKeys(['path', 'folderId', 'driveId', 'driveType']) ||
			!remote.folderId ||
			!remote.driveId ||
			!remote.driveType
		) {
			throw new Error('[cloud-invalid-remote]')
		}
		const options = [
			`drive_id=${inlineOption(remote.driveId)}`,
			`drive_type=${remote.driveType}`,
			`root_folder_id=${inlineOption(remote.folderId)}`,
		]
		return `${CLOUD_RCLONE_REMOTE},${options.join(',')}:`
	}

	if (
		!hasOnlyKeys(['path']) ||
		remote.folderId !== undefined ||
		remote.sharedDriveId !== undefined ||
		remote.driveId !== undefined ||
		remote.driveType !== undefined
	) {
		throw new Error('[cloud-invalid-remote]')
	}
	const remotePath = normalizeRemotePath(remote.path)
	return `${CLOUD_RCLONE_REMOTE}:${remotePath}`
}

const validateAccountId = (accountId: string) => {
	if (!UUID_PATTERN.test(accountId)) {
		throw new Error('[cloud-invalid-account-id]')
	}
}

const setPrivateFilePermissions = async (filePath: string, owner: FileOwner, ignoreMissing = false) => {
	let file
	try {
		file = await open(filePath, fsConstants.O_RDWR | fsConstants.O_NOFOLLOW)
	} catch (error) {
		if (ignoreMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return
		throw error
	}
	try {
		if (!(await file.stat()).isFile()) throw new Error(CLOUD_INVALID_ACCOUNT_CONFIG_ERROR)
		await file.chmod(0o600)
		await file.chown(owner.userId, owner.groupId)
	} finally {
		await file.close()
	}
}

const assertPrivateDirectory = async (directory: string, owner: FileOwner) => {
	await fse.ensureDir(directory, {mode: 0o700})
	const handle = await open(directory, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW)
	try {
		if (!(await handle.stat()).isDirectory()) throw new Error('[cloud-invalid-account-directory]')
		await handle.chmod(0o700)
		await handle.chown(owner.userId, owner.groupId)
	} finally {
		await handle.close()
	}
}

export const readCloudConfig = async (filePath: string) => {
	const stats = await fse.lstat(filePath)
	if (!stats.isFile() || stats.isSymbolicLink() || stats.size === 0 || stats.size > MAX_CONFIG_SIZE) {
		throw new Error(CLOUD_INVALID_ACCOUNT_CONFIG_ERROR)
	}

	const config = await fse.readFile(filePath, 'utf8')
	let section = ''
	const values: Record<string, string> = {}
	for (const rawLine of config.split('\n')) {
		const line = rawLine.trim()
		const sectionMatch = line.match(/^\[([^\]]+)\]$/)
		if (sectionMatch) {
			section = sectionMatch[1]
			continue
		}
		if (section !== CLOUD_RCLONE_REMOTE) continue
		const valueMatch = line.match(/^([^=]+?)\s*=\s*(.*)$/)
		if (valueMatch) values[valueMatch[1].trim()] = valueMatch[2]
	}

	const provider = Object.entries(RCLONE_PROVIDER_TYPES).find(([, type]) => type === values.type)?.[0] as
		| Provider
		| undefined
	if (!provider) throw new Error(CLOUD_INVALID_ACCOUNT_CONFIG_ERROR)
	return {stats, provider, values}
}

const assertCanonicalConfig = async (filePath: string, owner: FileOwner, expectedProvider?: Provider) => {
	const {stats, provider} = await readCloudConfig(filePath)
	if (
		(stats.mode & 0o777) !== 0o600 ||
		stats.uid !== owner.userId ||
		stats.gid !== owner.groupId ||
		(expectedProvider && provider !== expectedProvider)
	) {
		throw new Error(CLOUD_INVALID_ACCOUNT_CONFIG_ERROR)
	}
	return provider
}

export class RcloneConfigTransaction {
	#rclone: CloudRclone
	#process: ExecaChildProcess<string>
	#socketDirectory: string
	#socketPath: string
	#fileOwner: FileOwner
	#stopPromise?: Promise<void>
	#state: 'active' | 'prepared' | 'committed' | 'aborted' = 'active'

	readonly accountId: string
	readonly configPath: string

	constructor(
		rclone: CloudRclone,
		accountId: string,
		configPath: string,
		process: ExecaChildProcess<string>,
		socketDirectory: string,
		socketPath: string,
		fileOwner: FileOwner,
	) {
		this.#rclone = rclone
		this.accountId = accountId
		this.configPath = configPath
		this.#process = process
		this.#socketDirectory = socketDirectory
		this.#socketPath = socketPath
		this.#fileOwner = fileOwner
	}

	call<T = Record<string, never>>(method: string, parameters: Record<string, unknown> = {}) {
		if (this.#state !== 'active') throw new Error('[cloud-config-transaction-closed]')
		return this.#call<T>(method, parameters)
	}

	async #call<T>(method: string, parameters: Record<string, unknown>) {
		if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(method)) throw new Error('[cloud-invalid-rc-method]')

		const body = JSON.stringify(parameters)
		const timeoutSignal = AbortSignal.timeout(CONFIG_CONTROL_TIMEOUT)
		const result = await new Promise<T>((resolve, reject) => {
			const request = http.request(
				{
					socketPath: this.#socketPath,
					path: `/${method}`,
					method: 'POST',
					headers: {'content-type': 'application/json', 'content-length': Buffer.byteLength(body)},
					signal: timeoutSignal,
				},
				(response) => {
					let responseBody = ''
					response.on('data', (chunk) => {
						try {
							responseBody = appendWithLimit(responseBody, chunk, MAX_RC_RESPONSE)
						} catch (error) {
							request.destroy(error as Error)
						}
					})
					response.on('end', () => {
						let result: Record<string, unknown> = {}
						try {
							if (responseBody) result = JSON.parse(responseBody) as Record<string, unknown>
						} catch {
							reject(new RcloneRcError(response.statusCode ?? 500, 'invalid JSON response'))
							return
						}

						if ((response.statusCode ?? 500) >= 400 || typeof result.error === 'string') {
							reject(new RcloneRcError(response.statusCode ?? 500, String(result.error ?? 'unknown error')))
							return
						}
						resolve(result as T)
					})
				},
			)
			request.once('error', (error) => {
				reject(timeoutSignal.aborted ? new Error('[cloud-config-session-control-timeout]') : error)
			})
			request.end(body)
		})

		await setPrivateFilePermissions(this.configPath, this.#fileOwner, true)
		return result
	}

	async prepare() {
		if (this.#state !== 'active') throw new Error('[cloud-config-transaction-closed]')
		try {
			await this.#stop()
			if (this.#state !== 'active') throw new Error('[cloud-config-transaction-closed]')
			await this.#rclone.prepareTemporaryConfig(this.accountId, this.configPath)
			this.#state = 'prepared'
		} catch (error) {
			this.#state = 'aborted'
			await fse.remove(this.configPath).catch(() => {})
			throw error
		}
	}

	async promote() {
		if (this.#state !== 'prepared') throw new Error('[cloud-config-transaction-closed]')
		try {
			const configPath = await this.#rclone.promoteTemporaryConfig(this.accountId, this.configPath)
			this.#state = 'committed'
			return configPath
		} catch (error) {
			this.#state = 'aborted'
			await fse.remove(this.configPath).catch(() => {})
			throw error
		}
	}

	async abort() {
		if (this.#state === 'committed' || this.#state === 'aborted') return
		const stopSession = this.#state === 'active'
		this.#state = 'aborted'
		if (stopSession) await this.#stop().catch(() => {})
		await fse.remove(this.configPath).catch(() => {})
	}

	#stop() {
		return (this.#stopPromise ??= (async () => {
			await stopProcess(this.#process)
			await fse.remove(this.#socketDirectory).catch(() => {})
		})())
	}
}

export default class CloudRclone {
	readonly rootDirectory: string
	readonly fileOwner: FileOwner
	readonly binary: string

	constructor({
		dataDirectory,
		fileOwner,
		binary = process.env.CLOUD_RCLONE_BINARY ?? 'rclone',
	}: {
		dataDirectory: string
		fileOwner: FileOwner
		binary?: string
	}) {
		this.rootDirectory = nodePath.join(dataDirectory, 'cloud', 'accounts')
		this.fileOwner = fileOwner
		this.binary = binary
	}

	getAccountPaths(accountId: string): AccountPaths {
		validateAccountId(accountId)
		const directory = nodePath.join(this.rootDirectory, accountId)
		return {
			directory,
			config: nodePath.join(directory, 'rclone.conf'),
			cache: nodePath.join(directory, 'cache'),
			temp: nodePath.join(directory, 'temp'),
			filter: nodePath.join(directory, 'junk-filter'),
		}
	}

	async ensureAccountDirectory(accountId: string) {
		const paths = this.getAccountPaths(accountId)
		// Recursive creation would otherwise leave the intermediate cloud
		// directory owned by root and inaccessible to the uid-1000 rclone process.
		await assertPrivateDirectory(nodePath.dirname(this.rootDirectory), this.fileOwner)
		await assertPrivateDirectory(this.rootDirectory, this.fileOwner)
		await assertPrivateDirectory(paths.directory, this.fileOwner)
		await assertPrivateDirectory(paths.cache, this.fileOwner)
		await assertPrivateDirectory(paths.temp, this.fileOwner)
		const filter = await open(paths.filter, fsConstants.O_RDWR | fsConstants.O_CREAT | fsConstants.O_NOFOLLOW, 0o600)
		try {
			const stats = await filter.stat()
			if (!stats.isFile()) throw new Error('[cloud-invalid-account-filter]')
			const current = stats.size === Buffer.byteLength(CLOUD_JUNK_FILTER) ? await filter.readFile('utf8') : undefined
			if (current !== CLOUD_JUNK_FILTER) {
				await filter.truncate(0)
				await filter.write(CLOUD_JUNK_FILTER, 0, 'utf8')
			}
			await filter.chmod(0o600)
			await filter.chown(this.fileOwner.userId, this.fileOwner.groupId)
		} finally {
			await filter.close()
		}
		return paths
	}

	async hasCanonicalConfig(accountId: string, provider: Provider) {
		const {config} = this.getAccountPaths(accountId)
		return assertCanonicalConfig(config, this.fileOwner, provider).then(
			() => true,
			() => false,
		)
	}

	async beginConfigTransaction(accountId: string) {
		const paths = await this.ensureAccountDirectory(accountId)
		const temporaryConfigPath = nodePath.join(paths.directory, `rclone-${randomUUID()}.tmp`)
		try {
			return await this.startConfigTransaction(paths, accountId, temporaryConfigPath)
		} catch (error) {
			await fse.remove(temporaryConfigPath).catch(() => {})
			throw error
		}
	}

	async prepareTemporaryConfig(accountId: string, temporaryConfigPath: string) {
		const paths = this.getAccountPaths(accountId)
		if (nodePath.dirname(nodePath.resolve(temporaryConfigPath)) !== nodePath.resolve(paths.directory)) {
			throw new Error('[cloud-invalid-temporary-config]')
		}
		await setPrivateFilePermissions(temporaryConfigPath, this.fileOwner)
		await assertCanonicalConfig(temporaryConfigPath, this.fileOwner)
	}

	async promoteTemporaryConfig(accountId: string, temporaryConfigPath: string) {
		const paths = this.getAccountPaths(accountId)
		if (nodePath.dirname(nodePath.resolve(temporaryConfigPath)) !== nodePath.resolve(paths.directory)) {
			throw new Error('[cloud-invalid-temporary-config]')
		}
		await fse.rename(temporaryConfigPath, paths.config)
		return paths.config
	}

	async removeAccountDirectory(accountId: string) {
		const {directory} = this.getAccountPaths(accountId)
		await fse.remove(directory)
	}

	async removeTemporaryConfigFiles(accountId: string) {
		const {directory} = this.getAccountPaths(accountId)
		let entries: string[]
		try {
			entries = await fse.readdir(directory)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
			throw error
		}
		await Promise.all(
			entries
				.filter((entry) => TEMPORARY_CONFIG_PATTERN.test(entry))
				.map((entry) => fse.unlink(nodePath.join(directory, entry))),
		)
	}

	async browse({
		accountId,
		provider,
		remote,
		configPath,
		maxEntries = 500,
		signal,
	}: {
		accountId: string
		provider: Provider
		remote: RemoteRef
		configPath?: string
		maxEntries?: number
		signal?: AbortSignal
	}): Promise<RcloneBrowseResult> {
		if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 1000)
			throw new Error('[cloud-invalid-list-limit]')
		const paths = await this.ensureAccountDirectory(accountId)
		const selectedConfig = await this.resolveConfigPath(paths, provider, configPath)
		const source = buildRcloneRemoteSource(provider, remote)
		const {stdout} = await this.run(
			[
				'lsjson',
				source,
				'--config',
				selectedConfig,
				'--cache-dir',
				paths.cache,
				'--temp-dir',
				paths.temp,
				'--filter-from',
				paths.filter,
				'--max-depth',
				'1',
				'--no-modtime',
				'--no-mimetype',
				'--use-json-log',
			],
			{signal},
		)

		let listing: unknown
		try {
			listing = JSON.parse(stdout)
		} catch {
			throw new Error('[cloud-invalid-rclone-listing]')
		}
		if (!Array.isArray(listing)) throw new Error('[cloud-invalid-rclone-listing]')

		const entries = listing.map((entry): RcloneBrowseEntry => {
			if (
				typeof entry !== 'object' ||
				entry === null ||
				typeof (entry as {IsDir?: unknown}).IsDir !== 'boolean' ||
				typeof (entry as {Name?: unknown}).Name !== 'string' ||
				typeof (entry as {Path?: unknown}).Path !== 'string'
			) {
				throw new Error('[cloud-invalid-rclone-listing]')
			}
			const id = (entry as {ID?: unknown}).ID
			const type = (entry as {IsDir: boolean}).IsDir ? 'directory' : 'file'
			return {
				name: (entry as {Name: string}).Name,
				path: (entry as {Path: string}).Path,
				type,
				...(type === 'directory' && typeof id === 'string' && id ? {id} : {}),
			}
		})

		// Files are useful context, but must never crowd folders out of a capped
		// folder-picker response.
		entries.sort((left, right) => Number(left.type === 'file') - Number(right.type === 'file'))
		return {entries: entries.slice(0, maxEntries), truncated: entries.length > maxEntries}
	}

	async refreshOAuthToken(accountId: string, provider: Provider, signal?: AbortSignal) {
		if (provider !== 'google-drive' && provider !== 'dropbox' && provider !== 'onedrive') return
		const paths = await this.ensureAccountDirectory(accountId)
		await assertCanonicalConfig(paths.config, this.fileOwner, provider)
		// `about` is a small read-only request that lets rclone refresh and
		// persist an expired OAuth token before direct provider API calls.
		await this.run(
			[
				'about',
				`${CLOUD_RCLONE_REMOTE}:`,
				'--json',
				'--config',
				paths.config,
				'--cache-dir',
				paths.cache,
				'--temp-dir',
				paths.temp,
				'--use-json-log',
			],
			{signal},
		)
	}

	async sync({
		accountId,
		provider,
		syncId,
		remote,
		destination,
		minimumFreeBytes,
		signal,
		onActivity,
	}: {
		accountId: string
		provider: Provider
		syncId: string
		remote: RemoteRef
		destination: string
		minimumFreeBytes: bigint
		signal?: AbortSignal
		onActivity?: (activity: CloudSyncActivity) => void
	}) {
		const paths = await this.ensureAccountDirectory(accountId)
		await assertCanonicalConfig(paths.config, this.fileOwner, provider)
		const source = buildRcloneRemoteSource(provider, remote)
		const providerFlags = [
			...RCLONE_SYNC_PROVIDER_FLAGS[provider],
			...(provider === 'onedrive' && remote.driveType === 'personal' && remote.path === '/'
				? ['--filter', '- /Personal Vault/**']
				: []),
		]
		const filesystem = await statfs(destination, {bigint: true})
		const maxTransferBytes = cloudTransferBudget(filesystem.bavail * filesystem.bsize, minimumFreeBytes)
		if (maxTransferBytes === undefined) throw new Error('[cloud-destination-low-space]')

		await this.run(
			[
				// Verified against rclone v1.74.4: sync defaults to delete-after and cleans
				// stale partials after a successful retry. Do not add remote mutation flags.
				'sync',
				source,
				'.',
				'--config',
				paths.config,
				'--cache-dir',
				paths.cache,
				'--temp-dir',
				paths.temp,
				'--create-empty-src-dirs',
				'--filter-from',
				paths.filter,
				'--max-transfer',
				`${maxTransferBytes}B`,
				'--order-by',
				'size,ascending',
				...providerFlags,
				'--stats',
				'1s',
				'--stats-log-level',
				'NOTICE',
				'--use-json-log',
				'--retries',
				'1',
				'--low-level-retries',
				'3',
				'--transfers',
				'4',
				'--checkers',
				'8',
			],
			{
				cwd: destination,
				signal,
				onRecord: (record) => {
					if (!record.stats) return
					const activity = activityFromRcloneStats(syncId, record.stats)
					if (activity) onActivity?.(activity)
				},
			},
		)
	}

	private async resolveConfigPath(paths: AccountPaths, provider: Provider, configPath?: string) {
		const selectedConfig = nodePath.resolve(configPath ?? paths.config)
		if (nodePath.dirname(selectedConfig) !== nodePath.resolve(paths.directory))
			throw new Error(CLOUD_INVALID_ACCOUNT_CONFIG_ERROR)
		await assertCanonicalConfig(selectedConfig, this.fileOwner, provider)
		return selectedConfig
	}

	private async startConfigTransaction(paths: AccountPaths, accountId: string, configPath: string) {
		// Verified against rclone v1.74.4: rcd accepts a unix:// address and all
		// interactive config state can be continued through the JSON RC API.
		// Unix socket paths are limited to roughly 108 bytes on Linux. Keeping the
		// socket below the OS temp directory prevents a deep data directory from
		// making rcd fail to bind in production.
		const socketDirectory = await fse.mkdtemp(nodePath.join(os.tmpdir(), 'umbrel-cloud-rc-'))
		await fse.chmod(socketDirectory, 0o700)
		await fse.chown(socketDirectory, this.fileOwner.userId, this.fileOwner.groupId)
		const socketPath = nodePath.join(socketDirectory, `rc-${randomToken(32)}.sock`)
		let process: ExecaChildProcess<string> | undefined
		try {
			const child = execa(
				this.binary,
				[
					'rcd',
					'--rc-addr',
					`unix://${socketPath}`,
					'--rc-no-auth',
					'--config',
					configPath,
					'--cache-dir',
					paths.cache,
					'--temp-dir',
					paths.temp,
					'--log-level',
					'ERROR',
					'--use-json-log',
				],
				{
					uid: this.fileOwner.userId,
					gid: this.fileOwner.groupId,
					stdin: 'ignore',
					stdout: 'ignore',
					stderr: 'pipe',
					buffer: false,
					reject: false,
				},
			)
			process = child
			const logs = createLineCollector(child.stderr)

			await pWaitFor(
				async () => {
					if (child.exitCode !== null || child.signalCode !== null) {
						const exit = processExit(await child)
						await logs.finished
						throw new RcloneProcessError('rcd', exit, logs.records)
					}
					// rcd creates the socket file when it binds, just before it listens.
					// Only an accepted connection proves the RC API is ready for calls.
					return await new Promise<boolean>((resolve, reject) => {
						const probe = net.createConnection(socketPath)
						probe.once('connect', () => {
							probe.destroy()
							resolve(true)
						})
						probe.once('error', (error: NodeJS.ErrnoException) => {
							if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') resolve(false)
							else reject(error)
						})
					})
				},
				{
					interval: 20,
					timeout: {
						milliseconds: CONFIG_START_TIMEOUT,
						message: new Error('[cloud-config-session-start-timeout]'),
					},
				},
			)
			return new RcloneConfigTransaction(
				this,
				accountId,
				configPath,
				child,
				socketDirectory,
				socketPath,
				this.fileOwner,
			)
		} catch (error) {
			if (process) await stopProcess(process).catch(() => {})
			await fse.remove(socketDirectory).catch(() => {})
			throw error
		}
	}

	private async run(
		args: string[],
		{cwd, signal, onRecord}: {cwd?: string; signal?: AbortSignal; onRecord?: (record: RcloneLogRecord) => void} = {},
	) {
		if (signal?.aborted) throw new RcloneAbortedError()
		const process = execa(this.binary, args, {
			cwd,
			uid: this.fileOwner.userId,
			gid: this.fileOwner.groupId,
			stdin: 'ignore',
			stdout: 'pipe',
			stderr: 'pipe',
			buffer: false,
			reject: false,
		})
		const logs = createLineCollector(process.stderr, onRecord)
		let stdout = ''
		let outputError: Error | undefined

		process.stdout?.on('data', (chunk) => {
			try {
				stdout = appendWithLimit(stdout, chunk, MAX_COMMAND_OUTPUT)
			} catch (error) {
				outputError = error as Error
				process.kill('SIGKILL')
			}
		})
		const abort = () => void stopProcess(process)
		signal?.addEventListener('abort', abort, {once: true})
		const exit = processExit(await process)
		signal?.removeEventListener('abort', abort)
		await logs.finished

		if (outputError) throw outputError
		if (signal?.aborted) throw new RcloneAbortedError()
		if (exit.error || exit.code !== 0) throw new RcloneProcessError(args[0], exit, logs.records)
		return {stdout, records: logs.records}
	}
}
