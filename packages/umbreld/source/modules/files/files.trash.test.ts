import {expect, beforeAll, afterAll, test} from 'vitest'
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

test('trash() throws invalid error without auth token', async () => {
	await expect(umbreld.unauthenticatedClient.files.trash.mutate({path: '/Home/Documents'})).rejects.toThrow(
		'Invalid token',
	)
})

test('trash() throws on directory traversal attempt', async () => {
	await expect(
		umbreld.client.files.trash.mutate({
			path: '/Home/../../../../etc',
		}),
	).rejects.toThrow('[invalid-base]')
})

test('trash() throws on symlink traversal attempt', async () => {
	// Create a symlink to the root directory
	await $`ln -s / ${umbreld.instance.dataDirectory}/home/symlink-to-root`

	await expect(
		umbreld.client.files.trash.mutate({
			path: '/Home/symlink-to-root/etc',
		}),
	).rejects.toThrow('[escapes-base]')

	// Clean up
	await fse.remove(`${umbreld.instance.dataDirectory}/home/symlink-to-root`)
})

test('trash() throws on relative paths', async () => {
	await Promise.all(
		['', ' ', '.', '..', 'Home', 'Home/..', 'Home/Documents'].map(async (path) =>
			expect(umbreld.client.files.trash.mutate({path})).rejects.toThrow('[path-not-absolute]'),
		),
	)
})

test('trash() throws on non-existent path', async () => {
	await expect(
		umbreld.client.files.trash.mutate({
			path: '/Home/DoesNotExist',
		}),
	).rejects.toThrow('[source-not-exists]')
})

test('trash() throws on protected paths', async () => {
	// Create test directory
	const testDirectory = `${umbreld.instance.dataDirectory}/home/Downloads`
	await fse.mkdir(testDirectory, {recursive: true})

	await expect(
		umbreld.client.files.trash.mutate({
			path: '/Home/Downloads',
		}),
	).rejects.toThrow('[operation-not-allowed]')

	// Clean up
	await fse.remove(testDirectory)
})

test('trash() successfully moves a file to trash', async () => {
	// Create test directory and file
	const testDirectory = `${umbreld.instance.dataDirectory}/home/trash-file-test`
	await fse.mkdir(testDirectory)
	await fse.writeFile(`${testDirectory}/file.txt`, 'test content')

	// Verify the file exists
	await expect(fse.pathExists(`${testDirectory}/file.txt`)).resolves.toBe(true)

	await expect(fse.pathExists(`${umbreld.instance.dataDirectory}`)).resolves.toBe(true)
	await expect(fse.pathExists(`${umbreld.instance.dataDirectory}/trash`)).resolves.toBe(true)
	await expect(fse.pathExists(`${umbreld.instance.dataDirectory}/trash-meta`)).resolves.toBe(true)

	// Trash the file
	await expect(umbreld.client.files.trash.mutate({path: '/Home/trash-file-test/file.txt'})).resolves.toBe(
		'/Trash/file.txt',
	)

	// Verify the file is moved to trash
	await expect(fse.pathExists(`${testDirectory}/file.txt`)).resolves.toBe(false)

	// Verify the file exists in trash
	const trashSystemPath = `${umbreld.instance.dataDirectory}/trash/file.txt`
	await expect(fse.pathExists(trashSystemPath)).resolves.toBe(true)

	// Verify the content is preserved
	await expect(fse.readFile(trashSystemPath, 'utf8')).resolves.toBe('test content')

	// Verify metadata file exists
	const metaPath = `${umbreld.instance.dataDirectory}/trash-meta/file.txt.json`
	await expect(fse.pathExists(metaPath)).resolves.toBe(true)

	// Verify metadata contains original virtual path
	const meta = await fse.readJson(metaPath)
	expect(meta.path).toBe('/Home/trash-file-test/file.txt')

	// Clean up
	await fse.remove(testDirectory)
	await fse.remove(trashSystemPath)
	await fse.remove(metaPath)
})

test('trash() successfully moves a directory with contents to trash', async () => {
	// Create test directory structure
	const testDirectory = `${umbreld.instance.dataDirectory}/home/trash-directory-test`
	await fse.mkdir(testDirectory)
	await fse.mkdir(`${testDirectory}/subdir`)
	await fse.writeFile(`${testDirectory}/subdir/file1.txt`, 'content1')
	await fse.writeFile(`${testDirectory}/subdir/file2.txt`, 'content2')
	await fse.mkdir(`${testDirectory}/subdir/nested`)
	await fse.writeFile(`${testDirectory}/subdir/nested/file3.txt`, 'content3')

	// Verify the directory exists
	await expect(fse.pathExists(`${testDirectory}/subdir`)).resolves.toBe(true)

	// Trash the directory
	await expect(umbreld.client.files.trash.mutate({path: '/Home/trash-directory-test/subdir'})).resolves.toBe(
		'/Trash/subdir',
	)

	// Verify the directory is moved to trash
	await expect(fse.pathExists(`${testDirectory}/subdir`)).resolves.toBe(false)

	// Verify the directory exists in trash
	const trashSystemPath = `${umbreld.instance.dataDirectory}/trash/subdir`
	await expect(fse.pathExists(trashSystemPath)).resolves.toBe(true)

	// Verify the contents are preserved
	await expect(fse.pathExists(`${trashSystemPath}/file1.txt`)).resolves.toBe(true)
	await expect(fse.pathExists(`${trashSystemPath}/file2.txt`)).resolves.toBe(true)
	await expect(fse.pathExists(`${trashSystemPath}/nested/file3.txt`)).resolves.toBe(true)

	// Verify metadata file exists
	const metaPath = `${umbreld.instance.dataDirectory}/trash-meta/subdir.json`
	await expect(fse.pathExists(metaPath)).resolves.toBe(true)

	// Verify metadata contains original path
	const meta = await fse.readJson(metaPath)
	expect(meta.path).toBe('/Home/trash-directory-test/subdir')

	// Clean up
	await fse.remove(testDirectory)
	await fse.remove(trashSystemPath)
	await fse.remove(metaPath)
})

test('trash() handles name conflicts by appending numbers', async () => {
	// Create test directory and files
	const testDirectory = `${umbreld.instance.dataDirectory}/home/trash-conflict-test`
	await fse.mkdir(testDirectory)
	await fse.writeFile(`${testDirectory}/file.txt`, 'content1')

	// Trash the file
	await expect(
		umbreld.client.files.trash.mutate({
			path: '/Home/trash-conflict-test/file.txt',
		}),
	).resolves.toBe('/Trash/file.txt')

	// Create a new file with the same name
	await fse.writeFile(`${testDirectory}/file.txt`, 'content2')

	// Trash the file again
	await expect(
		umbreld.client.files.trash.mutate({
			path: '/Home/trash-conflict-test/file.txt',
		}),
	).resolves.toBe('/Trash/file (2).txt')

	// Verify the file is moved to trash with a unique name
	await expect(fse.pathExists(`${testDirectory}/file.txt`)).resolves.toBe(false)

	// Verify both files exist in trash
	await expect(fse.pathExists(`${umbreld.instance.dataDirectory}/trash/file.txt`)).resolves.toBe(true)
	await expect(fse.pathExists(`${umbreld.instance.dataDirectory}/trash/file (2).txt`)).resolves.toBe(true)

	// Verify metadata files exist with the correct name
	const metaPath = `${umbreld.instance.dataDirectory}/trash-meta/file.txt.json`
	await expect(fse.pathExists(metaPath)).resolves.toBe(true)
	const metaPath2 = `${umbreld.instance.dataDirectory}/trash-meta/file (2).txt.json`
	await expect(fse.pathExists(metaPath2)).resolves.toBe(true)

	// Clean up
	await fse.remove(testDirectory)
	await fse.remove(`${umbreld.instance.dataDirectory}/trash/file.txt`)
	await fse.remove(`${umbreld.instance.dataDirectory}/trash/file (2).txt`)
	await fse.remove(metaPath)
	await fse.remove(metaPath2)
})

test('trash() handles trashing two files of the same name at the same time', async () => {
	// Create test directory and files
	const testDirectory = `${umbreld.instance.dataDirectory}/home/trash-conflict-async-test`
	await fse.mkdir(testDirectory)
	await fse.writeFile(`${testDirectory}/file.txt`, 'content1')
	await fse.mkdir(`${testDirectory}/subdir`)
	await fse.writeFile(`${testDirectory}/subdir/file.txt`, 'content2')

	// Trash both files concurrently
	await expect(
		Promise.all([
			umbreld.client.files.trash.mutate({
				path: '/Home/trash-conflict-async-test/file.txt',
			}),
			umbreld.client.files.trash.mutate({
				path: '/Home/trash-conflict-async-test/subdir/file.txt',
			}),
		]),
	).resolves.toMatchObject(['/Trash/file.txt', '/Trash/file (2).txt'])

	// Verify the file is moved to trash with a unique name
	await expect(fse.pathExists(`${testDirectory}/file.txt`)).resolves.toBe(false)
	await expect(fse.pathExists(`${testDirectory}/subdir/file.txt`)).resolves.toBe(false)

	// Verify both files exist in trash
	await expect(fse.pathExists(`${umbreld.instance.dataDirectory}/trash/file.txt`)).resolves.toBe(true)
	await expect(fse.pathExists(`${umbreld.instance.dataDirectory}/trash/file (2).txt`)).resolves.toBe(true)

	// Verify metadata files exist with the correct name
	const metaPath = `${umbreld.instance.dataDirectory}/trash-meta/file.txt.json`
	await expect(fse.pathExists(metaPath)).resolves.toBe(true)
	const metaPath2 = `${umbreld.instance.dataDirectory}/trash-meta/file (2).txt.json`
	await expect(fse.pathExists(metaPath2)).resolves.toBe(true)

	// Clean up
	await fse.remove(testDirectory)
	await fse.remove(`${umbreld.instance.dataDirectory}/trash/file.txt`)
	await fse.remove(`${umbreld.instance.dataDirectory}/trash/file (2).txt`)
	await fse.remove(metaPath)
	await fse.remove(metaPath2)
})

test('trash() preserves symlinks when trashing', async () => {
	// Create a target file and symlink
	await fse.mkdir(`${umbreld.instance.dataDirectory}/home/trash-symlink-test`, {recursive: true})
	await fse.writeFile(`${umbreld.instance.dataDirectory}/home/trash-symlink-test/target.txt`, 'target content')
	await fse.symlink(
		`${umbreld.instance.dataDirectory}/home/trash-symlink-test/target.txt`,
		`${umbreld.instance.dataDirectory}/home/trash-symlink-test/symlink`,
	)

	// Trash the symlink
	await expect(
		umbreld.client.files.trash.mutate({
			path: '/Home/trash-symlink-test/symlink',
		}),
	).resolves.toBe('/Trash/symlink')

	// Verify the symlink is moved to trash
	await expect(fse.pathExists(`${umbreld.instance.dataDirectory}/home/trash-symlink-test/symlink`)).resolves.toBe(false)

	// Verify it's still a symlink in trash
	const trashedSymlink = `${umbreld.instance.dataDirectory}/trash/symlink`
	const isSymlink = await fse.lstat(trashedSymlink).then((stats) => stats.isSymbolicLink())
	expect(isSymlink).toBe(true)

	// Verify the symlink points to the correct target
	const linkTarget = await fse.readlink(trashedSymlink)
	expect(linkTarget).toBe(`${umbreld.instance.dataDirectory}/home/trash-symlink-test/target.txt`)

	// Verify reading through the symlink works
	const content = await fse.readFile(trashedSymlink, 'utf8')
	expect(content).toBe('target content')

	// Clean up
	await fse.remove(`${umbreld.instance.dataDirectory}/home/trash-symlink-test`)
	await fse.remove(trashedSymlink)
	await fse.remove(`${umbreld.instance.dataDirectory}/trash-meta/symlink.json`)
})
