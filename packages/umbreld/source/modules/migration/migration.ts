import path from 'node:path'

import {type Compose} from 'compose-spec-schema'
import checkDiskSpace from 'check-disk-space'
import drivelist from 'drivelist'
import fse from 'fs-extra'
import {execa} from 'execa'
import {globby} from 'globby'
import yaml from 'js-yaml'
import semver from 'semver'

import type Umbreld from '../../index.js'

import isUmbrelHome from '../is-umbrel-home.js'
import type {ProgressStatus} from '../apps/schema.js'
import {reboot} from '../system/system.js'
import {setSystemStatus} from '../system/routes.js'

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
export async function runPreMigrationChecks(
	currentInstall: string,
	externalUmbrelInstall: string,
	umbreld: Umbreld,
	onlyAllowHome = true,
) {
	// Check we're running on Umbrel Home hardware
	if (onlyAllowHome && !(await isUmbrelHome())) {
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

	// Check version
	let externalVersion = 'unknown'
	if (await fse.exists(`${externalUmbrelInstall}/umbrel.yaml`)) {
		// >=1.0 install
		const data = await fse.readFile(`${externalUmbrelInstall}/umbrel.yaml`, 'utf8')
		const {version} = yaml.load(data) as {version: string}
		externalVersion = version
	} else if (await fse.exists(`${externalUmbrelInstall}/info.json`)) {
		// <=0.5.4 install
		const {version} = await fse.readJson(`${externalUmbrelInstall}/info.json`)
		externalVersion = version
	}

	// Don't allow migrating in data more recent than the current install
	const validVersionRange =
		externalVersion !== 'unknown' && semver.gte(umbreld.version, semver.coerce(externalVersion)!)
	if (!validVersionRange) {
		throw new Error(`Cannot migrate umbrelOS ${externalVersion} data into an umbrelOS ${umbreld.version} install.`)
	}

	// Check enough storage is available
	const temporaryData = `${currentInstall}/.temporary-migration`
	await fse.remove(temporaryData)
	// TODO: check-disk-space typings are broken ('This expression is not callable.')
	const {free} = await (checkDiskSpace as any)(currentInstall)
	const buffer = 1024 * 1024 * 1024 // 1GB
	const required = (await getDirectorySize(externalUmbrelInstall)) + buffer
	if (free < required) {
		throw new Error(`Not enough storage available. ${bytesToGB(free)} GB free, ${bytesToGB(required)} GB required.`)
	}

	return externalUmbrelInstall
}

// Safely migrate data from an external Umbrel install to the current one
export async function migrateData(currentInstall: string, externalUmbrelInstall: string, umbreld: Umbreld) {
	setSystemStatus('migrating')
	updateMigrationStatus({running: false, progress: 0, description: '', error: false})

	const temporaryData = `${currentInstall}/.temporary-migration`
	const finalData = `${currentInstall}/import`

	// Start migration
	updateMigrationStatus({running: true, description: 'Copying data'})

	try {
		// Copy over data dir from previous install to temp dir while preserving permissions
		await fse.remove(temporaryData)
		const rsync = execa('rsync', [
			'--info=progress2',
			'--archive',
			'--delete',
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

		// Move data from temp migration dir to final migration dir
		// The main data dir will be replaced with this dir on the next reboot
		updateMigrationStatus({progress: 92, description: 'Cleaning up'})
		await fse.move(temporaryData, finalData, {overwrite: true})
	} catch (error) {
		console.error(error)
		setSystemStatus('running')
		updateMigrationStatus({running: false, progress: 0, description: '', error: 'Failed to migrate data'})
		return
	}

	updateMigrationStatus({progress: 95, description: 'Rebooting'})
	setSystemStatus('restarting')
	await umbreld.stop()
	await reboot()
}
