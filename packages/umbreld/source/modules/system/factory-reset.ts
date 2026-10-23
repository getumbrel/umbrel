import path from 'node:path'

import {$} from 'execa'
import fse from 'fs-extra'

import type Umbreld from '../../index.ts'
import {reboot} from './system.ts'

const BACKUP_PREFIX = 'umbrel-factory-reset'
const RAID_FACTORY_RESET_PREPARE_HOOK = '/etc/rugix/hooks/state-reset/prepare/10-umbrel.sh'

// Factory reset using Rugix Ctrl's state management. This triggers an immediate reboot.
// We use the --backup flag which renames the old state directory instead of deleting
// it during boot. This makes boot fast (mv is instant) and we clean up the old
// state in the background after umbreld starts.
export async function performReset(umbreld: Umbreld) {
	const isRunningFromRaidData = await umbreld.hardware.raid.isRunningFromRaidData().catch(() => false)
	const dataMountFailed = await umbreld.hardware.raid.checkRaidMountFailure().catch(() => false)

	if (isRunningFromRaidData || dataMountFailed) {
		// Rugix resets the active data mount. When that mount is the RAID dataset,
		// using Rugix would move/reset the previous install and hide the saved boot
		// config needed for onboarding recovery. For RAID-backed data we only reset
		// the boot/internal state: clear the config partition, wipe the boot disk
		// data partition, leave the RAID pool untouched, then reboot to onboarding.
		//
		// The same applies when the data mount failed at boot (recovery mode). Rugix
		// then keeps its state in the RAM-backed /run, so a Rugix state reset would
		// write its reset flag somewhere that is discarded on reboot, and fails
		// outright once /run fills up, after the hook has already wiped the data
		// partition. The hook alone performs the reset in that state.
		await $`${RAID_FACTORY_RESET_PREPARE_HOOK}`
		await reboot()
		return
	}

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
