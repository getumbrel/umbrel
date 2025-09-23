import {createHash} from 'node:crypto'
import nodePath from 'node:path'
import {setTimeout} from 'node:timers/promises'

import {execa, ExecaError} from 'execa'
import fse from 'fs-extra'
import pQueue from 'p-queue'
import prettyBytes from 'pretty-bytes'

import randomToken from '../../modules/utilities/random-token.js'
import {copyWithProgress} from '../utilities/copy-with-progress.js'

// TODO: These should be refactored into proper umbreld modules
import {getSystemDiskUsage} from '../system/system.js'
import {setSystemStatus} from '../system/routes.js'
import {reboot} from '../system/system.js'

import type Umbreld from '../../index.js'

type Backup = {
	// Our internal id in the format: <repositoryId>:<snapshotId>
	id: string
	time: number
	size: number
}

type BackupProgress = {
	repositoryId: string
	percent: number
}

export type RestoreProgress = {
	backupId: string
	percent: number
	bytesPerSecond: number
	secondsRemaining?: number
} | null

export type BackupsInProgress = BackupProgress[]

export default class Backups {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	internalMountPath: string
	backupRoot: string
	backupsInProgress: BackupsInProgress = []
	restoreProgress: RestoreProgress = null
	running = false
	backupInterval = 1000 * 60 * 60 // 1 hour
	backupJobPromise?: Promise<void>
	kopiaQueue = new pQueue({concurrency: 1})
	backupDirectoryName = 'Umbrel Backup.backup'

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(name.toLocaleLowerCase())
		this.internalMountPath = nodePath.join(umbreld.dataDirectory, 'backup-mounts')
		this.backupRoot = umbreld.files.getBaseDirectory('/Backups')
	}

	async start() {
		this.logger.log('Starting backups')
		this.running = true

		// Cleanup any left over backup mounts
		await this.unmountAll().catch((error) => this.logger.error('Error unmounting backups', error))

		// Ignore Downloads on first run
		const isFirstRun = (await this.#umbreld.store.get('backups')) === undefined
		if (isFirstRun) {
			this.logger.log('Backup first run, adding Downloads to ignore...')
			await this.addIgnoredPath('/Home/Downloads').catch((error) =>
				this.logger.error('Error adding Downloads to ignore', error),
			)
		}

		// Fire off background backup process
		this.backupJobPromise = this.backupOnInterval().catch((error) =>
			this.logger.error('Error running backups on interval', error),
		)
	}

	async stop() {
		this.logger.log('Stopping backups')
		this.running = false

		// Wait for any backup jobs
		this.logger.log('Waiting for any backup jobs')
		if (this.backupJobPromise) await this.backupJobPromise

		// Cleanup any currently mounted backups
		await this.unmountAll().catch((error) => this.logger.error('Error unmounting backups', error))
	}

	// Run backups in background
	async backupOnInterval() {
		this.logger.log('Scheduling backups interval')
		let lastRun = Date.now()
		while (this.running) {
			await setTimeout(100)
			const userExists = await this.#umbreld.user.exists()
			const shouldRun = userExists && Date.now() - lastRun >= this.backupInterval
			if (!shouldRun) continue
			lastRun = Date.now()

			this.logger.log('Running backups interval')
			const repositories = await this.getRepositories().catch((error) => {
				this.logger.error('Error getting repositories', error)
				return []
			})

			// Run each backup
			for (const repository of repositories) {
				// Skip if we already have a backup in progress
				const isAlreadyBackingUp = this.backupsInProgress.some((progress) => progress.repositoryId === repository.id)
				if (isAlreadyBackingUp) {
					this.logger.log(`Backup already in progress for ${repository.path}`)
				} else {
					await this.backup(repository.id).catch((error) =>
						this.logger.error(`Error backing up ${repository.id}`, error),
					)
				}

				// Alert the user if backups have failed for over 24 hours
				const {lastBackup} = await this.getRepository(repository.id)
				const hoursSinceLastBackup = (Date.now() - (lastBackup || 0)) / (1000 * 60 * 60)
				if (hoursSinceLastBackup > 24) {
					this.logger.error(`Backup for ${repository.path} has not run in over 24 hours`)
					await this.#umbreld.notifications.add('backups-failing').catch(() => {})
				}
			}

			this.logger.log('Backups interval complete')
		}
	}

	// Get repositories
	async getRepositories() {
		return (await this.#umbreld.store.get('backups.repositories')) || []
	}

	// Get repository by id
	async getRepository(id: string) {
		const repositories = await this.getRepositories()
		const repository = repositories.find((repository) => repository.id === id)
		if (!repository) throw new Error(`Repository ${id} not found`)
		return repository
	}

	// Run a kopia command
	// We just default to bypassing the queue to effectively disable it now. It was causing blocking problems.
	// We can carefully re-enable it in select places in the future if we need to.
	async kopia(
		flags: string[] = [],
		{onOutput, bypassQueue = true}: {onOutput?: (output: string) => void; bypassQueue?: boolean} = {},
	) {
		const spawnKopiaProcess = async () => {
			// Spawn process
			const env = {
				KOPIA_CHECK_FOR_UPDATES: 'false',
				XDG_CACHE_HOME: '/kopia/cache',
				XDG_CONFIG_HOME: '/kopia/config',
			}
			const process = execa('kopia', flags, {env})

			// Pipe output to verbose logger and optional onOutput handler
			const handleOutput = (data: Buffer) => {
				const line = data.toString()
				this.logger.verbose(line.trim())
				onOutput?.(line)
			}
			process.stdout?.on('data', (data) => handleOutput(data))
			process.stderr?.on('data', (data) => handleOutput(data))

			// Return process promise
			return process
		}
		// Ensure we only run one kopia process at a time
		return bypassQueue ? spawnKopiaProcess() : this.kopiaQueue.add(spawnKopiaProcess)
	}

	// Create a repository
	async createRepository(virtualPath: string, password: string) {
		const createNew = true
		return this.addRepository(virtualPath, password, createNew)
	}

	// Connect to existing repository
	async connectToExistingRepository(virtualPath: string, password: string) {
		const createNew = false
		return this.addRepository(virtualPath, password, createNew)
	}

	// Add a repository to the store and connect to it
	// Conditionally creates a new repository if createNew is true
	async addRepository(virtualPath: string, password: string, createNew = true) {
		virtualPath = nodePath.join(virtualPath, this.backupDirectoryName)

		// Check we have either a network share or external drive
		const systemPath = await this.#umbreld.files.virtualToSystemPath(virtualPath).catch(() => '')
		const isNetworkPath = systemPath.startsWith(this.#umbreld.files.getBaseDirectory('/Network'))
		const isExternalPath = systemPath.startsWith(this.#umbreld.files.getBaseDirectory('/External'))
		if (!isNetworkPath && !isExternalPath) throw new Error(`Invalid path ${virtualPath}`)

		// TODO: We might also want to store some kind of unique identifier like filesystem uuid. Otherwise
		// a different destination mounted at the same path could be used as the destination. Or if there
		// are two external drives "Untitled" and "Untitled (2)" that are then mounted in different orders
		// we won't be able to resolve the path.

		// Derive 128 bit hex string from password
		// This is not key stretching, key stretching is handled internally by kopia with scrypt.
		// This is just to avoid keeping plain text passwords around in the store.
		password = createHash('sha256').update(password).digest('hex').slice(0, 16)

		// Derive unique id from path
		const id = createHash('sha256').update(virtualPath).digest('hex').slice(0, 8)

		// Create kopia repository if we're creating a new one
		if (createNew) {
			this.logger.log(`Creating repository ${id}`)

			// Create the directory
			await fse.mkdir(systemPath, {recursive: false}).catch((error) => {
				if (error.code === 'EEXIST') throw new Error(`Repository already exists at ${virtualPath}`)
				throw error
			})
			await this.#umbreld.files.chownSystemPath(systemPath).catch(() => {}) // Might throw on fs without chown

			// Create the kopia repository
			// TODO: Investigate all the possible options here
			await this.kopia([
				'repository',
				'create',
				'filesystem',
				// Location to backup the data to
				`--path=${systemPath}`,
				// Path to local config file for this repository
				// These don't seem to need to be persisted. If you nuke them they
				// get recreated the next time we connect.
				`--config-file=/kopia/config/${id}.config`,
				// Password for the repository
				`--password=${password}`,
			])
		}

		// Update the store
		await this.#umbreld.store.getWriteLock(async ({set}) => {
			const repositories = await this.getRepositories()

			// Sanity check to prevent dupes but this shouldn't ever happen because
			// the repository creation should fail
			const repositoryExists = repositories.some((existingRepository) => existingRepository.id === id)
			if (!repositoryExists) repositories.push({id, path: virtualPath, password})

			await set('backups.repositories', repositories)
		})

		// Connect to repository
		await this.connect(id).catch(async (error) => {
			// If connecting fails when setting up an existing repository it means the details are incorrect.
			// Clean up and remove it from the store.
			const isConnectingToExistingRepository = !createNew
			if (isConnectingToExistingRepository) await this.forgetRepository(id).catch(() => {})
			throw error
		})

		this.logger.log(`Connected to repository ${id}`)
		return id
	}

	// Forget a repository
	async forgetRepository(repositoryId: string) {
		this.logger.log(`Forgetting repository ${repositoryId}`)

		// TODO: Ideally we would unmount any mounts we have from this repository but we
		// don't really have a clean way to do that with the current architecture. Probably
		// fine for now.

		await this.#umbreld.store.getWriteLock(async ({set}) => {
			let repositories = await this.getRepositories()
			repositories = repositories.filter((repository) => repository.id !== repositoryId)
			await set('backups.repositories', repositories)
		})

		this.logger.log(`Forgot repository ${repositoryId}`)
	}

	// Restore a backup
	async restoreBackup(backupId: string) {
		if (this.restoreProgress) throw new Error('[in-progress] Restore already in progress')
		let success = false

		// Check we have enough free space to restore the backup
		const backup = await this.getBackup(backupId)
		const diskUsage = await getSystemDiskUsage(this.#umbreld)
		const buffer = 1024 * 1024 * 1024 * 5 // 5GB
		const neededSpace = backup.size + buffer
		if (diskUsage.available < neededSpace) throw new Error('[not-enough-space] Not enough free space to restore backup')

		this.logger.log(`Restoring backup ${backupId}`)
		setSystemStatus('restoring')
		const backupDirectoryName = await this.mountBackup(backupId)
		const internalBackupMountpoint = nodePath.join(this.internalMountPath, backupDirectoryName)
		const temporaryData = `${this.#umbreld.dataDirectory}/.temporary-migration`
		const finalData = `${this.#umbreld.dataDirectory}/import`

		// Create initial progress tracker and emit operation progress event
		this.restoreProgress = {backupId, percent: 0, bytesPerSecond: 0}
		this.#umbreld.eventBus.emit('backups:restore-progress', this.restoreProgress)

		try {
			// Copy over data dir from previous install to temp dir while preserving permissions
			await fse.remove(temporaryData)
			await copyWithProgress(`${internalBackupMountpoint}/`, temporaryData, (progress) => {
				this.restoreProgress!.percent = progress.progress
				this.restoreProgress!.bytesPerSecond = progress.bytesPerSecond
				this.restoreProgress!.secondsRemaining = progress.secondsRemaining
				this.#umbreld.eventBus.emit('backups:restore-progress', this.restoreProgress)
				this.logger.log(`Restored ${this.restoreProgress!.percent}% of backup`)
			})
			await fse.move(temporaryData, finalData, {overwrite: true})
			success = true
		} finally {
			// Reset status on failure, or always in test mode (no reboot)
			if (!success || process.env.UMBRELD_RESTORE_SKIP_REBOOT === 'true') setSystemStatus('running')

			// Remove the progress tracker and emit operation progress event
			this.restoreProgress = null
			this.#umbreld.eventBus.emit('backups:restore-progress', this.restoreProgress)
		}

		// Dirty hack to allow us to test restore without rebooting
		if (process.env.UMBRELD_RESTORE_SKIP_REBOOT !== 'true') {
			this.logger.log(`Rebooting into newly recovered data`)
			setSystemStatus('restarting')
			await this.#umbreld.stop().catch(() => {})
			await reboot()
		}

		return
	}

	// Connect to a repository
	// We must be connected to a repository before we can backup to it
	private async connect(repositoryId: string) {
		const repository = await this.getRepository(repositoryId)

		const systemPath = this.#umbreld.files.virtualToSystemPathUnsafe(repository.path)
		await this.kopia([
			'repository',
			'connect',
			'filesystem',
			// Location to backup the data to
			`--path=${systemPath}`,
			// Path to local config file for this repository
			// These don't seem to need to be persisted. If you nuke them they
			// get recreated the next time we connect.
			`--config-file=/kopia/config/${repository.id}.config`,
			// Password for the repository
			`--password=${repository.password}`,
			// Force the hostname to 'umbrel' so backups always match the same host.
			// Without this if you start backing up, then change your hostname, then
			// continue to backup, kopia will see these as backups originating from
			// different machines.
			'--override-hostname=umbrel',
		])
	}

	// Wrapper for kopia commands that interact with a repository
	async repository(
		repositoryId: string,
		flags: string[] = [],
		{onOutput, bypassQueue = true}: {onOutput?: (output: string) => void; bypassQueue?: boolean} = {},
	) {
		// Check we're connected to the repository
		// We technically only need to connect once, but there's no downside to connecting
		// once we're already connected. This also conveniently means we auto retry connecting
		// to repos that weren't accessible before.
		await this.connect(repositoryId)

		// Run the command
		return this.kopia([...flags, `--config-file=/kopia/config/${repositoryId}.config`], {onOutput, bypassQueue})
	}

	// Get size of a repository
	async getRepositorySize(repositoryId: string) {
		const repository = await this.getRepository(repositoryId)

		// Get the used size of the repository
		const stats = await this.repository(repository.id, ['content', 'stats', '--raw'])
		const sizeLinePattern = 'Total Packed: '
		const sizeLine = stats.stdout.split('\n').find((line) => line.startsWith(sizeLinePattern)) || ''
		const used = Number(sizeLine.replace(sizeLinePattern, '').split(' ')[0])

		// Get the capacity and available space of the repository
		const status = await this.repository(repository.id, ['repository', 'status', '--json'])
		const {capacity, available} = JSON.parse(status.stdout).volume
		return {used, capacity, available}
	}

	// Backup the umbrel data directory to a repository
	async backup(repositoryId: string) {
		const repository = await this.getRepository(repositoryId)
		this.logger.log(`Backing up to ${repository.path}`)

		// Ensure policy is enforced
		this.logger.log(`Ensuring policy is enforced`)
		await this.repository(repository.id, [
			'policy',
			'set',
			'--global',
			// Retention policy
			'--keep-latest=10',
			'--keep-hourly=24',
			'--keep-daily=7',
			'--keep-weekly=4',
			'--keep-monthly=12',
			'--keep-annual=0',
			// Compression
			'--compression=zstd-fastest',
			// Never cross fs boundaries
			'--one-file-system=true',
			// Throttle CPU usage
			'--max-parallel-file-reads=1',
		])
		this.logger.log(`Retention policy enforced`)

		// Ensure we have the latest ignore file before backing up
		this.logger.verbose(`Ensuring ignore file is up to date`)
		await this.createIgnoreFile()

		// Initialize progress tracking
		const backupProgress: BackupProgress = {repositoryId, percent: 0}
		this.backupsInProgress.push(backupProgress)
		this.#umbreld.eventBus.emit('backups:backup-progress', this.backupsInProgress)

		try {
			// Create the snapshot
			// TODO: Attempt recovering from device out of space errors by deleting old snapshots
			this.logger.log(`Creating snapshot`)
			await this.repository(repository.id, ['snapshot', 'create', this.#umbreld.dataDirectory], {
				onOutput: (output) => {
					// Pluck progress in brackets from output like:
					// '/ 1 hashing, 216 hashed (1.6 GB), 21121 cached (5.4 GB), uploaded 1.4 GB, estimated 7.6 GB (91.6%) 0s left'
					const match = output.match(/estimated.*\((\d+(?:\.\d+)?)%\).*left/)
					if (!match) return

					// Update progress
					backupProgress.percent = Number(match[1])
					this.#umbreld.eventBus.emit('backups:backup-progress', this.backupsInProgress)
				},
			})

			this.logger.log(`Backed up ${repository.path}`)

			// Save last backed up date
			await this.#umbreld.store.getWriteLock(async ({set}) => {
				const repositories = await this.getRepositories()
				repositories.find((repository) => repository.id === repositoryId)!.lastBackup = Date.now()
				await set('backups.repositories', repositories)
			})

			// Check the size of the repository
			const size = await this.getRepositorySize(repository.id)
			this.logger.log(
				`${repository.path} size after backup: Used ${prettyBytes(size.used)} of ${prettyBytes(size.capacity)}`,
			)

			return true
		} finally {
			// Remove progress tracking
			this.backupsInProgress = this.backupsInProgress.filter((progress) => progress !== backupProgress)
			this.#umbreld.eventBus.emit('backups:backup-progress', this.backupsInProgress)
		}
	}

	// Get ignored paths
	async getIgnoredPaths() {
		return (await this.#umbreld.store.get('backups.ignore')) || []
	}

	// Set ignored paths
	async addIgnoredPath(path: string) {
		path = nodePath.resolve(path)
		const isHomePath = path === '/Home' || path.startsWith('/Home/')
		if (!isHomePath) throw new Error(`Path to exclude must be in /Home`)

		await this.#umbreld.store.getWriteLock(async ({set}) => {
			let ignore = await this.getIgnoredPaths()
			ignore = Array.from(new Set([...ignore, path]))
			await set('backups.ignore', ignore)
		})
		return true
	}

	// Remove ignored path
	async removeIgnoredPath(path: string) {
		path = nodePath.resolve(path)
		const isHomePath = path === '/Home' || path.startsWith('/Home/')
		if (!isHomePath) throw new Error(`Path to exclude must be in /Home`)

		await this.#umbreld.store.getWriteLock(async ({set}) => {
			let ignore = await this.getIgnoredPaths()
			ignore = ignore.filter((p) => p !== path)
			await set('backups.ignore', ignore)
		})
		return true
	}

	// Create ignore file for kopia
	async createIgnoreFile() {
		const ignoreFilePath = nodePath.join(this.#umbreld.dataDirectory, '.kopiaignore')
		let ignoreFileContents = []

		// Ignore non critical directories that can be rebuilt and cause a lot of churn
		ignoreFileContents.push('app-stores')
		ignoreFileContents.push(this.#umbreld.files.thumbnails.thumbnailDirectory)

		// Ignore backup mount points
		ignoreFileContents.push(this.internalMountPath)
		ignoreFileContents.push(this.backupRoot)

		// Add all user specified ignored paths
		const alwaysIgnoredPaths = ['/External', '/Network']
		const userIgnoredPaths = await this.getIgnoredPaths().catch(() => [])
		;[...alwaysIgnoredPaths, ...userIgnoredPaths].forEach((path) => {
			try {
				const systemPath = this.#umbreld.files.virtualToSystemPathUnsafe(path)
				ignoreFileContents.push(systemPath)
			} catch (error) {
				this.logger.error(`Failed to get system path for ignored path ${path}`, error)
			}
		})

		// Loop over apps
		await Promise.all(
			this.#umbreld.apps.instances.map(async (app) => {
				// Ignore entire data dir of user specified apps to ignore
				const isIgnored = await app.isBackupIgnored().catch((error) => {
					// If some app is in a broken state don't kill the whole backup
					this.logger.error(`Failed to get backup ignored status for ${app.id}`, error)
					return false
				})
				if (isIgnored) ignoreFileContents.push(app.dataDirectory)

				// Ignore paths that apps have signaled should be ignored
				const backupIgnore = await app.getBackupIgnoredFilePaths().catch((error) => {
					// If some app is in a broken state don't kill the whole backup
					this.logger.error(`Failed to get backup ignored file paths for ${app.id}`, error)
					return []
				})
				ignoreFileContents.push(...backupIgnore)
			}),
		)

		// Map all paths to absolute backup root paths
		// We make them absolute from the root like `/app-stores` instead of `app-stores` because
		// the relative would match any file or directory called `app-stores` but prepending with `/`
		// ensure it ony matches the exact path we want to ignore. Also if we use absolute system paths
		// we won't get match because kopia is assuming `/` is the backup root not the system root.
		ignoreFileContents = ignoreFileContents.map((path) => {
			// If it's an absolute system path, convert it to a relative data directory path
			if (path.startsWith(this.#umbreld.dataDirectory)) path = nodePath.relative(this.#umbreld.dataDirectory, path)
			// All paths should now be relative to the data directory which is the backup root,
			// prepend a `/` to make these absolute paths from from the backup root from kopia's perspective
			if (!path.startsWith('/')) path = `/${path}`
			return path
		})

		// Write the file atomically
		const temporaryIgnoreFilePath = `${ignoreFilePath}.${randomToken(32)}`
		await fse.writeFile(temporaryIgnoreFilePath, ignoreFileContents.join('\n'))
		await fse.move(temporaryIgnoreFilePath, ignoreFilePath, {overwrite: true})
	}

	// List backups
	async listBackups(repositoryId: string) {
		const repository = await this.getRepository(repositoryId)
		this.logger.log(`Listing backups for ${repository.path}`)

		// Dump all snapshots in JSON format
		const snapshots = await this.repository(repository.id, ['snapshot', 'list', '--json'])

		// Parse the JSON output
		const snapshotsParsed = JSON.parse(snapshots.stdout)

		// Create typed backup object from snapshot output with composite IDs
		const backups: Backup[] = []
		for (const snapshot of snapshotsParsed) {
			backups.push({
				id: `${repositoryId}:${snapshot.id}`,
				time: new Date(snapshot.startTime).getTime(),
				size: Number(snapshot.stats.totalSize),
			})
		}

		// Sort by time ascending
		return backups.sort((a, b) => a.time - b.time)
	}

	// List all backups
	async listAllBackups() {
		const repositories = await this.getRepositories()
		const backups: Backup[] = []
		await Promise.all(
			repositories.map(async (repository) => {
				const repositoryBackups = await this.listBackups(repository.id).catch((error) => {
					// If we can't list backups for a repository don't kill the whole backup list
					this.logger.error(`Failed to list backups for ${repository.id}`, error)
					return []
				})
				backups.push(...repositoryBackups)
			}),
		)

		// Sort by time ascending
		return backups.sort((a, b) => a.time - b.time)
	}

	// Parse a backup id into its repository id and snapshot id
	parseBackupId(backupId: string) {
		const [repositoryId, snapshotId] = backupId.split(':')
		return {repositoryId, snapshotId}
	}

	// Get a specific backup by id
	async getBackup(backupId: string) {
		const {repositoryId} = this.parseBackupId(backupId)
		const backups = await this.listBackups(repositoryId)
		const backup = backups.find((backup) => backup.id === backupId)
		if (!backup) throw new Error(`[not-found] Backup ${backupId} not found`)
		return backup
	}

	// List the files in a backup
	// Note: you can append a path to a backup id to traverse the fs
	async listBackupFiles(backupId: string, path = '/') {
		const {repositoryId, snapshotId} = this.parseBackupId(backupId)
		const ls = await this.repository(repositoryId, ['ls', `${snapshotId}${path}`])
		return ls.stdout.split('\n')
	}

	// Mount backup
	async mountBackup(backupId: string) {
		const {repositoryId, snapshotId} = this.parseBackupId(backupId)

		// Get the backup time for directory naming
		const backup = await this.getBackup(backupId)
		if (!backup) throw new Error(`Backup ${backupId} not found`)

		this.logger.log(`Mounting backup ${backupId}`)

		this.logger.verbose(`Setting up internal mount`)
		const directoryName = new Date(backup.time).toISOString()
		const internalMountpoint = nodePath.join(this.internalMountPath, directoryName)
		await fse.mkdir(internalMountpoint, {recursive: true})
		let mountProcessExitCode = null
		this.repository(repositoryId, ['mount', snapshotId, internalMountpoint], {bypassQueue: true})
			.then((process) => (mountProcessExitCode = process.exitCode))
			.catch((error) => {
				this.logger.error(`Failed to mount backup ${backupId}`, error)
				mountProcessExitCode = (error as ExecaError).exitCode
			})

		// Wait for the mount to complete
		const startTime = Date.now()
		const timeout = 10_000 // 10 seconds
		while (true) {
			// Check timeout
			if (Date.now() - startTime > timeout) throw new Error(`Mount timeout after ${timeout}ms`)

			// Check if process has exited
			if (mountProcessExitCode !== null) throw new Error(`Mount exited with code ${mountProcessExitCode}`)

			// Check if mountpoint has contents
			const contents = await fse.readdir(internalMountpoint).catch(() => [])
			if (contents.length > 0) break // Mount complete

			// Wait a bit before checking again
			await setTimeout(100)
		}
		this.logger.verbose(`Internal mount complete`)

		this.logger.verbose(`Setting up virtual filesystem mounts`)
		const backupRoot = nodePath.join(this.backupRoot, directoryName)
		const homeMount = nodePath.join(backupRoot, 'Home')
		const appsMount = nodePath.join(backupRoot, 'Apps')
		await fse.mkdir(homeMount, {recursive: true})
		await fse.mkdir(appsMount, {recursive: true})
		await execa('mount', ['--bind', nodePath.join(internalMountpoint, 'home'), homeMount])
		await execa('mount', ['--bind', nodePath.join(internalMountpoint, 'app-data'), appsMount])
		this.logger.log(`Virtual filesystem mount complete`)

		return directoryName
	}

	// Unmount a backup
	// We use the directory name here because we may not have the full backup object if we're cleaning up
	async unmountBackup(directoryName: string) {
		this.logger.log(`Unmounting backup ${directoryName}`)

		// Unmount virtual filesystem mounts
		const backupRoot = nodePath.join(this.backupRoot, directoryName)
		const homeMount = nodePath.join(backupRoot, 'Home')
		const appsMount = nodePath.join(backupRoot, 'Apps')
		await execa('umount', [homeMount]).catch((error) =>
			this.logger.error(`Failed to unmount ${homeMount}: ${error.message}`),
		)
		await execa('umount', [appsMount]).catch((error) =>
			this.logger.error(`Failed to unmount ${appsMount}: ${error.message}`),
		)
		await fse.remove(backupRoot).catch((error) => this.logger.error(`Failed to remove ${backupRoot}: ${error.message}`))

		// Unmount internal mount
		const internalMountpoint = nodePath.join(this.internalMountPath, directoryName)
		await execa('umount', [internalMountpoint]).catch((error) =>
			this.logger.error(`Failed to unmount ${internalMountpoint}: ${error.message}`),
		)
		await fse
			.remove(internalMountpoint)
			.catch((error) => this.logger.error(`Failed to remove ${internalMountpoint}: ${error.message}`))

		this.logger.log(`Unmounted backup ${directoryName}`)
		return true
	}

	// Check if we have any backups mounted and unmount them
	async unmountAll(): Promise<void> {
		// List current backups mounted in the virtual filesystem
		const backups = await fse.readdir(this.backupRoot).catch(() => [])

		// Unmount each backup
		await Promise.all(
			backups.map((backup) =>
				this.unmountBackup(backup).catch((error) => this.logger.error(`Failed to unmount ${backup}: ${error.message}`)),
			),
		)

		// We should now have no backups mounted but just incase we somehow have an internal backup mounted
		// without a virtual filesystem mount we check for internal mount directories too
		const internalMounts = await fse.readdir(this.internalMountPath).catch(() => [])
		await Promise.all(
			internalMounts.map((internalMount) =>
				this.unmountBackup(internalMount).catch((error) =>
					this.logger.error(`Failed to unmount ${internalMount}: ${error.message}`),
				),
			),
		)
	}
}
