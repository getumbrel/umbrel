import {setTimeout} from 'node:timers/promises'
import {performance} from 'node:perf_hooks'

import ms from 'ms'

export default function runEvery(interval: string, job: () => Promise<void>, options?: {runInstantly?: boolean}) {
	options = {
		runInstantly: true,
		...options,
	}
	const intervalMs = ms(interval)
	let running = true

	// Define async loop function
	async function start() {
		// If we aren't running the job instantly
		// wait for the first interval
		if (!options!.runInstantly) {
			await setTimeout(intervalMs)
		}

		// Start loop
		// eslint-disable-next-line no-unmodified-loop-condition
		while (running) {
			// Time and execute the job
			const start = performance.now()
			await job()
			const end = performance.now()

			// Delay the next job by the interval minus the execution time
			const executionTime = end - start
			const delay = Math.max(intervalMs - executionTime, 0)
			await setTimeout(delay)
		}
	}

	// Define a function to stop the loop
	function stop() {
		running = false
	}

	// Kick off the loop
	start()

	// Return the stop function
	return stop
}
