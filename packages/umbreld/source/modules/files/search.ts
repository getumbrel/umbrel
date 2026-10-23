import type Umbreld from '../../index.ts'
import {OWNER_USER_ID} from '../user/constants.ts'

export default class Search {
	#umbreld: Umbreld

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
	}

	// No background tasks
	async start() {}
	async stop() {}

	async search(query: string, maxResults = 250, userId: string = OWNER_USER_ID) {
		const homeRoot = userId === OWNER_USER_ID ? '/Home' : `/Users/${userId}`
		if (!this.#umbreld.files.fileIndex.available) throw new Error('File index is unavailable')
		return this.#searchIndex(query, maxResults, homeRoot, userId)
	}

	async #searchIndex(query: string, maxResults: number, homeRoot: string, userId: string) {
		const results = await this.#umbreld.files.fileIndex.searchCandidates(homeRoot, query, maxResults)
		// TODO: Broad searches are currently slow because every result is revalidated
		// with filesystem path and status lookups. In a follow-up, make the index
		// guarantee that its results are safe to return without these per-result reads.
		const fileReads = await Promise.allSettled(
			results.map(async ({virtualPath}) => {
				// The database is derived state, never an authorization oracle. Resolve
				// every result through the live Files boundary before reading status.
				const systemPath = await this.#umbreld.files.virtualToSystemPath(virtualPath, userId)
				return this.#umbreld.files.status(systemPath, userId)
			}),
		)
		return fileReads.filter((result) => result.status === 'fulfilled').map((result) => result.value)
	}
}
