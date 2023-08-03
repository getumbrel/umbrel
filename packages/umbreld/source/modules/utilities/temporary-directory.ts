import os from 'node:os'
import path from 'node:path'

import fse from 'fs-extra'

import randomToken from './random-token.js'

function temporaryDirectory() {
	const containingDirectory = path.join(os.tmpdir(), randomToken(128))

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
