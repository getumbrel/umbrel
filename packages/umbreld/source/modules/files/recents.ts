import type Umbreld from '../../index.ts'

import {OWNER_USER_ID} from '../user/constants.ts'

const NON_FILE_TYPES = new Set(['directory', 'symbolic-link', 'socket', 'block-device', 'character-device', 'fifo'])
const MAX_RECENTS = 50

export default class Recents {
	#umbreld: Umbreld

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
	}

	// Get recents
	async get(userId: string = OWNER_USER_ID) {
		if (!this.#umbreld.files.fileIndex.available) throw new Error('File index is unavailable')
		const homeRoot = userId === OWNER_USER_ID ? '/Home' : `/Users/${userId}`
		const candidates = await this.#umbreld.files.fileIndex.recentCandidates(homeRoot, MAX_RECENTS, [
			this.#umbreld.backups.backupDirectoryName,
		])
		const recents = await Promise.allSettled(
			candidates.map(async ({virtualPath}) => {
				const systemPath = await this.#umbreld.files.virtualToSystemPath(virtualPath, userId)
				return this.#umbreld.files.status(systemPath, userId)
			}),
		)

		return recents
			.filter(
				(result): result is PromiseFulfilledResult<Awaited<ReturnType<Umbreld['files']['status']>>> =>
					result.status === 'fulfilled' && !NON_FILE_TYPES.has(result.value.type),
			)
			.map(({value}) => value)
	}
}
