import {$} from 'execa'
import type {ProgressStatus} from './apps/schema.js'
import {sleep} from './utilities/sleep.js'

// TODO: Get install status from a real place
// Ignoring because it's demo code
// eslint-disable-next-line import/no-mutable-exports
export let factoryResetDemoState: ProgressStatus | undefined

export async function startReset(dataDirectory: string) {
	return demoReset(dataDirectory)
}

async function demoReset(dataDirectory: string) {
	factoryResetDemoState = {
		progress: 0,
		description: 'Resetting device',
		running: true,
		error: false,
	}
	await sleep(1000)

	factoryResetDemoState = {
		progress: 50,
		description: 'Resetting device',
		running: true,
		error: false,
	}

	const maybeFail = Math.random() > 0.5

	if (maybeFail) {
		factoryResetDemoState = {
			progress: 50,
			description: 'Resetting device',
			running: false,
			error: 'Could not connect to skynet',
		}
		return
	}

	await sleep(1000)

	await $`rm -rf ${dataDirectory}`
	await $`mkdir -p ${dataDirectory}`

	factoryResetDemoState = {
		progress: 100,
		description: 'Done',
		running: false,
		error: false,
	}

	await sleep(1000)

	factoryResetDemoState = {
		progress: 100,
		description: 'Restarting device...',
		running: false,
		error: false,
	}
	await $`reboot`

	// Reset after 5 seconds
	await sleep(5000)
	factoryResetDemoState = undefined
}
