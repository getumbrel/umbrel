import path from 'node:path'
import {fileURLToPath} from 'node:url'

import fse from 'fs-extra'

// Find the package root by walking up from the current file looking for package.json
async function findPackageDirectory(startPath: string): Promise<string> {
	let currentPath = startPath
	while (currentPath !== path.parse(currentPath).root) {
		if (await fse.pathExists(path.join(currentPath, 'package.json'))) {
			return currentPath
		}
		currentPath = path.dirname(currentPath)
	}
	throw new Error('Could not find package.json')
}

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const packageDirectory = await findPackageDirectory(currentDirectory)

export default packageDirectory
