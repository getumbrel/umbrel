import {expect, beforeEach, afterEach, test} from 'vitest'
import yaml from 'js-yaml'
import fse from 'fs-extra'

import createTestUmbreld from '../test-utilities/create-test-umbreld.js'

async function readYaml(path: string) {
	return yaml.load(await fse.readFile(path, 'utf8'))
}

// Fresh non-running umbreld instance for each test
let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>
beforeEach(async () => (umbreld = await createTestUmbreld({autoStart: false})))
afterEach(() => umbreld.cleanup())

test('legacy downloads directory is migrated', async () => {
	const dataDirectory = umbreld.instance.dataDirectory
	const legacyDownloadsDirectory = `${dataDirectory}/data/storage/downloads`
	const legacyDownloadsFile = `${legacyDownloadsDirectory}/bitcoin.pdf`
	const newDownloadsDirectory = `${dataDirectory}/home/Downloads`
	const newDownloadsFile = `${newDownloadsDirectory}/bitcoin.pdf`

	// Create legacy downloads data
	await fse.ensureDir(legacyDownloadsDirectory)
	await fse.writeFile(legacyDownloadsFile, 'Bitcoin: A Peer-to-Peer Electronic Cash System')

	// Ensure files exist at legacy path and not new path
	await expect(fse.pathExists(legacyDownloadsDirectory)).resolves.toBe(true)
	await expect(fse.pathExists(legacyDownloadsFile)).resolves.toBe(true)
	await expect(fse.pathExists(newDownloadsDirectory)).resolves.toBe(false)
	await expect(fse.pathExists(newDownloadsFile)).resolves.toBe(false)

	// Start umbreld
	await umbreld.instance.start()

	// Ensure files are migrated to new path
	await expect(fse.pathExists(legacyDownloadsDirectory)).resolves.toBe(false)
	await expect(fse.pathExists(legacyDownloadsFile)).resolves.toBe(false)
	await expect(fse.pathExists(newDownloadsDirectory)).resolves.toBe(true)
	await expect(fse.pathExists(newDownloadsFile)).resolves.toBe(true)
})

test('Back That Mac Up app port is migrated from 445 to 1445', async () => {
	const {dataDirectory} = umbreld.instance
	const appComposeFile = `${dataDirectory}/app-data/back-that-mac-up/docker-compose.yml`

	// Create app directory structure
	await fse.ensureFile(appComposeFile)

	// Create docker-compose.yml with old port mapping
	const oldComposeContent = {
		version: '3.7',
		services: {
			timemachine: {
				ports: ['445:445'],
				random: 'property',
			},
			random: 'property',
		},
	}
	await fse.writeFile(appComposeFile, yaml.dump(oldComposeContent))

	// Mark app as installed in store
	await umbreld.instance.store.set('apps', ['back-that-mac-up'])

	// Check the docker-compose.yml has the expected value
	await expect(readYaml(appComposeFile)).resolves.toMatchObject(oldComposeContent)

	// Start umbreld
	await umbreld.instance.start()

	// Check if the docker-compose.yml has been updated with the new port mapping
	// and all other values are the same
	await expect(readYaml(appComposeFile)).resolves.toMatchObject({
		version: '3.7',
		services: {
			timemachine: {
				ports: ['1445:445'],
				random: 'property',
			},
			random: 'property',
		},
	})

	// Verify notification was created
	const notifications = await umbreld.instance.notifications.get()
	expect(notifications.includes('migrated-back-that-mac-up')).toBe(true)
})

test('first run writes version without adding a notification', async () => {
	// Ensure no version is set on first run
	const versionBefore = await umbreld.instance.store.get('version')
	expect(versionBefore).toBeUndefined()

	// Start umbreld
	await umbreld.instance.start()

	// Verify version is written to store
	const versionAfter = await umbreld.instance.store.get('version')
	expect(versionAfter).toBe(umbreld.instance.version)

	// Verify no notification was created (first run)
	const notifications = await umbreld.instance.notifications.get()
	expect(notifications.includes('umbrelos-updated')).toBe(false)
})

test('OS update adds a notification', async () => {
	const oldVersion = '1.4.2'

	// Set an old version in the store
	await umbreld.instance.store.set('version', oldVersion)

	// Verify old version is set
	const versionBefore = await umbreld.instance.store.get('version')
	expect(versionBefore).toBe(oldVersion)

	// Start umbreld
	await umbreld.instance.start()

	// Verify version is updated to current version
	const versionAfter = await umbreld.instance.store.get('version')
	expect(versionAfter).toBe(umbreld.instance.version)
	expect(versionAfter).not.toBe(oldVersion)

	// Verify notification was created
	const notifications = await umbreld.instance.notifications.get()
	expect(notifications.includes('umbrelos-updated')).toBe(true)
})

test('restarting with same version does not add a notification', async () => {
	const currentVersion = umbreld.instance.version

	// Start umbreld
	await umbreld.instance.start()

	// Verify version is written after first start
	const versionAfterFirstStart = await umbreld.instance.store.get('version')
	expect(versionAfterFirstStart).toBe(currentVersion)

	// Stop umbreld
	await umbreld.instance.stop()

	// Restart umbreld with the same version
	await umbreld.instance.start()

	// Verify version remains the same
	const versionAfterRestart = await umbreld.instance.store.get('version')
	expect(versionAfterRestart).toBe(currentVersion)

	// Verify no notification was created
	const notifications = await umbreld.instance.notifications.get()
	expect(notifications.includes('umbrelos-updated')).toBe(false)
})
