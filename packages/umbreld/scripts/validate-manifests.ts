import fs from 'fs/promises'
import path from 'path'
import yaml from 'js-yaml'
import {validateManifest} from '../source/modules/apps/schema.js'

// TODO: Integrate into umbrel-apps CI?

const rootFolder = process.env.UMBREL_ROOT ?? '/home/umbrel/umbrel'
const appStoresFolder = path.join(rootFolder, 'app-stores')

let total = 0
let valid = 0

const appStoreFolders = await fs.readdir(appStoresFolder)
for (const relativeAppStoreFolder of appStoreFolders) {
	if (relativeAppStoreFolder.startsWith('.')) continue

	const appStoreFolder = path.join(appStoresFolder, relativeAppStoreFolder)
	const stats = await fs.stat(appStoreFolder)
	if (!stats.isDirectory()) continue

	const appFolders = await fs.readdir(appStoreFolder)
	for (const relativeAppFolder of appFolders) {
		if (relativeAppFolder.startsWith('.')) continue

		const appFolder = path.join(appStoreFolder, relativeAppFolder)
		const stats = await fs.stat(appFolder)
		if (!stats.isDirectory()) continue

		const manifestFile = path.join(appFolder, 'umbrel-app.yml')
		try {
			const rawManifest = await fs.readFile(manifestFile, 'utf8')
			const parsedManifest = yaml.load(rawManifest)
			validateManifest(parsedManifest)
			valid++
		} catch (error) {
			console.error(`Error in ${manifestFile}: ${(error as Error).message}`)
		}
		total++
	}
}

console.log(`${valid} of ${total} manifests are valid`)
