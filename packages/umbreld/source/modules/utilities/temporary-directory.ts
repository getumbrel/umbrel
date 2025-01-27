import os from 'node:os'
import path from 'node:path'

import fse from 'fs-extra'

import randomToken from './random-token.js'

function temporaryDirectory(baseDirectory = os.tmpdir()) {
	let directory: string | null = null

	const create = async () => {
		if (!directory) {
			// Make sure that the base directory exists so we can do an atomic mkdir
			await fse.ensureDir(baseDirectory)
			let directoryToCreate: string
			let remainingAttempts = 3
			do {
				directoryToCreate = path.join(baseDirectory, await randomToken(128))
				try {
					await fse.mkdir(directoryToCreate)
					break
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
						throw error
					}
				}
				if (--remainingAttempts < 1) {
					throw new Error('Gave up searching for a usable directory')
				}
			} while (true)
			if (directory /* was concurrently created meanwhile */) {
				await fse.remove(directoryToCreate)
			} else {
				directory = directoryToCreate
			}
		}
		return directory
	}

	const destroy = async () => {
		if (directory) {
			const directoryToRemove = directory
			directory = null
			await fse.remove(directoryToRemove)
		}
	}

	const createInner = async () => {
		const directory = await create()
		const innerDirectory = path.join(directory, await randomToken(128))
		await fse.ensureDir(innerDirectory)
		return innerDirectory
	}

	return {create, destroy, createInner}
}

export default temporaryDirectory
