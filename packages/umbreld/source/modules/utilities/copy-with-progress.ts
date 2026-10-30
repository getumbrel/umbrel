import {execa} from 'execa'
import bytes from 'bytes'

import {floorToTenthPercent} from './progress.ts'

// rsync only prints whole percents, which on a large copy can mean minutes between
// updates. It calculates them as floor(100 * bytesCopied / totalBytes) against a fixed
// total, so each sample bounds what that total can be. Within a percent or so the bounds
// pin it down and we can report progress in 0.1% steps, clamped to rsync's own whole
// percent so we never disagree with it.
export function createRsyncProgressRefiner() {
	let minTotalBytes = 0
	let maxTotalBytes = Infinity
	let previousProgress = 0

	return (bytesCopied: number, percent: number) => {
		if (!Number.isFinite(bytesCopied) || !Number.isFinite(percent) || percent >= 100) return percent

		minTotalBytes = Math.max(minTotalBytes, (bytesCopied * 100) / (percent + 1))
		if (percent > 0) maxTotalBytes = Math.min(maxTotalBytes, (bytesCopied * 100) / percent)

		// Fall back to rsync's percent until we have an estimate, or if the samples ever
		// contradict each other
		if (!Number.isFinite(maxTotalBytes) || minTotalBytes > maxTotalBytes) return percent

		// The estimate tightens as samples arrive, so don't let that nudge progress backwards
		const totalBytes = (minTotalBytes + maxTotalBytes) / 2
		const progress = floorToTenthPercent((bytesCopied / totalBytes) * 100)
		previousProgress = Math.min(Math.max(progress, percent, previousProgress), (percent * 10 + 9) / 10)
		return previousProgress
	}
}

export async function copyWithProgress(
	source: string,
	destination: string,
	onProgress?: (progress: {progress: number; bytesPerSecond: number; secondsRemaining?: number}) => void,
	{durable = false}: {durable?: boolean} = {},
) {
	const rsyncExtraOptions = []

	// Force 100 KB/s for test suite
	if (process.env.UMBRELD_FORCE_100KBS_COPY === 'true') rsyncExtraOptions.push('--bwlimit=100')
	if (durable) rsyncExtraOptions.push('--fsync')

	// Start rsync copy
	const rsync = execa('rsync', [
		// Give detailed progress output we can easily parse.
		// Build the entire file list before starting the transfer instead of incrementally
		// for more accurate progress reporting.
		'--info=progress2',
		'--no-human-readable',
		'--no-inc-recursive',
		// Archive mode, recursive and preserve permissions etc
		'--archive',
		// Inplace mode, update files in place instead of temporary files with a random suffix
		// which confuses recents tracking.
		'--inplace',
		// Drop in extra options
		...rsyncExtraOptions,
		// Absolute source and target
		source,
		destination,
	])

	// Process output from rsync to handle copy progress
	if (onProgress) {
		const refineProgress = createRsyncProgressRefiner()
		rsync.stdout!.on('data', (chunk) => {
			// Grab progress update from --info=progress2 output
			const output = chunk.toString()

			// Check if we have a % update
			const progressUpdate = output.match(/.* (\d*)% .*/)
			if (progressUpdate) {
				// Parse values from rsync output
				const values = output.trim().split(/\s+/)
				const bytesCopied = Number(values[0])
				const percent = Number(values[1].replace('%', ''))
				const bytesPerSecond = bytes.parse(values[2].replace('/s', '')) ?? 0

				// Calculate time remaining
				const totalBytes = Math.round((bytesCopied / percent) * 100)
				let secondsRemaining: number | undefined = Math.round((totalBytes - bytesCopied) / bytesPerSecond)
				if (secondsRemaining === Infinity) secondsRemaining = undefined

				// Emit the progress event
				onProgress({progress: refineProgress(bytesCopied, percent), bytesPerSecond, secondsRemaining})
			}
		})
	}

	// Wait for rsync to finish and throw if rsync exits with a non-zero exit code
	return rsync
}
