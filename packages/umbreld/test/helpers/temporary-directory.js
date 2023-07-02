import {fileURLToPath} from 'node:url'
import path from 'node:path'
import crypto from 'node:crypto'

import fse from 'fs-extra'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_TEST_DATA_DIRECTORY = path.join(__dirname, '../data/')

const temporaryDirectory = (id) => {
	const containingDirectory = path.join(ROOT_TEST_DATA_DIRECTORY, id)

	const createRoot = () => fse.ensureDir(containingDirectory)
	const destroyRoot = () => fse.remove(containingDirectory)

	const create = async () => {
		const directory = path.join(containingDirectory, crypto.randomBytes(16).toString('hex'))
		await fse.ensureDir(directory)

		return directory
	}

	return {createRoot, destroyRoot, create}
}

export default temporaryDirectory
