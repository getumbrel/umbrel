import path from 'node:path'

import {$} from 'execa'
import fse from 'fs-extra'

import type Umbreld from '../../index.js'

const BACKUP_PREFIX = 'umbrel-factory-reset'

// Factory reset using Rugix Ctrl's state management. This triggers an immediate reboot.
// We use the --backup flag which renames the old state directory instead of deleting
// it during boot. This makes boot fast (mv is instant) and we clean up the old
// state in the background after umbreld starts.
export async function performReset() {
	const timestamp = Math.floor(Date.now() / 1000)
	await $`rugix-ctrl state reset --backup --backup-name ${BACKUP_PREFIX}-${timestamp}`
}

// Clean up state backups from factory resets
export async function cleanupFactoryResetBackups(umbreld: Umbreld) {
	const stateDir = '/run/rugix/mounts/data/state'

	try {
		const entries = await fse.readdir(stateDir)

		// Loop through all backups in case multiple exist
		for (const entry of entries) {
			if (entry.startsWith(BACKUP_PREFIX)) {
				const backupPath = path.join(stateDir, entry)
				umbreld.logger.log(`Cleaning up factory reset backup: ${entry}`)
				await fse.remove(backupPath).catch((error) => umbreld.logger.error(`Failed to remove backup ${entry}`, error))
			}
		}
	} catch (error) {
		umbreld.logger.error('Failed to cleanup factory reset backups', error)
	}
}
