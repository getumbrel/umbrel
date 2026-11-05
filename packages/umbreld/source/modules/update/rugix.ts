import readline from 'node:readline'

import {$} from 'execa'

import {floorToTenthPercent} from '../utilities/progress.ts'
import {ReleaseVerificationError} from './release-signing.ts'

// This device's Rugix boot flow, like grub, which picks the update bundle it installs
export async function getBootFlow() {
	const {stdout} = await $({stderr: 'ignore'})`rugix-ctrl system info --json`
	return JSON.parse(stdout).boot?.bootFlow as string | undefined
}

// Install an update bundle, from a URL or a file, to boot from on the next reboot. Rugix checks the
// bundle against its bundle hash as it streams in, before writing anything to the system partitions.
//
// Never sign a bundle with a script payload: Rugix pipes it into bash as it streams in, before it checks
// the payload's hash. A release's own update script is the way to run code before an update.
//
// Never sign an incremental bundle, like one with only a script: Rugix would still point the next boot
// at the inactive system for `--reboot set`, so the device would reboot into whatever system was there.
export async function installUpdateBundle(
	bundle: string,
	verification: {bundleHash: string} | {insecureSkipVerification: true},
	onProgress: (progress: number) => void = () => {},
) {
	const verificationFlags =
		'bundleHash' in verification ? ['--bundle-hash', verification.bundleHash] : ['--insecure-skip-bundle-verification']
	const process = $({all: true})`rugix-ctrl update install --reboot set ${verificationFlags} ${bundle}`

	let previousProgress = 0
	readline.createInterface({input: process.all!}).on('line', (line) => {
		try {
			const event = JSON.parse(line) as {event: string; progress: number}
			if (event.event !== 'UpdateProgress' || typeof event.progress !== 'number') return

			// Only report each 0.1% step to avoid spamming events
			const progress = floorToTenthPercent(event.progress)
			if (progress > previousProgress) {
				previousProgress = progress
				onProgress(progress)
			}
		} catch {
			// Not a progress event
		}
	})

	await process.catch((error) => {
		if (/invalid header hash/i.test(error.all ?? '')) {
			throw new ReleaseVerificationError("The update bundle doesn't match the signed release", {cause: error})
		}
		throw error
	})
}
