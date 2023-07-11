import fse from 'fs-extra'

const getOrCreateFile = async (filePath, defaultValue) => {
	let contents
	try {
		contents = await fse.readFile(filePath, 'utf8')
		// eslint-disable-next-line unicorn/prefer-optional-catch-binding
	} catch (_) {
		try {
			await fse.ensureFile(filePath)
			await fse.writeFile(filePath, defaultValue, 'utf8')
			contents = await fse.readFile(filePath, 'utf8')
			// eslint-disable-next-line unicorn/prefer-optional-catch-binding
		} catch (_) {
			throw new Error('Unable to create initial file')
		}
	}

	return contents
}

export default getOrCreateFile
