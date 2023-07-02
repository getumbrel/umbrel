import path from 'node:path'
import {fileURLToPath} from 'node:url'

import {readPackageUp} from 'read-pkg-up'

const getPackageJson = async (importMeta) => {
	const {packageJson} = await readPackageUp({
		cwd: path.dirname(fileURLToPath(importMeta.url)),
		normalize: false,
	})

	return packageJson
}

export default getPackageJson
