import nodePath from 'node:path'

import {afterEach, beforeEach, describe, expect, test} from 'vitest'
import fse from 'fs-extra'

import createTestUmbreld from '../test-utilities/create-test-umbreld.ts'
import {parseThumbnailFilename, thumbnailSystemPath} from './thumbnail-support.ts'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>

beforeEach(async () => {
	umbreld = await createTestUmbreld()
	await umbreld.registerAndLogin()
})

afterEach(async () => {
	await umbreld.cleanup()
})

async function copyFixtureFile(destinationDirectory: string, customName = 'master-lossless-image.png') {
	await fse.ensureDir(destinationDirectory)
	const fixture = nodePath.resolve(__dirname, 'fixtures', 'thumbnails', 'master-lossless-image.png')
	const destination = nodePath.join(destinationDirectory, customName)
	await fse.copy(fixture, destination)
	return destination
}

describe('content-addressed thumbnail generation', () => {
	test.each([
		['/Home/thumbnail-missing-directory-test', 'home/thumbnail-missing-directory-test', 'content'],
		['/External/Test Drive', 'external/Test Drive', 'transient'],
		['/Backups/Test Backup', 'backups/Test Backup', 'transient'],
		['/Network/test.local/Photos', 'network/test.local/Photos', 'transient'],
	] as const)(
		'generates the expected thumbnail identity for storage root %s',
		async (virtualDirectory, relativeSystemDirectory, expectedKind) => {
			const testDirectory = nodePath.join(umbreld.instance.dataDirectory, relativeSystemDirectory)
			const thumbnailDirectory = `${umbreld.instance.dataDirectory}/thumbnails`
			await copyFixtureFile(testDirectory)
			await fse.remove(thumbnailDirectory)

			const thumbnailUrl = await umbreld.client.files.getThumbnail.mutate({
				path: `${virtualDirectory}/master-lossless-image.png`,
			})
			const filename = nodePath.basename(new URL(thumbnailUrl, 'http://localhost').pathname)
			const parsed = parseThumbnailFilename(filename)
			expect(parsed).toMatchObject({kind: expectedKind})
			await expect(fse.pathExists(thumbnailSystemPath(thumbnailDirectory, parsed!))).resolves.toBe(true)
		},
	)
})
