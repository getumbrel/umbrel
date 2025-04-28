import {expect, beforeAll, afterAll, beforeEach, afterEach, test, describe, vi} from 'vitest'
import {execa, $} from 'execa'
import fse from 'fs-extra'

import createTestUmbreld from '../test-utilities/create-test-umbreld.js'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>

beforeAll(async () => {
	umbreld = await createTestUmbreld()
	await umbreld.registerAndLogin()
})

afterAll(async () => {
	await umbreld.cleanup()
})

let testDirectory = ''
afterEach(async () => {
	// Nuke trash state after each test
	if (testDirectory) await fse.remove(testDirectory)
})

const forceSlowMoveWithProgressValues = ['false', 'true']
for (const forceSlowMoveWithProgress of forceSlowMoveWithProgressValues) {
	describe(`move() with UMBRELD_FORCE_SLOW_MOVE_WITH_PROGRESS=${forceSlowMoveWithProgress}`, () => {
		beforeEach(() => {
			process.env.UMBRELD_FORCE_SLOW_MOVE_WITH_PROGRESS = forceSlowMoveWithProgress
		})
		test('move() throws invalid error without auth token', async () => {
			await expect(
				umbreld.unauthenticatedClient.files.move.mutate({
					path: '/Home/Documents',
					toDirectory: '/Home/Documents-moved',
				}),
			).rejects.toThrow('Invalid token')
		})

		test('move() throws on directory traversal attempt in source path', async () => {
			await expect(
				umbreld.client.files.move.mutate({
					path: '/Home/../../../../etc',
					toDirectory: '/Home',
				}),
			).rejects.toThrow('[invalid-base]')
		})

		test('move() throws on directory traversal attempt in destination path', async () => {
			await expect(
				umbreld.client.files.move.mutate({
					path: '/Home/Documents',
					toDirectory: '/Home/../../../../etc',
				}),
			).rejects.toThrow('[invalid-base]')
		})

		test('move() throws on symlink traversal attempt in source path', async () => {
			// Create a symlink to the root directory
			await $`ln -s / ${umbreld.instance.dataDirectory}/home/symlink-to-root`

			await expect(
				umbreld.client.files.move.mutate({
					path: '/Home/symlink-to-root/etc',
					toDirectory: '/Home',
				}),
			).rejects.toThrow('[escapes-base]')

			// Clean up
			await fse.remove(`${umbreld.instance.dataDirectory}/home/symlink-to-root`)
		})

		test('move() throws on symlink traversal attempt in destination path', async () => {
			// Create a symlink to the root directory
			await $`ln -s / ${umbreld.instance.dataDirectory}/home/symlink-to-root`

			await expect(
				umbreld.client.files.move.mutate({
					path: '/Home/Documents',
					toDirectory: '/Home/symlink-to-root/etc',
				}),
			).rejects.toThrow('[escapes-base]')

			// Clean up
			await fse.remove(`${umbreld.instance.dataDirectory}/home/symlink-to-root`)
		})

		test('move() throws on relative paths', async () => {
			await Promise.all(
				['', ' ', '.', '..', 'Home', 'Home/..', 'Home/Documents'].map(async (path) => {
					await expect(
						umbreld.client.files.move.mutate({
							path,
							toDirectory: '/Home/Documents',
						}),
					).rejects.toThrow('[path-not-absolute]')
					await expect(
						umbreld.client.files.move.mutate({
							path: '/Home/Documents',
							toDirectory: path,
						}),
					).rejects.toThrow('[path-not-absolute]')
				}),
			)
		})

		test('move() throws on non existent source path', async () => {
			await expect(
				umbreld.client.files.move.mutate({
					path: '/Home/DoesNotExist',
					toDirectory: '/Home/Documents',
				}),
			).rejects.toThrow('[source-not-exists]')
		})

		test('move() throws on non existent destination path', async () => {
			await expect(
				umbreld.client.files.move.mutate({
					path: '/Home/Documents',
					toDirectory: '/Home/DoesNotExist',
				}),
			).rejects.toThrow('[destination-not-exist]')
		})

		test('move() throws when moving a directory into itself', async () => {
			// For safety, moving a directory into its own destination should throw.
			await expect(
				umbreld.client.files.move.mutate({
					path: '/Home/Documents',
					toDirectory: '/Home/Documents',
				}),
			).rejects.toThrow('[subdir-of-self]')
		})

		test('move() throws when moving a directory into a subdirectory of itself', async () => {
			testDirectory = `${umbreld.instance.dataDirectory}/home/inside-self-move-test`
			await fse.mkdir(testDirectory)
			await fse.mkdir(`${testDirectory}/source`)
			await expect(
				umbreld.client.files.move.mutate({
					path: '/Home/inside-self-move-test',
					toDirectory: '/Home/inside-self-move-test/source',
				}),
			).rejects.toThrow('[subdir-of-self]')

			// Clean up
			await fse.remove(testDirectory)
		})

		test.each(['/Home', '/Apps', '/Home/Downloads'])(
			'move() throws when trying to move protected directory %s',
			async (path) => {
				testDirectory = `${umbreld.instance.dataDirectory}/home/protected-move-test`
				await fse.mkdir(testDirectory)

				await expect(
					umbreld.client.files.move.mutate({
						path,
						toDirectory: '/Home/protected-move-test',
					}),
				).rejects.toThrow('[operation-not-allowed]')

				await fse.remove(testDirectory)
			},
		)

		test('move() throws when trying to move a protected path out of /Apps/', async () => {
			// Install a test app
			await expect(umbreld.client.apps.install.mutate({appId: 'sparkles-hello-world'})).resolves.toStrictEqual(true)

			testDirectory = `${umbreld.instance.dataDirectory}/home/protected-app-move-test`
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

		test('move() does not throw when moving an unprotected path out of /Apps/', async () => {
			testDirectory = `${umbreld.instance.dataDirectory}/home/unprotected-apps-move-test`
			await fse.mkdir(testDirectory)

			// create a directory in /Apps/ that is not an installed app id
			await fse.mkdir(`${umbreld.instance.dataDirectory}/app-data/not-an-app-id`)

			await expect(
				umbreld.client.files.move.mutate({
					path: '/Apps/not-an-app-id',
					toDirectory: '/Home/unprotected-apps-move-test',
				}),
			).resolves.toBe('/Home/unprotected-apps-move-test/not-an-app-id')

			// Clean up
			await fse.remove(testDirectory)
		})

		test('move() throws when moving to the root directory', async () => {
			await expect(
				umbreld.client.files.move.mutate({
					path: '/Home/Documents',
					toDirectory: '/',
				}),
			).rejects.toThrow('[invalid-base]')
		})

		test('move() throws on too many duplicate names from existing paths when using the "keep-both" collision strategy', async () => {
			// Create test directory and file
			testDirectory = `${umbreld.instance.dataDirectory}/home/move-existing-test`
			await fse.mkdir(testDirectory)
			await fse.writeFile(`${testDirectory}/source.txt`, '')
			await fse.mkdir(`${testDirectory}/destination`)
			await fse.writeFile(`${testDirectory}/destination/source.txt`, '')

			// Create the maximum number of moved duplicates using the "keep-both" collision strategy
			const maxPossibleCopies = 100
			for (let i = 2; i <= maxPossibleCopies; i++) {
				await expect(
					umbreld.client.files.move.mutate({
						path: '/Home/move-existing-test/source.txt',
						toDirectory: '/Home/move-existing-test/destination',
						collision: 'keep-both',
					}),
				).resolves.toBe(`/Home/move-existing-test/destination/source (${i}).txt`)
				// Re-create the file after the move so that the next move also sees a collision
				await fse.writeFile(`${testDirectory}/source.txt`, '')
			}

			// Check that creating one more duplicate throws an error
			await expect(
				umbreld.client.files.move.mutate({
					path: '/Home/move-existing-test/source.txt',
					toDirectory: `/Home/move-existing-test/destination`,
					collision: 'keep-both',
				}),
			).rejects.toThrow('[unique-name-index-exceeded]')

			// Clean up
			await fse.remove(testDirectory)
		})

		test('move() moves a single file to a directory', async () => {
			// Create test directory and file
			testDirectory = `${umbreld.instance.dataDirectory}/home/move-file-test`
			await fse.mkdir(testDirectory)
			await fse.mkdir(`${testDirectory}/source`)
			await fse.writeFile(`${testDirectory}/source/source.txt`, 'test content')
			await fse.mkdir(`${testDirectory}/destination`)

			// Verify the destination directory is empty
			await expect(fse.readdir(`${testDirectory}/destination`)).resolves.toMatchObject([])

			// Move the file
			const result = await umbreld.client.files.move.mutate({
				path: '/Home/move-file-test/source/source.txt',
				toDirectory: '/Home/move-file-test/destination',
			})
			expect(result).toBe('/Home/move-file-test/destination/source.txt')

			// Verify the move: destination should have the file and source should not exist
			await expect(fse.readdir(`${testDirectory}/destination`)).resolves.toMatchObject(['source.txt'])
			await expect(fse.pathExists(`${testDirectory}/source/source.txt`)).resolves.toBe(false)

			// Clean up
			await fse.remove(testDirectory)
		})

		test('move() uses correct move operation', async () => {
			// Create test directory and file
			testDirectory = `${umbreld.instance.dataDirectory}/home/move-test-impl`
			await fse.mkdir(testDirectory)
			await fse.mkdir(`${testDirectory}/source`)
			await fse.writeFile(`${testDirectory}/source/source.txt`, 'test content')
			await fse.mkdir(`${testDirectory}/destination`)

			// Verify the destination directory is empty
			await expect(fse.readdir(`${testDirectory}/destination`)).resolves.toMatchObject([])

			// Attach spy
			vi.mock('execa', {spy: true})

			// Move the file
			const result = await umbreld.client.files.move.mutate({
				path: '/Home/move-test-impl/source/source.txt',
				toDirectory: '/Home/move-test-impl/destination',
			})
			expect(result).toBe('/Home/move-test-impl/destination/source.txt')

			// Check that the correct move operation was used
			if (forceSlowMoveWithProgress === 'true') {
				// When UMBRELD_FORCE_SLOW_MOVE_WITH_PROGRESS is true, rsync should be used
				expect(execa).toHaveBeenCalledWith('rsync', expect.anything())
			} else {
				// When UMBRELD_FORCE_SLOW_MOVE_WITH_PROGRESS is false, normal move should be used
				expect(execa).not.toHaveBeenCalled()
			}

			// Verify the move: destination should have the file and source should not exist
			await expect(fse.readdir(`${testDirectory}/destination`)).resolves.toMatchObject(['source.txt'])
			await expect(fse.pathExists(`${testDirectory}/source/source.txt`)).resolves.toBe(false)

			// Clean up
			await fse.remove(testDirectory)
		})

		test('move() moves a single file to a directory with a trailing slash', async () => {
			// Create test directory and file
			testDirectory = `${umbreld.instance.dataDirectory}/home/move-file-test`
			await fse.mkdir(testDirectory)
			await fse.mkdir(`${testDirectory}/source`)
			await fse.writeFile(`${testDirectory}/source/source.txt`, 'test content')
			await fse.mkdir(`${testDirectory}/destination`)

			// Verify the destination directory is empty
			await expect(fse.readdir(`${testDirectory}/destination`)).resolves.toMatchObject([])

			// Move the file
			const result = await umbreld.client.files.move.mutate({
				path: '/Home/move-file-test/source/source.txt',
				toDirectory: '/Home/move-file-test/destination/',
			})
			expect(result).toBe('/Home/move-file-test/destination/source.txt')

			// Verify the move
			await expect(fse.readdir(`${testDirectory}/destination`)).resolves.toMatchObject(['source.txt'])
			await expect(fse.pathExists(`${testDirectory}/source/source.txt`)).resolves.toBe(false)

			// Clean up
			await fse.remove(testDirectory)
		})

		test('move() handles moving a file to the current containing directory by doing nothing', async () => {
			// Create test directory and file
			testDirectory = `${umbreld.instance.dataDirectory}/home/move-same-dir-file-test`
			await fse.mkdir(testDirectory)
			await fse.writeFile(`${testDirectory}/source.txt`, 'original content')

			// Get file's initial modified timestamp for comparison
			const initialStats = await fse.stat(`${testDirectory}/source.txt`)
			const initialModified = initialStats.mtimeMs

			// Try to move the file to its current directory
			const result = await umbreld.client.files.move.mutate({
				path: '/Home/move-same-dir-file-test/source.txt',
				toDirectory: '/Home/move-same-dir-file-test',
			})
			expect(result).toBe('/Home/move-same-dir-file-test/source.txt')

			// Verify the file is still in the same location with the same content
			const exists = await fse.pathExists(`${testDirectory}/source.txt`)
			expect(exists).toBe(true)
			const content = await fse.readFile(`${testDirectory}/source.txt`, 'utf8')
			expect(content).toBe('original content')

			// Verify the file timestamp hasn't changed
			const finalStats = await fse.stat(`${testDirectory}/source.txt`)
			expect(finalStats.mtimeMs).toBe(initialModified)

			// Clean up
			await fse.remove(testDirectory)
		})

		test('move() handles moving a file to a different directory by throwing on name conflict by default', async () => {
			// Create test directory structure
			testDirectory = `${umbreld.instance.dataDirectory}/home/move-file-conflict-test`
			await fse.mkdir(testDirectory)
			await fse.mkdir(`${testDirectory}/source`)
			await fse.writeFile(`${testDirectory}/source/file.txt`, 'source content')

			// Create a destination file with the same name
			await fse.mkdir(`${testDirectory}/destination`)
			await fse.writeFile(`${testDirectory}/destination/file.txt`, 'destination content')

			// Try to move the file and verify that it fails with default 'error' collision strategy
			await expect(
				umbreld.client.files.move.mutate({
					path: '/Home/move-file-conflict-test/source/file.txt',
					toDirectory: '/Home/move-file-conflict-test/destination',
				}),
			).rejects.toThrow('[destination-already-exists]')

			// Verify source and destination content remains unchanged
			await expect(fse.readFile(`${testDirectory}/source/file.txt`, 'utf8')).resolves.toBe('source content')
			await expect(fse.readFile(`${testDirectory}/destination/file.txt`, 'utf8')).resolves.toBe('destination content')

			// Clean up
			await fse.remove(testDirectory)
		})

		test('move(path, {collision: "keep-both"}) keeps both files by appending a number to the moved file', async () => {
			// Create test directory structure
			testDirectory = `${umbreld.instance.dataDirectory}/home/move-keep-both-test`
			await fse.mkdir(testDirectory)
			await fse.mkdir(`${testDirectory}/source`)
			await fse.writeFile(`${testDirectory}/source/file.txt`, 'source content')
			await fse.mkdir(`${testDirectory}/destination`)
			await fse.writeFile(`${testDirectory}/destination/file.txt`, 'destination content')

			// Move the file with 'keep-both' collision strategy
			const result = await umbreld.client.files.move.mutate({
				path: '/Home/move-keep-both-test/source/file.txt',
				toDirectory: '/Home/move-keep-both-test/destination',
				collision: 'keep-both',
			})
			expect(result).toBe('/Home/move-keep-both-test/destination/file (2).txt')

			// Verify both files exist at the destination
			await expect(fse.pathExists(`${testDirectory}/destination/file.txt`)).resolves.toBe(true)
			await expect(fse.pathExists(`${testDirectory}/destination/file (2).txt`)).resolves.toBe(true)

			// Verify the contents are preserved
			await expect(fse.readFile(`${testDirectory}/destination/file.txt`, 'utf8')).resolves.toBe('destination content')
			await expect(fse.readFile(`${testDirectory}/destination/file (2).txt`, 'utf8')).resolves.toBe('source content')

			// Verify the source file no longer exists
			await expect(fse.pathExists(`${testDirectory}/source/file.txt`)).resolves.toBe(false)

			// Clean up
			await fse.remove(testDirectory)
		})

		test('move(path, {collision: "replace"}) replaces the existing file with the moved file', async () => {
			// Create test directory structure
			testDirectory = `${umbreld.instance.dataDirectory}/home/move-replace-test`
			await fse.mkdir(testDirectory)
			await fse.mkdir(`${testDirectory}/source`)
			await fse.writeFile(`${testDirectory}/source/file.txt`, 'source content')
			await fse.mkdir(`${testDirectory}/destination`)
			await fse.writeFile(`${testDirectory}/destination/file.txt`, 'destination content')

			// Move the file with 'replace' collision strategy
			const result = await umbreld.client.files.move.mutate({
				path: '/Home/move-replace-test/source/file.txt',
				toDirectory: '/Home/move-replace-test/destination',
				collision: 'replace',
			})
			expect(result).toBe('/Home/move-replace-test/destination/file.txt')

			// Verify the file exists at the destination
			await expect(fse.pathExists(`${testDirectory}/destination/file.txt`)).resolves.toBe(true)

			// Verify the content is replaced
			await expect(fse.readFile(`${testDirectory}/destination/file.txt`, 'utf8')).resolves.toBe('source content')

			// Verify the source file no longer exists
			await expect(fse.pathExists(`${testDirectory}/source/file.txt`)).resolves.toBe(false)

			// Clean up
			await fse.remove(testDirectory)
		})

		test('move() moves a directory with contents', async () => {
			// Create test directory structure
			testDirectory = `${umbreld.instance.dataDirectory}/home/move-directory-test`
			await fse.mkdir(testDirectory)
			await fse.mkdir(`${testDirectory}/source`)
			await fse.writeFile(`${testDirectory}/source/file1.txt`, 'content1')
			await fse.writeFile(`${testDirectory}/source/file2.txt`, 'content2')
			await fse.mkdir(`${testDirectory}/source/subdir`)
			await fse.writeFile(`${testDirectory}/source/subdir/file3.txt`, 'content3')
			await fse.mkdir(`${testDirectory}/destination`)

			// Verify destination is empty
			await expect(fse.readdir(`${testDirectory}/destination`)).resolves.toMatchObject([])

			// Move the directory
			const result = await umbreld.client.files.move.mutate({
				path: '/Home/move-directory-test/source',
				toDirectory: '/Home/move-directory-test/destination',
			})
			expect(result).toBe('/Home/move-directory-test/destination/source')

			// Verify the move: destination has the directory and source no longer exists
			await expect(fse.readdir(`${testDirectory}/destination`)).resolves.toMatchObject(['source'])
			await expect(fse.readdir(`${testDirectory}/destination/source`)).resolves.toMatchObject([
				'file1.txt',
				'file2.txt',
				'subdir',
			])
			await expect(fse.readdir(`${testDirectory}/destination/source/subdir`)).resolves.toMatchObject(['file3.txt'])
			await expect(fse.pathExists(`${testDirectory}/source`)).resolves.toBe(false)

			// Clean up
			await fse.remove(testDirectory)
		})

		test('move() moves a directory with contents with a trailing slash', async () => {
			// Create test directory structure
			testDirectory = `${umbreld.instance.dataDirectory}/home/move-directory-test`
			await fse.mkdir(testDirectory)
			await fse.mkdir(`${testDirectory}/source`)
			await fse.writeFile(`${testDirectory}/source/file1.txt`, 'content1')
			await fse.writeFile(`${testDirectory}/source/file2.txt`, 'content2')
			await fse.mkdir(`${testDirectory}/source/subdir`)
			await fse.writeFile(`${testDirectory}/source/subdir/file3.txt`, 'content3')
			await fse.mkdir(`${testDirectory}/destination`)

			// Verify destination directory is empty
			await expect(fse.readdir(`${testDirectory}/destination`)).resolves.toMatchObject([])

			// Move the directory
			const result = await umbreld.client.files.move.mutate({
				path: '/Home/move-directory-test/source',
				toDirectory: '/Home/move-directory-test/destination/',
			})
			expect(result).toBe('/Home/move-directory-test/destination/source')

			// Verify the move
			await expect(fse.readdir(`${testDirectory}/destination`)).resolves.toMatchObject(['source'])
			await expect(fse.readdir(`${testDirectory}/destination/source`)).resolves.toMatchObject([
				'file1.txt',
				'file2.txt',
				'subdir',
			])
			await expect(fse.readdir(`${testDirectory}/destination/source/subdir`)).resolves.toMatchObject(['file3.txt'])
			await expect(fse.pathExists(`${testDirectory}/source`)).resolves.toBe(false)

			// Clean up
			await fse.remove(testDirectory)
		})

		test('move() handles moving a directory to the current containing directory by doing nothing', async () => {
			// Create test directory structure
			testDirectory = `${umbreld.instance.dataDirectory}/home/move-same-dir-test`
			await fse.mkdir(testDirectory)
			await fse.mkdir(`${testDirectory}/subdir`)
			await fse.writeFile(`${testDirectory}/subdir/file.txt`, 'test content')

			// Get directory's initial modified timestamp for comparison
			const initialStats = await fse.stat(`${testDirectory}/subdir`)
			const initialModified = initialStats.mtimeMs

			// Try to move the directory to its current parent directory
			const result = await umbreld.client.files.move.mutate({
				path: '/Home/move-same-dir-test/subdir',
				toDirectory: '/Home/move-same-dir-test',
			})
			expect(result).toBe('/Home/move-same-dir-test/subdir')

			// Verify the directory is still in the same location with the same content
			await expect(fse.pathExists(`${testDirectory}/subdir`)).resolves.toBe(true)
			await expect(fse.pathExists(`${testDirectory}/subdir/file.txt`)).resolves.toBe(true)
			await expect(fse.readFile(`${testDirectory}/subdir/file.txt`, 'utf8')).resolves.toBe('test content')

			// Verify the directory timestamp hasn't changed
			const finalStats = await fse.stat(`${testDirectory}/subdir`)
			expect(finalStats.mtimeMs).toBe(initialModified)

			// Clean up
			await fse.remove(testDirectory)
		})

		test('move() handles moving a directory to a different directory by throwing on name conflict by default', async () => {
			// Create test directory structure
			testDirectory = `${umbreld.instance.dataDirectory}/home/move-dir-conflict-test`
			await fse.mkdir(testDirectory)
			await fse.mkdir(`${testDirectory}/source`)
			await fse.writeFile(`${testDirectory}/source/file.txt`, 'source content')

			// Create a destination directory with the same name
			await fse.mkdir(`${testDirectory}/destination`)
			await fse.mkdir(`${testDirectory}/destination/source`)
			await fse.writeFile(`${testDirectory}/destination/source/file.txt`, 'destination content')

			// Try to move the directory and verify that it fails with default 'error' collision strategy
			await expect(
				umbreld.client.files.move.mutate({
					path: '/Home/move-dir-conflict-test/source',
					toDirectory: '/Home/move-dir-conflict-test/destination',
				}),
			).rejects.toThrow('[destination-already-exists]')

			// Verify source and destination content remains unchanged
			await expect(fse.readFile(`${testDirectory}/source/file.txt`, 'utf8')).resolves.toBe('source content')
			await expect(fse.readFile(`${testDirectory}/destination/source/file.txt`, 'utf8')).resolves.toBe(
				'destination content',
			)

			// Clean up
			await fse.remove(testDirectory)
		})

		test('move(path, {collision: "keep-both"}) keeps both directories by appending a number to the moved directory', async () => {
			// Create test directory structure
			testDirectory = `${umbreld.instance.dataDirectory}/home/move-dir-keep-both-test`
			await fse.mkdir(testDirectory)
			await fse.mkdir(`${testDirectory}/source`)
			await fse.writeFile(`${testDirectory}/source/file.txt`, 'source content')
			await fse.mkdir(`${testDirectory}/destination`)
			await fse.mkdir(`${testDirectory}/destination/source`)
			await fse.writeFile(`${testDirectory}/destination/source/file.txt`, 'destination content')

			// Move the directory with 'keep-both' collision strategy
			const result = await umbreld.client.files.move.mutate({
				path: '/Home/move-dir-keep-both-test/source',
				toDirectory: '/Home/move-dir-keep-both-test/destination',
				collision: 'keep-both',
			})
			expect(result).toBe('/Home/move-dir-keep-both-test/destination/source (2)')

			// Verify both directories exist at the destination
			await expect(fse.pathExists(`${testDirectory}/destination/source`)).resolves.toBe(true)
			await expect(fse.pathExists(`${testDirectory}/destination/source (2)`)).resolves.toBe(true)

			// Verify the contents are preserved in both directories
			await expect(fse.readFile(`${testDirectory}/destination/source/file.txt`, 'utf8')).resolves.toBe(
				'destination content',
			)
			await expect(fse.readFile(`${testDirectory}/destination/source (2)/file.txt`, 'utf8')).resolves.toBe(
				'source content',
			)

			// Verify the source directory no longer exists
			await expect(fse.pathExists(`${testDirectory}/source`)).resolves.toBe(false)

			// Clean up
			await fse.remove(testDirectory)
		})

		test('move(path, {collision: "replace"}) replaces the existing directory with the moved directory', async () => {
			// Create test directory structure
			testDirectory = `${umbreld.instance.dataDirectory}/home/move-dir-replace-test`
			await fse.mkdir(testDirectory)
			await fse.mkdir(`${testDirectory}/source`)
			await fse.writeFile(`${testDirectory}/source/file1.txt`, 'file 1 source content')
			await fse.writeFile(`${testDirectory}/source/file2.txt`, 'file 2 source content')
			await fse.mkdir(`${testDirectory}/destination`)
			await fse.mkdir(`${testDirectory}/destination/source`)
			await fse.writeFile(`${testDirectory}/destination/source/file1.txt`, 'file 1 destination content')
			await fse.writeFile(`${testDirectory}/destination/source/file3.txt`, 'file 3 destination content')

			// Move the directory with 'replace' collision strategy
			const result = await umbreld.client.files.move.mutate({
				path: '/Home/move-dir-replace-test/source',
				toDirectory: '/Home/move-dir-replace-test/destination',
				collision: 'replace',
			})
			expect(result).toBe('/Home/move-dir-replace-test/destination/source')

			// Verify the directory exists at the destination
			await expect(fse.pathExists(`${testDirectory}/destination/source`)).resolves.toBe(true)

			// Verify source content replaced the destination content
			await expect(fse.readFile(`${testDirectory}/destination/source/file1.txt`, 'utf8')).resolves.toBe(
				'file 1 source content',
			)
			await expect(fse.readFile(`${testDirectory}/destination/source/file2.txt`, 'utf8')).resolves.toBe(
				'file 2 source content',
			)

			// Verify the destination-only file no longer exists (was replaced)
			await expect(fse.pathExists(`${testDirectory}/destination/source/file3.txt`)).resolves.toBe(false)

			// Verify the source directory no longer exists
			await expect(fse.pathExists(`${testDirectory}/source`)).resolves.toBe(false)

			// Clean up
			await fse.remove(testDirectory)
		})

		test('move() moves symlinks as symlinks', async () => {
			// Create test directory and file
			testDirectory = `${umbreld.instance.dataDirectory}/home/move-symlink-test`
			await fse.mkdir(testDirectory)
			await fse.mkdir(`${testDirectory}/source`)
			await fse.writeFile(`${testDirectory}/source/file.txt`, 'content')
			// Create a symlink in the source directory
			await fse.symlink(`${testDirectory}/source/file.txt`, `${testDirectory}/source/link`)
			await fse.mkdir(`${testDirectory}/destination`)

			// Move the symlink
			const result = await umbreld.client.files.move.mutate({
				path: '/Home/move-symlink-test/source/link',
				toDirectory: '/Home/move-symlink-test/destination',
			})
			expect(result).toBe('/Home/move-symlink-test/destination/link')

			// Verify the symlink was moved as a symlink
			const isSymlink = await fse.lstat(`${testDirectory}/destination/link`).then((stats) => stats.isSymbolicLink())
			expect(isSymlink).toBe(true)

			// Verify the symlink points to the correct target (the target remains unchanged)
			const linkTarget = await fse.readlink(`${testDirectory}/destination/link`)
			expect(linkTarget).toBe(`${testDirectory}/source/file.txt`)

			// Verify that reading through the symlink works
			const content = await fse.readFile(`${testDirectory}/destination/link`, 'utf8')
			expect(content).toBe('content')

			// Also, check that the original symlink no longer exists
			await expect(fse.pathExists(`${testDirectory}/source/link`)).resolves.toBe(false)

			// Clean up
			await fse.remove(testDirectory)
		})

		test('move() moves files inside a symlink', async () => {
			// Create test directory and file
			testDirectory = `${umbreld.instance.dataDirectory}/home/move-symlink-test`
			await fse.mkdir(testDirectory)
			await fse.mkdir(`${testDirectory}/source`)
			await fse.writeFile(`${testDirectory}/source/file.txt`, 'content')
			// Create a symlink pointing to the source directory
			await fse.symlink(`${testDirectory}/source`, `${testDirectory}/symlink`)
			await fse.mkdir(`${testDirectory}/destination`)

			// Move the file through the symlink path
			const result = await umbreld.client.files.move.mutate({
				path: '/Home/move-symlink-test/symlink/file.txt',
				toDirectory: '/Home/move-symlink-test/destination',
			})
			expect(result).toBe('/Home/move-symlink-test/destination/file.txt')

			// Verify that the file was moved and the original no longer exists
			await expect(fse.readdir(`${testDirectory}/destination`)).resolves.toMatchObject(['file.txt'])
			await expect(fse.pathExists(`${testDirectory}/source/file.txt`)).resolves.toBe(false)

			// Clean up
			await fse.remove(testDirectory)
		})

		test('move() preserves file permissions, ownership and timestamps', async () => {
			// Create test directory and file
			testDirectory = `${umbreld.instance.dataDirectory}/home/move-permissions-test`
			await fse.mkdir(testDirectory)
			await fse.mkdir(`${testDirectory}/source`)
			const sourceFile = `${testDirectory}/source/file.txt`
			await fse.writeFile(sourceFile, 'test content')
			await fse.mkdir(`${testDirectory}/destination`)

			// Set specific permissions (0o644 = rw-r--r--) and timestamps
			const originalPermissions = 0o644
			await fse.chmod(sourceFile, originalPermissions)

			// Set specific ownership (use umbrel user ID from files class)
			const uid = 1234
			const gid = 1234
			await fse.chown(sourceFile, uid, gid)

			// Set a specific timestamp (1 day ago)
			const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
			await fse.utimes(sourceFile, pastDate, pastDate)

			// Get original stats for later comparison
			const originalStats = await fse.stat(sourceFile)

			// Check time applied correctly
			expect(originalStats.mtime.getTime()).toBe(pastDate.getTime())

			// Move the file
			const result = await umbreld.client.files.move.mutate({
				path: '/Home/move-permissions-test/source/file.txt',
				toDirectory: '/Home/move-permissions-test/destination',
			})
			expect(result).toBe('/Home/move-permissions-test/destination/file.txt')

			// Get stats of the moved file
			const movedFile = `${testDirectory}/destination/file.txt`
			const movedStats = await fse.stat(movedFile)

			// Verify the permissions are preserved
			expect(movedStats.mode).toBe(originalStats.mode)

			// Verify ownership is preserved
			expect(movedStats.uid).toBe(originalStats.uid)
			expect(movedStats.gid).toBe(originalStats.gid)

			// Verify the timestamps are preserved
			expect(movedStats.mtime.getTime()).toBe(originalStats.mtime.getTime())

			// Clean up
			await fse.remove(testDirectory)
		})

		test('move() to same directory is a no-op', async () => {
			// Create test directory and file
			testDirectory = `${umbreld.instance.dataDirectory}/home/move-same-directory-test`
			await fse.mkdir(testDirectory)
			await fse.writeFile(`${testDirectory}/source.txt`, 'content')

			// Attempt to move the file to the same directory it is already in.
			// With the new behavior, we should receive the original virtual path with no
			// renaming occurring.
			const result = await umbreld.client.files.move.mutate({
				path: '/Home/move-same-directory-test/source.txt',
				toDirectory: '/Home/move-same-directory-test',
			})
			// Since the destination is the file's containing folder, the move operation is a no-op.
			expect(result).toBe('/Home/move-same-directory-test/source.txt')

			// Verify that the file still exists at the same location
			await expect(fse.readdir(testDirectory)).resolves.toMatchObject(['source.txt'])

			// Clean up the test directory
			await fse.remove(testDirectory)
		})
	})
}
