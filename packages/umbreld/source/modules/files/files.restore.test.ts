import {expect, beforeAll, afterAll, afterEach, test} from 'vitest'
import fse from 'fs-extra'
import {$} from 'execa'
import createTestUmbreld from '../test-utilities/create-test-umbreld.js'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>

beforeAll(async () => {
	umbreld = await createTestUmbreld()
	await umbreld.registerAndLogin()
})

afterAll(async () => {
	await umbreld.cleanup()
})

afterEach(async () => {
	// Nuke trash state after each test
	const trashDir = `${umbreld.instance.dataDirectory}/trash`
	const trashMetaDir = `${umbreld.instance.dataDirectory}/trash-meta`
	for (const file of await fse.readdir(trashDir)) await fse.remove(`${trashDir}/${file}`)
	for (const file of await fse.readdir(trashMetaDir)) await fse.remove(`${trashMetaDir}/${file}`)
})

test('restore() throws invalid error without auth token', async () => {
	// Now try to restore without auth
	await expect(umbreld.unauthenticatedClient.files.restore.mutate({path: '/Trash/foo'})).rejects.toThrow(
		'Invalid token',
	)
})

test('restore() throws on directory traversal attempt', async () => {
	await expect(
		umbreld.client.files.restore.mutate({
			path: '/Trash/../../../../etc',
		}),
	).rejects.toThrow('[operation-not-allowed]')
})

test('restore() throws on symlink traversal attempt', async () => {
	// Create a symlink to the root directory
	await $`ln -s / ${umbreld.instance.dataDirectory}/trash/symlink-to-root`

	await expect(
		umbreld.client.files.restore.mutate({
			path: '/Trash/symlink-to-root/etc',
		}),
	).rejects.toThrow('[escapes-base]')

	// Clean up
	await fse.remove(`${umbreld.instance.dataDirectory}/trash/symlink-to-root`)
})

test('restore() throws on relative paths', async () => {
	await Promise.all(
		['', ' ', '.', '..', 'Trash', 'Trash/..', 'Trash/file.txt'].map(async (path) => {
			await expect(
				umbreld.client.files.restore.mutate({
					path,
				}),
			).rejects.toThrow('[operation-not-allowed]')
		}),
	)
})

test('restore() throws on non-existent path', async () => {
	await expect(
		umbreld.client.files.restore.mutate({
			path: '/Trash/DoesNotExist',
		}),
	).rejects.toThrow('[source-not-exists]')
})

test('restore() throws on non-trash paths', async () => {
	await expect(
		umbreld.client.files.restore.mutate({
			path: '/Home/file.txt',
		}),
	).rejects.toThrow('[operation-not-allowed]')
})

test('restore() throws when metadata file is missing', async () => {
	// Create a file in trash without metadata
	await fse.writeFile(`${umbreld.instance.dataDirectory}/trash/no-meta.txt`, 'content')

	await expect(
		umbreld.client.files.restore.mutate({
			path: '/Trash/no-meta.txt',
		}),
	).rejects.toThrow('[trash-meta-not-exists]')

	// Clean up
	await fse.remove(`${umbreld.instance.dataDirectory}/trash/no-meta.txt`)
})

test('restore() successfully restores a file from trash', async () => {
	// Create test directory and file
	const testDirectory = `${umbreld.instance.dataDirectory}/home/restore-file-test`
	await fse.mkdir(testDirectory, {recursive: true})
	await fse.writeFile(`${testDirectory}/restore-file.txt`, 'test content')

	const virtualPath = '/Home/restore-file-test/restore-file.txt'

	// Trash the file using the actual trash method
	const trashPath = await umbreld.client.files.trash.mutate({
		path: virtualPath,
	})
	expect(trashPath).toBe('/Trash/restore-file.txt')

	// Verify the file no longer exists at the original location
	await expect(fse.pathExists(`${testDirectory}/restore-file.txt`)).resolves.toBe(false)

	// Now restore the file
	await expect(umbreld.client.files.restore.mutate({path: trashPath})).resolves.toBe(virtualPath)

	// Verify the file no longer exists in trash
	await expect(fse.pathExists(`${umbreld.instance.dataDirectory}/trash/restore-file.txt`)).resolves.toBe(false)

	// Verify the file exists at the original location
	await expect(fse.pathExists(`${testDirectory}/restore-file.txt`)).resolves.toBe(true)

	// Verify the content is preserved
	await expect(fse.readFile(`${testDirectory}/restore-file.txt`, 'utf8')).resolves.toBe('test content')

	// Verify metadata file is deleted
	await expect(fse.pathExists(`${umbreld.instance.dataDirectory}/trash-meta/restore-file.txt.json`)).resolves.toBe(
		false,
	)

	// Clean up
	await fse.remove(testDirectory)
})

test('restore() successfully restores a directory with contents from trash', async () => {
	// Create test directory structure
	const testDirectory = `${umbreld.instance.dataDirectory}/home/restore-dir-test`
	await fse.mkdir(testDirectory, {recursive: true})
	await fse.mkdir(`${testDirectory}/restore-dir`)
	await fse.writeFile(`${testDirectory}/restore-dir/file1.txt`, 'content1')
	await fse.writeFile(`${testDirectory}/restore-dir/file2.txt`, 'content2')
	await fse.mkdir(`${testDirectory}/restore-dir/nested`)
	await fse.writeFile(`${testDirectory}/restore-dir/nested/file3.txt`, 'content3')

	// Trash the directory using the actual trash method
	const trashPath = await umbreld.client.files.trash.mutate({
		path: '/Home/restore-dir-test/restore-dir',
	})

	// Verify the directory is moved to trash
	await expect(fse.pathExists(`${testDirectory}/restore-dir`)).resolves.toBe(false)

	// Now restore the directory
	const restoredPath = await umbreld.client.files.restore.mutate({
		path: trashPath,
	})

	// Verify the directory is moved from trash
	await expect(fse.pathExists(`${umbreld.instance.dataDirectory}/trash/restore-dir`)).resolves.toBe(false)

	// Verify the directory exists at the original location
	await expect(fse.pathExists(`${testDirectory}/restore-dir`)).resolves.toBe(true)

	// Verify the contents are preserved
	await expect(fse.pathExists(`${testDirectory}/restore-dir/file1.txt`)).resolves.toBe(true)
	await expect(fse.pathExists(`${testDirectory}/restore-dir/file2.txt`)).resolves.toBe(true)
	await expect(fse.pathExists(`${testDirectory}/restore-dir/nested/file3.txt`)).resolves.toBe(true)

	// Verify metadata file is deleted
	await expect(fse.pathExists(`${umbreld.instance.dataDirectory}/trash-meta/restore-dir.json`)).resolves.toBe(false)

	// Verify the returned path matches the original path
	expect(restoredPath).toBe('/Home/restore-dir-test/restore-dir')

	// Clean up
	await fse.remove(testDirectory)
})

test('restore() successfully restores a child directory from trash', async () => {
	// Create test directory structure
	const testDirectory = `${umbreld.instance.dataDirectory}/home/restore-child-dir-test`
	await fse.mkdir(testDirectory, {recursive: true})
	await fse.mkdir(`${testDirectory}/child-dir`)
	await fse.writeFile(`${testDirectory}/child-dir/file1.txt`, 'content1')

	// Trash the directory
	const trashPath = await umbreld.client.files.trash.mutate({
		path: '/Home/restore-child-dir-test',
	})
	expect(trashPath).toBe('/Trash/restore-child-dir-test')

	// Verify the directory is moved to trash
	await expect(fse.pathExists(`${testDirectory}/restore-child-dir`)).resolves.toBe(false)

	// Now restore the child directory
	const restoredPath = await umbreld.client.files.restore.mutate({
		path: '/Trash/restore-child-dir-test/child-dir',
	})
	expect(restoredPath).toBe('/Home/restore-child-dir-test/child-dir')

	// Verify the directory is moved from trash
	await expect(
		fse.pathExists(`${umbreld.instance.dataDirectory}/trash/restore-child-dir-test/child-dir`),
	).resolves.toBe(false)

	// Verify the directory exists at the original location
	await expect(fse.pathExists(`${testDirectory}/child-dir`)).resolves.toBe(true)
})

test('restore() successfully restores multiple subdirectories from trash one after another', async () => {
	// Create test directory structure with two subdirectories
	const testDirectory = `${umbreld.instance.dataDirectory}/home/restore-multiple-subdirs-test`
	await fse.mkdir(testDirectory, {recursive: true})

	// Create first subdir with content
	await fse.mkdir(`${testDirectory}/subdir1`, {recursive: true})
	await fse.writeFile(`${testDirectory}/subdir1/file1.txt`, 'content1')

	// Create second subdir with content
	await fse.mkdir(`${testDirectory}/subdir2`, {recursive: true})
	await fse.writeFile(`${testDirectory}/subdir2/file2.txt`, 'content2')

	// Trash the parent directory
	const trashPath = await umbreld.client.files.trash.mutate({
		path: '/Home/restore-multiple-subdirs-test',
	})
	expect(trashPath).toBe('/Trash/restore-multiple-subdirs-test')

	// Verify the directory is moved to trash
	await expect(fse.pathExists(testDirectory)).resolves.toBe(false)
	await expect(fse.pathExists(`${umbreld.instance.dataDirectory}/trash/restore-multiple-subdirs-test`)).resolves.toBe(
		true,
	)

	// Now restore the first subdirectory
	const restoredPath1 = await umbreld.client.files.restore.mutate({
		path: '/Trash/restore-multiple-subdirs-test/subdir1',
	})
	expect(restoredPath1).toBe('/Home/restore-multiple-subdirs-test/subdir1')

	// Verify the first subdirectory is restored
	await expect(fse.pathExists(`${testDirectory}/subdir1`)).resolves.toBe(true)
	await expect(fse.pathExists(`${testDirectory}/subdir1/file1.txt`)).resolves.toBe(true)

	// Verify the second subdirectory is still in trash
	await expect(
		fse.pathExists(`${umbreld.instance.dataDirectory}/trash/restore-multiple-subdirs-test/subdir2`),
	).resolves.toBe(true)

	// Now restore the second subdirectory
	const restoredPath2 = await umbreld.client.files.restore.mutate({
		path: '/Trash/restore-multiple-subdirs-test/subdir2',
	})
	expect(restoredPath2).toBe('/Home/restore-multiple-subdirs-test/subdir2')

	// Verify the second subdirectory is restored
	await expect(fse.pathExists(`${testDirectory}/subdir2`)).resolves.toBe(true)
	await expect(fse.pathExists(`${testDirectory}/subdir2/file2.txt`)).resolves.toBe(true)

	// Clean up
	await fse.remove(testDirectory)
})

test('restore() throws on name conflict', async () => {
	// Create test directory and file
	const testDirectory = `${umbreld.instance.dataDirectory}/home/conflict-test`
	await fse.mkdir(testDirectory, {recursive: true})
	await fse.writeFile(`${testDirectory}/conflict-file.txt`, 'original content')

	// Trash the file
	const trashPath = await umbreld.client.files.trash.mutate({
		path: '/Home/conflict-test/conflict-file.txt',
	})

	// Create a new file with the same name
	await fse.writeFile(`${testDirectory}/conflict-file.txt`, 'new content')

	// Now restore the file
	await expect(
		umbreld.client.files.restore.mutate({
			path: trashPath,
		}),
	).rejects.toThrow('[destination-already-exists]')

	// Clean up
	await fse.remove(testDirectory)
})

test('restore(path, {collision: "keep-both"}) handles name conflict', async () => {
	// Create test directory and file
	const testDirectory = `${umbreld.instance.dataDirectory}/home/conflict-keep-both-test`
	await fse.mkdir(testDirectory, {recursive: true})
	await fse.writeFile(`${testDirectory}/conflict-file.txt`, 'original content')

	// Trash the file
	const trashPath = await umbreld.client.files.trash.mutate({
		path: '/Home/conflict-keep-both-test/conflict-file.txt',
	})
	expect(trashPath).toBe('/Trash/conflict-file.txt')

	// Create a new file with the same name
	await fse.writeFile(`${testDirectory}/conflict-file.txt`, 'new content')

	// Now restore the file
	await expect(
		umbreld.client.files.restore.mutate({
			path: trashPath,
			collision: 'keep-both',
		}),
	).resolves.toBe('/Home/conflict-keep-both-test/conflict-file (2).txt')

	// Verify both files exist at the original location
	await expect(fse.pathExists(`${testDirectory}/conflict-file.txt`)).resolves.toBe(true)
	await expect(fse.pathExists(`${testDirectory}/conflict-file (2).txt`)).resolves.toBe(true)

	// Verify the contents are preserved
	await expect(fse.readFile(`${testDirectory}/conflict-file.txt`, 'utf8')).resolves.toBe('new content')
	await expect(fse.readFile(`${testDirectory}/conflict-file (2).txt`, 'utf8')).resolves.toBe('original content')

	// Clean up
	await fse.remove(testDirectory)
})

test('restore(path, {collision: "replace"}) handles name conflict', async () => {
	// Create test directory and file
	const testDirectory = `${umbreld.instance.dataDirectory}/home/conflict-replace-test`
	await fse.mkdir(testDirectory, {recursive: true})
	await fse.writeFile(`${testDirectory}/conflict-file.txt`, 'original content')

	// Trash the file
	const trashPath = await umbreld.client.files.trash.mutate({
		path: '/Home/conflict-replace-test/conflict-file.txt',
	})
	expect(trashPath).toBe('/Trash/conflict-file.txt')

	// Create a new file with the same name
	await fse.writeFile(`${testDirectory}/conflict-file.txt`, 'new content')

	// Now restore the file
	await expect(
		umbreld.client.files.restore.mutate({
			path: trashPath,
			collision: 'replace',
		}),
	).resolves.toBe('/Home/conflict-replace-test/conflict-file.txt')

	// Verify the file no longer exists in trash
	await expect(fse.pathExists(`${umbreld.instance.dataDirectory}/trash/conflict-file.txt`)).resolves.toBe(false)

	// Verify the file exists at the original location
	await expect(fse.pathExists(`${testDirectory}/conflict-file.txt`)).resolves.toBe(true)

	// Verify the content is replaced
	await expect(fse.readFile(`${testDirectory}/conflict-file.txt`, 'utf8')).resolves.toBe('original content')

	// Clean up
	await fse.remove(testDirectory)
})

test('restore(path, {collision: "replace"}) with directory replaces entire target directory instead of merging', async () => {
	// Create original directory with multiple files
	const testDirectory = `${umbreld.instance.dataDirectory}/home/dir-replace-test`
	await fse.ensureDir(testDirectory)
	await fse.writeFile(`${testDirectory}/file1.txt`, 'original file1')
	await fse.writeFile(`${testDirectory}/file2.txt`, 'original file2')
	await fse.writeFile(`${testDirectory}/file3.txt`, 'original file3')

	// Trash the directory
	const trashPath = await umbreld.client.files.trash.mutate({
		path: '/Home/dir-replace-test',
	})
	expect(trashPath).toBe('/Trash/dir-replace-test')

	// Verify the directory no longer exists at the original location
	await expect(fse.pathExists(testDirectory)).resolves.toBe(false)

	// Create a new directory with the same name but different content
	await fse.ensureDir(testDirectory)
	await fse.writeFile(`${testDirectory}/fileA.txt`, 'new fileA')
	await fse.writeFile(`${testDirectory}/fileB.txt`, 'new fileB')

	// Now restore the directory with replace option
	const restoredPath = await umbreld.client.files.restore.mutate({
		path: trashPath,
		collision: 'replace',
	})

	// Verify the path is correct
	expect(restoredPath).toBe('/Home/dir-replace-test')

	// Verify the original directory content is restored
	await expect(fse.pathExists(`${testDirectory}/file1.txt`)).resolves.toBe(true)
	await expect(fse.pathExists(`${testDirectory}/file2.txt`)).resolves.toBe(true)
	await expect(fse.pathExists(`${testDirectory}/file3.txt`)).resolves.toBe(true)

	// Verify the new directory content is gone (replaced, not merged)
	await expect(fse.pathExists(`${testDirectory}/fileA.txt`)).resolves.toBe(false)
	await expect(fse.pathExists(`${testDirectory}/fileB.txt`)).resolves.toBe(false)

	// Verify the content of restored files is correct
	await expect(fse.readFile(`${testDirectory}/file1.txt`, 'utf8')).resolves.toBe('original file1')
	await expect(fse.readFile(`${testDirectory}/file2.txt`, 'utf8')).resolves.toBe('original file2')
	await expect(fse.readFile(`${testDirectory}/file3.txt`, 'utf8')).resolves.toBe('original file3')

	// Clean up
	await fse.remove(testDirectory)
})

test('restore() creates parent directories if they do not exist', async () => {
	// Create test directory and file
	const testDirectory = `${umbreld.instance.dataDirectory}/home/parent-test`
	await fse.mkdir(testDirectory, {recursive: true})
	await fse.writeFile(`${testDirectory}/nested-restore.txt`, 'test content')

	// Trash the file
	const trashPath = await umbreld.client.files.trash.mutate({
		path: '/Home/parent-test/nested-restore.txt',
	})

	// Remove the parent directory
	await fse.remove(testDirectory)

	// Now restore the file - this should recreate the parent directory
	const restoredPath = await umbreld.client.files.restore.mutate({
		path: trashPath,
	})

	// Verify the file exists at the original location
	await expect(fse.pathExists(`${testDirectory}/nested-restore.txt`)).resolves.toBe(true)

	// Verify the content is preserved
	await expect(fse.readFile(`${testDirectory}/nested-restore.txt`, 'utf8')).resolves.toBe('test content')

	// Verify the returned path matches the original path
	expect(restoredPath).toBe('/Home/parent-test/nested-restore.txt')

	// Clean up
	await fse.remove(testDirectory)
})

test('restore() preserves symlinks when restoring directories', async () => {
	// Create test directory with a file and a relative symlink to it
	const testDirectory = `${umbreld.instance.dataDirectory}/home/symlink-test`
	await fse.mkdir(testDirectory, {recursive: true})
	await fse.writeFile(`${testDirectory}/target.txt`, 'target content')

	// Create a relative symlink (not absolute path)
	await fse.symlink('target.txt', `${testDirectory}/symlink.txt`)

	// Verify the directory exists
	await expect(fse.pathExists(testDirectory)).resolves.toBe(true)

	// Trash the entire directory
	const trashPath = await umbreld.client.files.trash.mutate({
		path: '/Home/symlink-test',
	})

	// Verify the directory no longer exists
	await expect(fse.pathExists(testDirectory)).resolves.toBe(false)

	// Now restore the directory
	const restoredPath = await umbreld.client.files.restore.mutate({
		path: trashPath,
	})

	// Verify the directory was restored
	await expect(fse.pathExists(testDirectory)).resolves.toBe(true)

	// Verify the symlink exists and is still a symlink
	const symlinkPath = `${testDirectory}/symlink.txt`
	await expect(fse.pathExists(symlinkPath)).resolves.toBe(true)
	const isSymlink = await fse.lstat(symlinkPath).then((stats) => stats.isSymbolicLink())
	expect(isSymlink).toBe(true)

	// Verify the symlink still points to the relative target
	const linkTarget = await fse.readlink(symlinkPath)
	expect(linkTarget).toBe('target.txt')

	// Verify reading through the symlink works
	const content = await fse.readFile(symlinkPath, 'utf8')
	expect(content).toBe('target content')

	// Verify the returned path matches the original path
	expect(restoredPath).toBe('/Home/symlink-test')

	// Clean up
	await fse.remove(testDirectory)
})
