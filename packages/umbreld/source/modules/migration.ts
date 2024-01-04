import path from 'node:path'

import {type Compose} from 'compose-spec-schema'
import checkDiskSpace from 'check-disk-space'
import drivelist from 'drivelist'
import fse from 'fs-extra'
import {execa} from 'execa'
import pRetry from 'p-retry'
import {globby} from 'globby'
import yaml from 'js-yaml'

import isUmbrelHome from './is-umbrel-home.js'
import type {ProgressStatus} from './apps/schema.js'

let migrationStatus: ProgressStatus = {
	running: false,
	progress: 0,
	description: '',
	error: false,
}

// Update the migrationStatus global
function updateMigrationStatus(properties: Partial<ProgressStatus>) {
	migrationStatus = {...migrationStatus, ...properties}
	console.log(migrationStatus)
}

// Get the migrationStatus global
export function getMigrationStatus() {
	return migrationStatus
}

// Convert bytes integer to GB float
function bytesToGB(bytes: number) {
	return (bytes / 1024 / 1024 / 1024).toFixed(1)
}

// Get a directory size in bytes
async function getDirectorySize(directoryPath: string) {
	let totalSize = 0
	const files = await fse.readdir(directoryPath, {withFileTypes: true})

	// Traverse entire directory structure and tally up the size of all files
	for (const file of files) {
		if (file.isSymbolicLink()) {
			const lstats = await fse.lstat(path.join(directoryPath, file.name))
			totalSize += lstats.size
		} else if (file.isFile()) {
			const stats = await fse.stat(path.join(directoryPath, file.name))
			totalSize += stats.size
		} else if (file.isDirectory()) {
			totalSize += await getDirectorySize(path.join(directoryPath, file.name))
		}
	}

	return totalSize
}

// Enumerate attached USB devices and return a path to the first one that is an Umbrel install
// Returns false if no Umbrel install is found
export async function findExternalUmbrelInstall() {
	try {
		// Get all external drives
		const drives = await drivelist.list()
		const externalDrives = drives.filter((drive) => drive.isUSB && !drive.isSystem)

		for (const drive of externalDrives) {
			// If the drive is not mounted, mount it
			if (drive.mountpoints.length === 0) {
				const device = `${drive.device}1` // Mount the first partition
				const mountPoint = path.join('/mnt', path.basename(device))

				try {
					await fse.ensureDir(mountPoint)
					await execa('mount', ['--read-only', device, mountPoint])
					drive.mountpoints.push({path: mountPoint} as drivelist.Mountpoint)
				} catch (error) {
					// If there's an error don't bail, keep trying the rest of the drives
					console.error(`Error mounting drive: ${error}`)
					continue
				}
			}

			// Check if the drive is an Umbrel install
			for (const mountpoint of drive.mountpoints) {
				const umbrelDotFile = path.join(mountpoint.path, 'umbrel/.umbrel')

				// This is an Umbrel install
				if (await fse.pathExists(umbrelDotFile)) {
					return path.dirname(umbrelDotFile)
				}
			}
		}
		// Swallow any errors and just return false
	} catch (error) {
		console.error(`Error finding external Umbrel install: ${error}`)
	}

	return false
}

// Best effort cleanup operation to unmount all external USB devices
export async function unmountExternalDrives() {
	try {
		// Get all external drives
		const drives = await drivelist.list()
		const externalDrives = drives.filter((drive) => drive.isUSB && !drive.isSystem)

		for (const drive of externalDrives) {
			for (const mountpoint of drive.mountpoints) {
				try {
					await execa('umount', [mountpoint.path])
				} catch (error) {
					// If there's an error don't bail, keep unmounting the rest of the drives
					console.error(`Error unmounting drive: ${error}`)
					continue
				}
			}
		}
	} catch {
		// Silently fail, this is just a best effort cleanup operation, we never want
		// it to kill the migration process.
	}
}

// Run a series of checks and throw a descriptive error if any of them fail
export async function runPreMigrationChecks(currentInstall: string, externalUmbrelInstall: string) {
	// Check we're running on Umbrel Home hardware
	if (!(await isUmbrelHome())) {
		throw new Error('This feature is only supported on Umbrel Home hardware')
	}

	// Check migration isn't already running
	if (migrationStatus.running) {
		throw new Error('Migration is already running')
	}

	// Check we have an Umbrel install on an external SSD
	if (!externalUmbrelInstall) {
		throw new Error('No drive found with an umbrelOS install')
	}

	// Check versions match
	const {version: previousVersion} = await fse.readJson(`${externalUmbrelInstall}/info.json`)
	const {version: currentVersion} = await fse.readJson(`${currentInstall}/info.json`)
	// TODO: We might want to loosen this check to a wider range in future updates.
	if (previousVersion !== currentVersion) {
		throw new Error(
			`umbrelOS versions do not match. Cannot migrate umbrelOS ${previousVersion} data into an umbrelOS ${currentVersion} install`,
		)
	}

	// Check enough storage is available
	const temporaryData = `${currentInstall}/.temporary-migration`
	await fse.remove(temporaryData)
	const {free} = await checkDiskSpace(currentInstall)
	const buffer = 1024 * 1024 * 1024 // 1GB
	const required = (await getDirectorySize(externalUmbrelInstall)) + buffer
	if (free < required) {
		throw new Error(`Not enough storage available. ${bytesToGB(free)} GB free, ${bytesToGB(required)} GB required.`)
	}

	return externalUmbrelInstall
}

// Safely migrate data from an external Umbrel install to the current one
export async function migrateData(currentInstall: string, externalUmbrelInstall: string) {
	updateMigrationStatus({running: false, progress: 0, description: '', error: false})

	const temporaryData = `${currentInstall}/.temporary-migration`
	const statePaths = ['.env', 'db', 'tor', 'repos', 'app-data', 'data']

	// Start migration
	updateMigrationStatus({running: true, description: 'Copying data'})

	try {
		// Copy over state from previous install to temp dir while preserving permissions
		const includes = [
			...statePaths.map((path) => `--include=${path}`),
			...statePaths.map((path) => `--include=${path}/***`),
		]
		await fse.remove(temporaryData)
		const rsync = execa('rsync', [
			'--info=progress2',
			'--archive',
			'--delete',
			...includes,
			`--exclude=*`,
			`${externalUmbrelInstall}/`,
			temporaryData,
		])

		// Update migration status with rsync progress
		rsync.stdout!.on('data', (chunk) => {
			const progressUpdate = chunk.toString().match(/.* (\d*)% .*/)
			if (progressUpdate) {
				const percent = Number.parseInt(progressUpdate[1], 10)
				// Show file copy percentage as 60% of total migration progress
				// @ts-expect-error Technically this should probably be Math.round
				// to avoid the type error but it works fine and I don't want to
				// update this and retest so ignore for now.
				const progress = Number.parseInt(0.6 * percent, 10)
				if (progress > migrationStatus.progress) updateMigrationStatus({progress})
			}
		})

		// Wait for rsync to finish
		await rsync

		// Pull app images
		try {
			let progress = migrationStatus.progress
			updateMigrationStatus({description: 'Downloading apps'})
			const files = await globby(`${temporaryData}/app-data/*/docker-compose.yml`)
			const pulls = []
			const dockerPull = async (image: string) => {
				await execa('docker', ['pull', image])
				// Show docker pull progress as (60%-90%) of total migration progress
				progress += 30 / pulls.length
				// @ts-expect-error Ignore type error with parseInt expecting string (as above)
				updateMigrationStatus({progress: Number.parseInt(progress, 10)})
			}

			for (const file of files) {
				const data = await fse.readFile(file, 'utf8')
				const compose = yaml.load(data) as Compose

				for (const {image} of Object.values(compose.services!)) {
					if (image) {
						pulls.push(dockerPull(image))
					}
				}
			}

			await Promise.allSettled(pulls)
		} catch (error) {
			// We don't care about handling this, everything will be pulled in the start script.
			// This just gives us nicer progress reporting.
			console.error('Error processing docker-compose files:', error)
		}

		// Stop apps / umbrel
		updateMigrationStatus({progress: 90, description: 'Stopping Umbrel'})
		await execa('./scripts/stop', ['--no-stop-server'], {cwd: currentInstall})

		// Move data from temp dir to current install
		// This is the only dangerous action in the migration process, before this action the Umbrel state is still intact
		// After this action the Umbrel state should be fully migrated. We previously copied all the data to the same filesystem
		// as the Umbrel install, so we can do this risky step with a quick rename operation (fse.move) which just updates a
		// pointer and doesn't actually move any data. This means this operation is very fast, reducing the chance of leaving the install
		// in a broken state.
		updateMigrationStatus({progress: 92, description: 'Linking new data'})
		for (const path of statePaths) {
			const temporaryPath = `${temporaryData}/${path}`
			if (await fse.pathExists(temporaryPath)) {
				await fse.move(temporaryPath, `${currentInstall}/${path}`, {overwrite: true})
			}
		}
	} catch (error) {
		console.error(error)
		updateMigrationStatus({error: 'Failed to migrate data'})
	}

	// Clean up temp dir
	try {
		updateMigrationStatus({progress: 93, description: 'Cleaning up'})
		await fse.remove(temporaryData)
	} catch {}

	// Start apps / umbrel
	updateMigrationStatus({progress: 95, description: 'Starting Umbrel'})
	await pRetry(() => execa('./scripts/start', ['--no-start-server'], {cwd: currentInstall}), {
		retries: 5,
	})

	updateMigrationStatus({running: false, progress: 100, description: ''})

	// Cleanup mounted drives
	await unmountExternalDrives()
}
