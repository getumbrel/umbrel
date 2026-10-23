import {expect, beforeAll, afterAll, test} from 'vitest'
import fse from 'fs-extra'

import createTestUmbreld from '../test-utilities/create-test-umbreld.ts'

// The rest of move() is covered end-to-end in files.move.vm.test.ts. This
// test remains an integration test because it installs a fixture app from
// the local test app store, which isn't possible against a VM.

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>

beforeAll(async () => {
	umbreld = await createTestUmbreld()
	await umbreld.registerAndLogin()
})

afterAll(async () => {
	await umbreld.cleanup()
})

test('move() throws when trying to move a protected path out of /Apps/', async () => {
	// Install a test app
	await expect(umbreld.client.apps.install.mutate({appId: 'sparkles-hello-world'})).resolves.toStrictEqual(true)

	const testDirectory = `${umbreld.instance.dataDirectory}/home/protected-app-move-test`
	await fse.mkdir(testDirectory)

	await expect(
		umbreld.client.files.move.mutate({
			path: '/Apps/sparkles-hello-world',
			toDirectory: '/Home/protected-app-move-test',
		}),
	).rejects.toThrow('[operation-not-allowed]')

	// Clean up
	await fse.remove(testDirectory)
	await umbreld.client.apps.uninstall.mutate({appId: 'sparkles-hello-world'})
})
