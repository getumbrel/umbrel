import {setTimeout} from 'node:timers/promises'
import {$} from 'execa'

// TODO: import packageJson from '../../package.json' assert {type: 'json'}
const packageJson = (await import('../../../package.json', {assert: {type: 'json'}})).default

import type {ProgressStatus} from '../apps/schema.js'
import type Umbreld from '../../index.js'
import {UMBREL_APP_STORE_REPO} from '../../constants.js'
import {performUpdate, getUpdateStatus} from './update.js'

type ResetStatus = ProgressStatus

let resetStatus: ResetStatus
resetResetStatus()

function resetResetStatus() {
	resetStatus = {
		running: false,
		progress: 0,
		description: '',
		error: false,
	}
}

function setResetStatus(properties: Partial<ResetStatus>) {
	resetStatus = {...resetStatus, ...properties}
}

export function getResetStatus() {
	return resetStatus
}

export async function performReset(umbreld: Umbreld) {
	const {dataDirectory} = umbreld

	// The following must try hard to even complete on a heavily broken system.
	// For instance, the user might be unable to log in, networking might be
	// unavailable, and even the Umbreld codebase might have been altered. As a
	// precaution, wrap anything that could fail in a try/catch or similar.

	function failWithError(error: string) {
		try {
			umbreld.logger.error(`Factory reset failed at ${resetStatus.progress}%`, error)
		} catch {}
		resetResetStatus()
		setResetStatus({error})
		return false
	}

	// Attempt to stop all apps gracefully, 5..15%. Possible that the promises
	// never resolve or reject, so let them race with a timeout.
	setResetStatus({running: true, progress: 5, description: 'Resetting...', error: false})
	try {
		await Promise.race([umbreld.appStore.stop(), setTimeout(60000)])
	} catch {}
	try {
		await Promise.race([umbreld.apps.stop(), setTimeout(60000)])
	} catch {}

	// Kill anything related to Docker to be sure, 15..20%.
	setResetStatus({progress: 15})
	try {
		await Promise.race([$`systemctl stop docker docker.socket`, setTimeout(60000)])
	} catch {}
	try {
		// Make sure that Docker is indeed down, so there are no open file handles
		// into Docker's data directory that would prevent us from wiping app data.
		await $`pkill -9 docker`
	} catch {
		// exits with status 1 if there are no matching processes anymore
	}

	// Wipe the Docker data directory on the data partition, 20..35%. This is
	// a bind-mounted directory, so cannot be destroyed but must be emptied.
	setResetStatus({progress: 20})
	try {
		const dockerDataDirectory = '/var/lib/docker'
		await $`mkdir -p ${dockerDataDirectory}` // just in case
		await $`find ${dockerDataDirectory} -mindepth 1 -delete` // empty directory
		await $`chmod 710 ${dockerDataDirectory}` // restore expected
	} catch (err) {
		return failWithError(`Failed to wipe app data: ${(err as any).message}`)
	}

	// Remember the current user for later in case it's still functional
	let userExists = false
	let userName: string
	let userHashedPassword: string
	try {
		userName = await umbreld.store.get('user.name')
		userHashedPassword = await umbreld.store.get('user.hashedPassword')
		if (userName.length > 0 && userHashedPassword.length > 0) {
			userExists = true
		}
	} catch {}

	// Wipe the user data directory on the data partition, 35..50%. This is a
	// bind-mounted directory, so cannot be destroyed but must be emptied.
	setResetStatus({progress: 35})

	// Stop critical services with mounts otherwise the below step will recursively nuke the data
	// on all mounted network and usb devices. This is error prone and can fail. We should move over
	// to atomic factory reset once Rugix migration is complete to make this safe.
	try {
		await umbreld.backups.stop()
		await umbreld.files.externalStorage.stop()
		await umbreld.files.networkStorage.stop()
	} catch (error) {
		return failWithError(`Failed to stop umbreld services: ${(error as any).message}`)
	}

	try {
		await $`mkdir -p ${dataDirectory}` // just in case
		// For extra precaution we skip external and network mount dirs here
		// to make sure we definitely don't nuke them if the above step fails.
		await $`find ${dataDirectory} -mindepth 1 -not -path ${umbreld.files.getBaseDirectory('/External')} -not -path ${umbreld.files.getBaseDirectory('/External')}/* -not -path ${umbreld.files.getBaseDirectory('/Network')} -not -path ${umbreld.files.getBaseDirectory('/Network')}/* -delete` // empty directory
		await $`chmod 755 ${dataDirectory}` // restore expected
	} catch (err) {
		return failWithError(`Failed to wipe user data: ${(err as any).message}`)
	} finally {
		// We are doing an OTA update next. Make sure that a minimally functioning
		// system remains in case the update fails. Also attempt this when user data
		// could not be fully wiped. Keep the user so the user sees a login prompt,
		// not an onboarding prompt that could be mistaken for a successful reset.
		try {
			if (userExists) {
				await umbreld.store.set('user.name', userName!)
				await umbreld.store.set('user.hashedPassword', userHashedPassword!)
			}
			umbreld.version = packageJson.version
			if (umbreld.appStore) {
				umbreld.appStore.defaultAppStoreRepo = UMBREL_APP_STORE_REPO
			}
			await umbreld.store.set('version', umbreld.version)
			await umbreld.store.set('apps', [])
			await umbreld.store.set('appRepositories', [UMBREL_APP_STORE_REPO])
		} catch {}
	}

	// Perform an OTA update, 50..90%. This step is the most likely to fail if the
	// system is broken, because networking might be down or the system has been
	// altered to a point where the update mechanism became non-functional. In
	// these cases, only an USB-restore can help.
	const updateStartPercentage = 50
	const updateEndPercentage = 95
	setResetStatus({progress: updateStartPercentage})
	let updating = true
	const relayUpdateProgress = async () => {
		while (updating) {
			try {
				const updatePercentage = getUpdateStatus().progress
				const combinedPercentage =
					updateStartPercentage + Math.floor((updatePercentage / 100) * (updateEndPercentage - updateStartPercentage))
				setResetStatus({progress: combinedPercentage})
				await setTimeout(1000)
			} catch {
				break
			}
		}
	}
	try {
		relayUpdateProgress()
		const success = await performUpdate(umbreld)
		if (!success) {
			const updateError = getUpdateStatus().error
			if (typeof updateError === 'string') {
				return failWithError(`Update failed: ${updateError}`)
			} else {
				return failWithError(`Update failed`)
			}
		}
	} catch (error) {
		return failWithError(`Update failed: ${(error as any).message}`)
	} finally {
		updating = false
	}

	// Delete the config file and reboot, 95..100%.
	setResetStatus({progress: 95})
	try {
		await $`rm -f ${dataDirectory}/umbrel.yaml`
	} catch {}

	setResetStatus({running: false, progress: 100, description: 'Restarting...'})

	return true
}
