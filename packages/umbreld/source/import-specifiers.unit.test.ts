import fs from 'node:fs/promises'
import path from 'node:path'

import ts from 'typescript'
import {expect, test} from 'vitest'

const packageDirectory = path.join(import.meta.dirname, '..')

// umbreld runs its sources with Node's built-in type stripping, which resolves
// import specifiers to real files. A relative `./module.js` import of a `.ts` file
// still passes the typecheck, because nodenext resolution maps it to the `.ts`
// file, but it fails with ERR_MODULE_NOT_FOUND when Node loads it.
test('relative imports point at files that exist', async () => {
	const missingImports: string[] = []

	for (const directory of ['source', 'scripts']) {
		const entries = await fs.readdir(path.join(packageDirectory, directory), {recursive: true})
		for (const entry of entries) {
			if (!/\.[cm]?[jt]s$/.test(entry)) continue
			const file = path.join(packageDirectory, directory, entry)
			const contents = await fs.readFile(file, 'utf8')
			const {importedFiles} = ts.preProcessFile(contents, true, true)
			for (const {fileName: specifier} of importedFiles) {
				if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue
				const target = path.resolve(path.dirname(file), specifier)
				const exists = await fs
					.access(target)
					.then(() => true)
					.catch(() => false)
				if (!exists) missingImports.push(`${path.relative(packageDirectory, file)}: '${specifier}'`)
			}
		}
	}

	expect(missingImports, 'Import TypeScript files with their .ts extension').toStrictEqual([])
})
