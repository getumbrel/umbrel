import {execa} from 'execa'
import bytes from 'bytes'

export async function copyWithProgress(
	source: string,
	destination: string,
	onProgress?: (progress: {progress: number; bytesPerSecond: number; secondsRemaining?: number}) => void,
) {
	const rsyncExtraOptions = []

	// Force 100 KB/s for test suite
	if (process.env.UMBRELD_FORCE_100KBS_COPY === 'true') rsyncExtraOptions.push('--bwlimit=100')

	// Start rsync copy
	const rsync = execa('rsync', [
		// Give detailed progress output we can easily parse
		'--info=progress2',
		'--no-human-readable',
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
				onProgress({progress: percent, bytesPerSecond, secondsRemaining})
			}
		})
	}

	// Wait for rsync to finish and throw if rsync exits with a non-zero exit code
	return rsync
}
