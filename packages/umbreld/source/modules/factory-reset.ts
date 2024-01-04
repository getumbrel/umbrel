import {ProgressStatus} from './apps/schema'
import {$} from 'execa'

export let factoryResetState: ProgressStatus | null = null

export async function startReset(dataDirectory: string) {
	return demoReset(dataDirectory)
}

async function demoReset(dataDirectory: string) {
	factoryResetState = {
		progress: 0,
		description: 'Resetting device',
		running: true,
		error: false,
	}
	await sleep(1000)

	factoryResetState = {
		progress: 50,
		description: 'Resetting device',
		running: true,
		error: false,
	}

	const maybeFail = Math.random() > 0.5

	if (maybeFail) {
		factoryResetState = {
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

	factoryResetState = {
		progress: 100,
		description: 'Done',
		running: false,
		error: false,
	}

	await sleep(1000)

	factoryResetState = {
		progress: 100,
		description: 'Restarting device...',
		running: false,
		error: false,
	}
	await $`reboot`

	// Reset after 5 seconds
	await sleep(5000)
	factoryResetState = null
}

function sleep(milliseconds: number) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
