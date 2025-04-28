import nodePath from 'node:path'

import {fuzzy} from 'fast-fuzzy'

import type Umbreld from '../../index.js'

export default class Search {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	matchThreshold = 0.66
	maxResultsDuringSearch = 10_000

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		const {name} = this.constructor
		this.logger = umbreld.logger.createChildLogger(`files:${name.toLocaleLowerCase()}`)
	}

	// No background tasks
	async start() {}
	async stop() {}

	// Search for fuzzy matches against all files in the home directory
	// TODO: We should index the entire filesystem and search against a real database
	// but for now this should work well enough.
	async search(query: string, maxResults = 250) {
		let results: {score: number; systemPath: string}[] = []

		// Helper to order the results by score and return the top results
		const getBestResults = () => results.sort((a, b) => b.score - a.score).slice(0, maxResults)

		// Iterate over all files in the home directory
		for await (const systemPath of this.#umbreld.files.streamContents('/Home')) {
			// Grab the filename
			const filename = nodePath.basename(systemPath)

			// Skip hidden files
			if (this.#umbreld.files.isHidden(filename)) continue

			// Calculate the fuzzy match score of just the filename
			const score = fuzzy(query, filename)

			// Save the result if it's a good match
			if (score > this.matchThreshold) {
				results.push({score, systemPath})

				// Keep memory usage reasonable for searches with lots of matches
				// by clearing out the results array if it gets too big
				if (results.length >= this.maxResultsDuringSearch) results = getBestResults()
			}
		}

		// Get the best results
		results = getBestResults()

		// Get file objects
		let fileReads = await Promise.allSettled(results.map((result) => this.#umbreld.files.status(result.systemPath)))

		// Filter out any files that failed to get status
		const files = fileReads.filter((result) => result.status === 'fulfilled').map((result) => result.value)

		return files
	}
}
