import {expect, beforeAll, afterAll, test, describe} from 'vitest'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'

// The protected-app test is covered in files.move.integration.test.ts (it
// installs a fixture app from the local test app store). Everything else runs
// end-to-end here, under both move implementations: the whole scenario runs
// once with umbreld's default fast move and once with
// UMBRELD_FORCE_SLOW_MOVE_WITH_PROGRESS set through a systemd override and an
// umbreld restart. Which implementation actually handled a move is asserted
// through real behaviour instead of spying on internals: an atomic rename
// preserves the file's inode, and the slow copy based move reports progress
// through the operation progress endpoint.

let umbreld: Awaited<ReturnType<typeof createTestVm>>

beforeAll(async () => {
	umbreld = await createTestVm({device: 'umbrel-home'})
	await umbreld.vm.powerOn()
	await umbreld.registerAndLogin()
})

afterAll(async () => {
	await umbreld.cleanup()
})

const guestHome = '/home/umbrel/umbrel/home'

// Create a file through the files API
async function uploadFile(path: string, content: string) {
	await umbreld.api.post(`files/upload?path=${encodeURIComponent(path)}`, {body: content})
}

// List the file names in a directory through the files API
async function listNames(path: string) {
	const listing = await umbreld.client.files.list.query({path})
	return listing.files.map((file) => file.name)
}

// Read a file's content from inside the VM (low-level assertion via SSH)
async function readGuestFile(guestPath: string) {
	return umbreld.vm.ssh(`cat '${guestPath}'`)
}

// Check a path exists inside the VM. The ssh helper ignores exit codes so we
// echo a marker instead.
async function guestPathExists(guestPath: string) {
	const output = await umbreld.vm.ssh(`test -e '${guestPath}' && echo exists || echo missing`)
	return output.trim() === 'exists'
}

// Run a move and report whether it showed up on the operation progress
// endpoint while it was running. The slow copy based move implementation
// reports progress, the fast atomic rename completes instantly and doesn't.
async function moveReportsProgress(path: string, toDirectory: string) {
	const movePromise = umbreld.client.files.move.mutate({path, toDirectory})
	let moveSettled = false
	movePromise.catch(() => {}).finally(() => (moveSettled = true))
	let sawProgress = false
	while (!moveSettled && !sawProgress) {
		const operations = await umbreld.client.files.operationProgress.query()
		sawProgress = operations.some((operation) => operation.type === 'move')
	}
	await movePromise
	return sawProgress
}

const forceSlowMoveWithProgressValues = [false, true]
for (const forceSlowMoveWithProgress of forceSlowMoveWithProgressValues) {
	// Unique path prefix per mode since both scenarios share one VM
	const mode = forceSlowMoveWithProgress ? 'slow' : 'fast'
	const base = `/Home/move-tests-${mode}`
	const guestBase = `${guestHome}/move-tests-${mode}`

	describe(`move() with UMBRELD_FORCE_SLOW_MOVE_WITH_PROGRESS=${forceSlowMoveWithProgress}`, () => {
		beforeAll(async () => {
			// Force the slow move implementation via a systemd environment
			// override and restart umbreld to pick it up
			if (forceSlowMoveWithProgress) {
				await umbreld.vm.sshAsRoot(
					`mkdir -p /etc/systemd/system/umbrel.service.d && printf '[Service]\\nEnvironment=UMBRELD_FORCE_SLOW_MOVE_WITH_PROGRESS=true\\n' > /etc/systemd/system/umbrel.service.d/force-slow-move.conf && systemctl daemon-reload && systemctl restart umbrel`,
				)
				await umbreld.waitForStartup({waitForUser: true})
				await umbreld.login()
			}

			// Parent directory for this scenario's test directories
			await umbreld.client.files.createDirectory.mutate({path: base})
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
			).rejects.toThrow('[operation-not-allowed]')
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
			// Create a symlink to the root directory (no product surface creates
			// symlinks, so seed it over SSH)
			await umbreld.vm.ssh(`ln -s / ${guestBase}/source-symlink-to-root`)

			await expect(
				umbreld.client.files.move.mutate({
					path: `${base}/source-symlink-to-root/etc`,
					toDirectory: '/Home',
				}),
			).rejects.toThrow('[escapes-base]')
		})

		test('move() throws on symlink traversal attempt in destination path', async () => {
			// Create a symlink to the root directory
			await umbreld.vm.ssh(`ln -s / ${guestBase}/destination-symlink-to-root`)

			await expect(
				umbreld.client.files.move.mutate({
					path: '/Home/Documents',
					toDirectory: `${base}/destination-symlink-to-root/etc`,
				}),
			).rejects.toThrow('[escapes-base]')
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
			await umbreld.client.files.createDirectory.mutate({path: `${base}/inside-self-move-test`})
			await umbreld.client.files.createDirectory.mutate({path: `${base}/inside-self-move-test/source`})
			await expect(
				umbreld.client.files.move.mutate({
					path: `${base}/inside-self-move-test`,
					toDirectory: `${base}/inside-self-move-test/source`,
				}),
			).rejects.toThrow('[subdir-of-self]')
		})

		test.each(['/Home', '/Apps', '/Home/Downloads'])(
			'move() throws when trying to move protected directory %s',
			async (path) => {
				await umbreld.client.files.createDirectory.mutate({path: `${base}/protected-move-test`})

				await expect(
					umbreld.client.files.move.mutate({
						path,
						toDirectory: `${base}/protected-move-test`,
					}),
				).rejects.toThrow('[operation-not-allowed]')
			},
		)

		test('move() does not throw when moving an unprotected path out of /Apps/', async () => {
			await umbreld.client.files.createDirectory.mutate({path: `${base}/unprotected-apps-move-test`})

			// Create a directory in /Apps/ that is not an installed app id. The
			// app-data directory is owned by root so seed it over SSH as root.
			await umbreld.vm.sshAsRoot(`mkdir /home/umbrel/umbrel/app-data/not-an-app-id-${mode}`)

			await expect(
				umbreld.client.files.move.mutate({
					path: `/Apps/not-an-app-id-${mode}`,
					toDirectory: `${base}/unprotected-apps-move-test`,
				}),
			).resolves.toBe(`${base}/unprotected-apps-move-test/not-an-app-id-${mode}`)
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
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-existing-test`})
			await uploadFile(`${base}/move-existing-test/source.txt`, '')
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-existing-test/destination`})
			await uploadFile(`${base}/move-existing-test/destination/source.txt`, '')

			// Create the maximum number of moved duplicates using the "keep-both" collision strategy
			const maxPossibleCopies = 100
			for (let i = 2; i <= maxPossibleCopies; i++) {
				await expect(
					umbreld.client.files.move.mutate({
						path: `${base}/move-existing-test/source.txt`,
						toDirectory: `${base}/move-existing-test/destination`,
						collision: 'keep-both',
					}),
				).resolves.toBe(`${base}/move-existing-test/destination/source (${i}).txt`)
				// Re-create the file after the move so that the next move also sees a collision
				await uploadFile(`${base}/move-existing-test/source.txt`, '')
			}

			// Check that creating one more duplicate throws an error
			await expect(
				umbreld.client.files.move.mutate({
					path: `${base}/move-existing-test/source.txt`,
					toDirectory: `${base}/move-existing-test/destination`,
					collision: 'keep-both',
				}),
			).rejects.toThrow('[unique-name-index-exceeded]')
		})

		test('move() moves a single file to a directory', async () => {
			// Create test directory and file
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-file-test`})
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-file-test/source`})
			await uploadFile(`${base}/move-file-test/source/source.txt`, 'test content')
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-file-test/destination`})

			// Verify the destination directory is empty
			await expect(listNames(`${base}/move-file-test/destination`)).resolves.toMatchObject([])

			// Move the file
			const result = await umbreld.client.files.move.mutate({
				path: `${base}/move-file-test/source/source.txt`,
				toDirectory: `${base}/move-file-test/destination`,
			})
			expect(result).toBe(`${base}/move-file-test/destination/source.txt`)

			// Verify the move: destination should have the file and source should not exist
			await expect(listNames(`${base}/move-file-test/destination`)).resolves.toMatchObject(['source.txt'])
			await expect(listNames(`${base}/move-file-test/source`)).resolves.toMatchObject([])
		})

		test('move() moves a single file to a directory with a trailing slash', async () => {
			// Create test directory and file
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-trailing-slash-test`})
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-trailing-slash-test/source`})
			await uploadFile(`${base}/move-trailing-slash-test/source/source.txt`, 'test content')
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-trailing-slash-test/destination`})

			// Verify the destination directory is empty
			await expect(listNames(`${base}/move-trailing-slash-test/destination`)).resolves.toMatchObject([])

			// Move the file
			const result = await umbreld.client.files.move.mutate({
				path: `${base}/move-trailing-slash-test/source/source.txt`,
				toDirectory: `${base}/move-trailing-slash-test/destination/`,
			})
			expect(result).toBe(`${base}/move-trailing-slash-test/destination/source.txt`)

			// Verify the move
			await expect(listNames(`${base}/move-trailing-slash-test/destination`)).resolves.toMatchObject(['source.txt'])
			await expect(listNames(`${base}/move-trailing-slash-test/source`)).resolves.toMatchObject([])
		})

		test('move() handles moving a file to the current containing directory by doing nothing', async () => {
			// Create test directory and file
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-same-dir-file-test`})
			await uploadFile(`${base}/move-same-dir-file-test/source.txt`, 'original content')

			// Get file's initial modified timestamp for comparison (low-level OS
			// fact via SSH)
			const guestFile = `${guestBase}/move-same-dir-file-test/source.txt`
			const initialModified = await umbreld.vm.ssh(`stat --format %y '${guestFile}'`)

			// Try to move the file to its current directory
			const result = await umbreld.client.files.move.mutate({
				path: `${base}/move-same-dir-file-test/source.txt`,
				toDirectory: `${base}/move-same-dir-file-test`,
			})
			expect(result).toBe(`${base}/move-same-dir-file-test/source.txt`)

			// Verify the file is still in the same location with the same content
			await expect(readGuestFile(guestFile)).resolves.toBe('original content')

			// Verify the file timestamp hasn't changed
			const finalModified = await umbreld.vm.ssh(`stat --format %y '${guestFile}'`)
			expect(finalModified).toBe(initialModified)
		})

		test('move() handles moving a file to a different directory by throwing on name conflict by default', async () => {
			// Create test directory structure
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-file-conflict-test`})
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-file-conflict-test/source`})
			await uploadFile(`${base}/move-file-conflict-test/source/file.txt`, 'source content')

			// Create a destination file with the same name
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-file-conflict-test/destination`})
			await uploadFile(`${base}/move-file-conflict-test/destination/file.txt`, 'destination content')

			// Try to move the file and verify that it fails with default 'error' collision strategy
			await expect(
				umbreld.client.files.move.mutate({
					path: `${base}/move-file-conflict-test/source/file.txt`,
					toDirectory: `${base}/move-file-conflict-test/destination`,
				}),
			).rejects.toThrow('[destination-already-exists]')

			// Verify source and destination content remains unchanged
			await expect(readGuestFile(`${guestBase}/move-file-conflict-test/source/file.txt`)).resolves.toBe(
				'source content',
			)
			await expect(readGuestFile(`${guestBase}/move-file-conflict-test/destination/file.txt`)).resolves.toBe(
				'destination content',
			)
		})

		test('move(path, {collision: "keep-both"}) keeps both files by appending a number to the moved file', async () => {
			// Create test directory structure
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-keep-both-test`})
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-keep-both-test/source`})
			await uploadFile(`${base}/move-keep-both-test/source/file.txt`, 'source content')
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-keep-both-test/destination`})
			await uploadFile(`${base}/move-keep-both-test/destination/file.txt`, 'destination content')

			// Move the file with 'keep-both' collision strategy
			const result = await umbreld.client.files.move.mutate({
				path: `${base}/move-keep-both-test/source/file.txt`,
				toDirectory: `${base}/move-keep-both-test/destination`,
				collision: 'keep-both',
			})
			expect(result).toBe(`${base}/move-keep-both-test/destination/file (2).txt`)

			// Verify both files exist at the destination with contents preserved
			await expect(readGuestFile(`${guestBase}/move-keep-both-test/destination/file.txt`)).resolves.toBe(
				'destination content',
			)
			await expect(readGuestFile(`${guestBase}/move-keep-both-test/destination/file (2).txt`)).resolves.toBe(
				'source content',
			)

			// Verify the source file no longer exists
			await expect(guestPathExists(`${guestBase}/move-keep-both-test/source/file.txt`)).resolves.toBe(false)
		})

		test('move(path, {collision: "replace"}) replaces the existing file with the moved file', async () => {
			// Create test directory structure
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-replace-test`})
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-replace-test/source`})
			await uploadFile(`${base}/move-replace-test/source/file.txt`, 'source content')
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-replace-test/destination`})
			await uploadFile(`${base}/move-replace-test/destination/file.txt`, 'destination content')

			// Move the file with 'replace' collision strategy
			const result = await umbreld.client.files.move.mutate({
				path: `${base}/move-replace-test/source/file.txt`,
				toDirectory: `${base}/move-replace-test/destination`,
				collision: 'replace',
			})
			expect(result).toBe(`${base}/move-replace-test/destination/file.txt`)

			// Verify the content is replaced
			await expect(readGuestFile(`${guestBase}/move-replace-test/destination/file.txt`)).resolves.toBe('source content')

			// Verify the source file no longer exists
			await expect(guestPathExists(`${guestBase}/move-replace-test/source/file.txt`)).resolves.toBe(false)
		})

		test('move() moves a directory with contents', async () => {
			// Create test directory structure
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-directory-test`})
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-directory-test/source`})
			await uploadFile(`${base}/move-directory-test/source/file1.txt`, 'content1')
			await uploadFile(`${base}/move-directory-test/source/file2.txt`, 'content2')
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-directory-test/source/subdir`})
			await uploadFile(`${base}/move-directory-test/source/subdir/file3.txt`, 'content3')
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-directory-test/destination`})

			// Verify destination is empty
			await expect(listNames(`${base}/move-directory-test/destination`)).resolves.toMatchObject([])

			// Move the directory
			const result = await umbreld.client.files.move.mutate({
				path: `${base}/move-directory-test/source`,
				toDirectory: `${base}/move-directory-test/destination`,
			})
			expect(result).toBe(`${base}/move-directory-test/destination/source`)

			// Verify the move: destination has the directory and source no longer exists
			// (sorted so the assertion doesn't depend on listing order)
			await expect(listNames(`${base}/move-directory-test/destination`)).resolves.toMatchObject(['source'])
			const movedNames = await listNames(`${base}/move-directory-test/destination/source`)
			expect(movedNames.sort()).toMatchObject(['file1.txt', 'file2.txt', 'subdir'])
			await expect(listNames(`${base}/move-directory-test/destination/source/subdir`)).resolves.toMatchObject([
				'file3.txt',
			])
			await expect(guestPathExists(`${guestBase}/move-directory-test/source`)).resolves.toBe(false)
		})

		test('move() moves a directory with contents with a trailing slash', async () => {
			// Create test directory structure
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-dir-trailing-slash-test`})
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-dir-trailing-slash-test/source`})
			await uploadFile(`${base}/move-dir-trailing-slash-test/source/file1.txt`, 'content1')
			await uploadFile(`${base}/move-dir-trailing-slash-test/source/file2.txt`, 'content2')
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-dir-trailing-slash-test/source/subdir`})
			await uploadFile(`${base}/move-dir-trailing-slash-test/source/subdir/file3.txt`, 'content3')
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-dir-trailing-slash-test/destination`})

			// Verify destination directory is empty
			await expect(listNames(`${base}/move-dir-trailing-slash-test/destination`)).resolves.toMatchObject([])

			// Move the directory
			const result = await umbreld.client.files.move.mutate({
				path: `${base}/move-dir-trailing-slash-test/source`,
				toDirectory: `${base}/move-dir-trailing-slash-test/destination/`,
			})
			expect(result).toBe(`${base}/move-dir-trailing-slash-test/destination/source`)

			// Verify the move (sorted so the assertion doesn't depend on listing order)
			await expect(listNames(`${base}/move-dir-trailing-slash-test/destination`)).resolves.toMatchObject(['source'])
			const movedNames = await listNames(`${base}/move-dir-trailing-slash-test/destination/source`)
			expect(movedNames.sort()).toMatchObject(['file1.txt', 'file2.txt', 'subdir'])
			await expect(listNames(`${base}/move-dir-trailing-slash-test/destination/source/subdir`)).resolves.toMatchObject([
				'file3.txt',
			])
			await expect(guestPathExists(`${guestBase}/move-dir-trailing-slash-test/source`)).resolves.toBe(false)
		})

		test('move() handles moving a directory to the current containing directory by doing nothing', async () => {
			// Create test directory structure
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-same-dir-test`})
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-same-dir-test/subdir`})
			await uploadFile(`${base}/move-same-dir-test/subdir/file.txt`, 'test content')

			// Get directory's initial modified timestamp for comparison
			const guestDir = `${guestBase}/move-same-dir-test/subdir`
			const initialModified = await umbreld.vm.ssh(`stat --format %y '${guestDir}'`)

			// Try to move the directory to its current parent directory
			const result = await umbreld.client.files.move.mutate({
				path: `${base}/move-same-dir-test/subdir`,
				toDirectory: `${base}/move-same-dir-test`,
			})
			expect(result).toBe(`${base}/move-same-dir-test/subdir`)

			// Verify the directory is still in the same location with the same content
			await expect(readGuestFile(`${guestDir}/file.txt`)).resolves.toBe('test content')

			// Verify the directory timestamp hasn't changed
			const finalModified = await umbreld.vm.ssh(`stat --format %y '${guestDir}'`)
			expect(finalModified).toBe(initialModified)
		})

		test('move() handles moving a directory to a different directory by throwing on name conflict by default', async () => {
			// Create test directory structure
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-dir-conflict-test`})
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-dir-conflict-test/source`})
			await uploadFile(`${base}/move-dir-conflict-test/source/file.txt`, 'source content')

			// Create a destination directory with the same name
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-dir-conflict-test/destination`})
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-dir-conflict-test/destination/source`})
			await uploadFile(`${base}/move-dir-conflict-test/destination/source/file.txt`, 'destination content')

			// Try to move the directory and verify that it fails with default 'error' collision strategy
			await expect(
				umbreld.client.files.move.mutate({
					path: `${base}/move-dir-conflict-test/source`,
					toDirectory: `${base}/move-dir-conflict-test/destination`,
				}),
			).rejects.toThrow('[destination-already-exists]')

			// Verify source and destination content remains unchanged
			await expect(readGuestFile(`${guestBase}/move-dir-conflict-test/source/file.txt`)).resolves.toBe('source content')
			await expect(readGuestFile(`${guestBase}/move-dir-conflict-test/destination/source/file.txt`)).resolves.toBe(
				'destination content',
			)
		})

		test('move(path, {collision: "keep-both"}) keeps both directories by appending a number to the moved directory', async () => {
			// Create test directory structure
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-dir-keep-both-test`})
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-dir-keep-both-test/source`})
			await uploadFile(`${base}/move-dir-keep-both-test/source/file.txt`, 'source content')
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-dir-keep-both-test/destination`})
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-dir-keep-both-test/destination/source`})
			await uploadFile(`${base}/move-dir-keep-both-test/destination/source/file.txt`, 'destination content')

			// Move the directory with 'keep-both' collision strategy
			const result = await umbreld.client.files.move.mutate({
				path: `${base}/move-dir-keep-both-test/source`,
				toDirectory: `${base}/move-dir-keep-both-test/destination`,
				collision: 'keep-both',
			})
			expect(result).toBe(`${base}/move-dir-keep-both-test/destination/source (2)`)

			// Verify the contents are preserved in both directories
			await expect(readGuestFile(`${guestBase}/move-dir-keep-both-test/destination/source/file.txt`)).resolves.toBe(
				'destination content',
			)
			await expect(readGuestFile(`${guestBase}/move-dir-keep-both-test/destination/source (2)/file.txt`)).resolves.toBe(
				'source content',
			)

			// Verify the source directory no longer exists
			await expect(guestPathExists(`${guestBase}/move-dir-keep-both-test/source`)).resolves.toBe(false)
		})

		test('move(path, {collision: "replace"}) replaces the existing directory with the moved directory', async () => {
			// Create test directory structure
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-dir-replace-test`})
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-dir-replace-test/source`})
			await uploadFile(`${base}/move-dir-replace-test/source/file1.txt`, 'file 1 source content')
			await uploadFile(`${base}/move-dir-replace-test/source/file2.txt`, 'file 2 source content')
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-dir-replace-test/destination`})
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-dir-replace-test/destination/source`})
			await uploadFile(`${base}/move-dir-replace-test/destination/source/file1.txt`, 'file 1 destination content')
			await uploadFile(`${base}/move-dir-replace-test/destination/source/file3.txt`, 'file 3 destination content')

			// Move the directory with 'replace' collision strategy
			const result = await umbreld.client.files.move.mutate({
				path: `${base}/move-dir-replace-test/source`,
				toDirectory: `${base}/move-dir-replace-test/destination`,
				collision: 'replace',
			})
			expect(result).toBe(`${base}/move-dir-replace-test/destination/source`)

			// Verify source content replaced the destination content
			await expect(readGuestFile(`${guestBase}/move-dir-replace-test/destination/source/file1.txt`)).resolves.toBe(
				'file 1 source content',
			)
			await expect(readGuestFile(`${guestBase}/move-dir-replace-test/destination/source/file2.txt`)).resolves.toBe(
				'file 2 source content',
			)

			// Verify the destination-only file no longer exists (was replaced)
			await expect(guestPathExists(`${guestBase}/move-dir-replace-test/destination/source/file3.txt`)).resolves.toBe(
				false,
			)

			// Verify the source directory no longer exists
			await expect(guestPathExists(`${guestBase}/move-dir-replace-test/source`)).resolves.toBe(false)
		})

		test('move() moves symlinks as symlinks', async () => {
			// Create test directory and file
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-symlink-test`})
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-symlink-test/source`})
			await uploadFile(`${base}/move-symlink-test/source/file.txt`, 'content')
			// Create a symlink in the source directory
			await umbreld.vm.ssh(
				`ln -s ${guestBase}/move-symlink-test/source/file.txt ${guestBase}/move-symlink-test/source/link`,
			)
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-symlink-test/destination`})

			// Move the symlink
			const result = await umbreld.client.files.move.mutate({
				path: `${base}/move-symlink-test/source/link`,
				toDirectory: `${base}/move-symlink-test/destination`,
			})
			expect(result).toBe(`${base}/move-symlink-test/destination/link`)

			// Verify the symlink was moved as a symlink pointing at the same
			// target (low-level OS facts via SSH)
			const linkType = await umbreld.vm.ssh(`stat --format %F '${guestBase}/move-symlink-test/destination/link'`)
			expect(linkType.trim()).toBe('symbolic link')
			const linkTarget = await umbreld.vm.ssh(`readlink '${guestBase}/move-symlink-test/destination/link'`)
			expect(linkTarget.trim()).toBe(`${guestBase}/move-symlink-test/source/file.txt`)

			// Verify that reading through the symlink works
			await expect(readGuestFile(`${guestBase}/move-symlink-test/destination/link`)).resolves.toBe('content')

			// Also, check that the original symlink no longer exists
			await expect(guestPathExists(`${guestBase}/move-symlink-test/source/link`)).resolves.toBe(false)
		})

		test('move() moves files inside a symlink', async () => {
			// Create test directory and file
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-inside-symlink-test`})
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-inside-symlink-test/source`})
			await uploadFile(`${base}/move-inside-symlink-test/source/file.txt`, 'content')
			// Create a symlink pointing to the source directory
			await umbreld.vm.ssh(
				`ln -s ${guestBase}/move-inside-symlink-test/source ${guestBase}/move-inside-symlink-test/symlink`,
			)
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-inside-symlink-test/destination`})

			// Move the file through the symlink path
			const result = await umbreld.client.files.move.mutate({
				path: `${base}/move-inside-symlink-test/symlink/file.txt`,
				toDirectory: `${base}/move-inside-symlink-test/destination`,
			})
			expect(result).toBe(`${base}/move-inside-symlink-test/destination/file.txt`)

			// Verify that the file was moved and the original no longer exists
			await expect(listNames(`${base}/move-inside-symlink-test/destination`)).resolves.toMatchObject(['file.txt'])
			await expect(guestPathExists(`${guestBase}/move-inside-symlink-test/source/file.txt`)).resolves.toBe(false)
		})

		test('move() preserves file permissions, ownership and timestamps', async () => {
			// Create test directory and file
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-permissions-test`})
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-permissions-test/source`})
			await uploadFile(`${base}/move-permissions-test/source/file.txt`, 'test content')
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-permissions-test/destination`})

			// Set specific permissions, ownership (arbitrary non-umbrel ids, needs
			// root) and timestamps on the source file
			const sourceFile = `${guestBase}/move-permissions-test/source/file.txt`
			await umbreld.vm.sshAsRoot(
				`chmod 644 '${sourceFile}' && chown 1234:1234 '${sourceFile}' && touch -d '2024-01-01 12:00:00' '${sourceFile}'`,
			)

			// Get original stats for later comparison (mode, uid, gid, mtime)
			const originalStats = await umbreld.vm.ssh(`stat --format '%a %u %g %y' '${sourceFile}'`)
			expect(originalStats.trim()).toContain('644 1234 1234')

			// Move the file
			const result = await umbreld.client.files.move.mutate({
				path: `${base}/move-permissions-test/source/file.txt`,
				toDirectory: `${base}/move-permissions-test/destination`,
			})
			expect(result).toBe(`${base}/move-permissions-test/destination/file.txt`)

			// Verify the permissions, ownership and timestamps are preserved
			const movedFile = `${guestBase}/move-permissions-test/destination/file.txt`
			const movedStats = await umbreld.vm.ssh(`stat --format '%a %u %g %y' '${movedFile}'`)
			expect(movedStats.trim()).toBe(originalStats.trim())
		})

		test('move() to same directory is a no-op', async () => {
			// Create test directory and file
			await umbreld.client.files.createDirectory.mutate({path: `${base}/move-same-directory-test`})
			await uploadFile(`${base}/move-same-directory-test/source.txt`, 'content')

			// Attempt to move the file to the same directory it is already in.
			// With the new behavior, we should receive the original virtual path with no
			// renaming occurring.
			const result = await umbreld.client.files.move.mutate({
				path: `${base}/move-same-directory-test/source.txt`,
				toDirectory: `${base}/move-same-directory-test`,
			})
			// Since the destination is the file's containing folder, the move operation is a no-op.
			expect(result).toBe(`${base}/move-same-directory-test/source.txt`)

			// Verify that the file still exists at the same location
			await expect(listNames(`${base}/move-same-directory-test`)).resolves.toMatchObject(['source.txt'])
		})

		// Implementation dispatch tests. These assert which move implementation
		// handled the move through real observable behaviour instead of spying
		// on internals.
		if (forceSlowMoveWithProgress) {
			test('move() reports progress when the slow move implementation is forced', {retry: 5}, async () => {
				// Create a large file so the move takes long enough to observe progress
				await umbreld.client.files.createDirectory.mutate({path: `${base}/slow-move-progress-test`})
				await umbreld.client.files.createDirectory.mutate({path: `${base}/slow-move-progress-test/destination`})
				const largeFile = `${guestBase}/slow-move-progress-test/large-file.bin`
				await umbreld.vm.sshAsRoot(
					`dd if=/dev/zero of='${largeFile}' bs=1M count=128 && chown umbrel:umbrel '${largeFile}'`,
				)

				// Check the move reports progress even within the same filesystem
				await expect(
					moveReportsProgress(
						`${base}/slow-move-progress-test/large-file.bin`,
						`${base}/slow-move-progress-test/destination`,
					),
				).resolves.toBe(true)

				// Verify the file arrived and the source is gone
				await expect(guestPathExists(`${guestBase}/slow-move-progress-test/destination/large-file.bin`)).resolves.toBe(
					true,
				)
				await expect(guestPathExists(largeFile)).resolves.toBe(false)

				// Clean up the large file
				await umbreld.vm.ssh(`rm -f '${guestBase}/slow-move-progress-test/destination/large-file.bin'`)
			})
		} else {
			test('move() uses an instant atomic rename within the same filesystem', async () => {
				// Create a test file
				await umbreld.client.files.createDirectory.mutate({path: `${base}/atomic-rename-test`})
				await umbreld.client.files.createDirectory.mutate({path: `${base}/atomic-rename-test/destination`})
				await uploadFile(`${base}/atomic-rename-test/file.txt`, 'atomic rename test')

				// Grab the inode before the move
				const inodeBefore = await umbreld.vm.ssh(`stat --format %i '${guestBase}/atomic-rename-test/file.txt'`)

				// Move the file
				await umbreld.client.files.move.mutate({
					path: `${base}/atomic-rename-test/file.txt`,
					toDirectory: `${base}/atomic-rename-test/destination`,
				})

				// An atomic rename preserves the inode, a copy and delete wouldn't
				const inodeAfter = await umbreld.vm.ssh(
					`stat --format %i '${guestBase}/atomic-rename-test/destination/file.txt'`,
				)
				expect(inodeBefore.trim()).toMatch(/^\d+$/)
				expect(inodeAfter.trim()).toBe(inodeBefore.trim())
			})

			test('move() falls back to the slow copy with progress when moving across filesystems', {retry: 5}, async () => {
				// Mount a tmpfs as the destination so the move genuinely crosses
				// filesystems, the real trigger for the slow move implementation
				await umbreld.client.files.createDirectory.mutate({path: `${base}/cross-filesystem-test`})
				const guestDestination = `${guestBase}/cross-filesystem-test/destination`
				await umbreld.vm.sshAsRoot(
					`mkdir -p '${guestDestination}' && mount -t tmpfs -o size=256m tmpfs '${guestDestination}'`,
				)

				try {
					// Create a large file so the move takes long enough to observe progress
					const largeFile = `${guestBase}/cross-filesystem-test/large-file.bin`
					await umbreld.vm.sshAsRoot(
						`dd if=/dev/zero of='${largeFile}' bs=1M count=128 && chown umbrel:umbrel '${largeFile}'`,
					)

					// Check the cross filesystem move reports progress, proving it took
					// the slow copy path rather than an atomic rename
					await expect(
						moveReportsProgress(
							`${base}/cross-filesystem-test/large-file.bin`,
							`${base}/cross-filesystem-test/destination`,
						),
					).resolves.toBe(true)

					// Verify the file arrived and the source is gone
					await expect(guestPathExists(`${guestDestination}/large-file.bin`)).resolves.toBe(true)
					await expect(guestPathExists(largeFile)).resolves.toBe(false)
				} finally {
					// Remove the tmpfs mount
					await umbreld.vm.sshAsRoot(`umount '${guestDestination}'`)
				}
			})
		}
	})
}
