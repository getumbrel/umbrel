import os from 'node:os'
import path from 'node:path'

import fse from 'fs-extra'

import randomToken from './random-token.js'

function temporaryDirectory({parentDirectory}: {parentDirectory?: string} = {}) {
	const baseDirectory = parentDirectory ?? os.tmpdir()
	const containingDirectory = path.join(baseDirectory, randomToken(128))

	const createRoot = () => fse.ensureDir(containingDirectory)
	const destroyRoot = () => fse.remove(containingDirectory)

	const create = async () => {
		const directory = path.join(containingDirectory, randomToken(128))
		await fse.ensureDir(directory)

		return directory
	}

	return {createRoot, destroyRoot, create}
}

export default temporaryDirectory
