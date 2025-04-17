import {expect, beforeAll, afterAll, test} from 'vitest'
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

test('rename() throws invalid error without auth token', async () => {
	await expect(
		umbreld.unauthenticatedClient.files.rename.mutate({path: '/Home/Documents', newName: 'Documents-copy'}),
	).rejects.toThrow('Invalid token')
})

test('rename() throws when newName is empty', async () => {
	const testDir = `${umbreld.instance.dataDirectory}/home/rename-test-empty`
	await fse.mkdir(testDir, {recursive: true})

	const filePath = `${testDir}/empty.txt`
	await fse.writeFile(filePath, 'content empty')

	const virtualFilePath = '/Home/rename-test-empty/empty.txt'
	await expect(
		umbreld.client.files.rename.mutate({
			path: virtualFilePath,
			newName: '',
		}),
	).rejects.toThrow('String must contain')

	await fse.remove(testDir)
})

test('rename() throws on protected paths', async () => {
	// In our implementation, /Home/Downloads is protected.
	// Ensure the directory exists.
	const testDir = `${umbreld.instance.dataDirectory}/home/Downloads`
	await fse.mkdir(testDir, {recursive: true})

	await expect(
		umbreld.client.files.rename.mutate({
			path: '/Home/Downloads',
			newName: 'DownloadsRenamed',
		}),
	).rejects.toThrow('[operation-not-allowed]')
})

test('rename() throws when source file/directory does not exist', async () => {
	// Create a valid directory but do not create the file to be renamed.
	const testDir = `${umbreld.instance.dataDirectory}/home/rename-nonexistent`
	await fse.mkdir(testDir, {recursive: true})

	const virtualFilePath = '/Home/rename-nonexistent/nonexistent.txt'
	await expect(
		umbreld.client.files.rename.mutate({
			path: virtualFilePath,
			newName: 'shouldNotMatter.txt',
		}),
	).rejects.toThrow('[source-not-exists]')
	await fse.remove(testDir)
})

test('rename() throws when the source virtual path is not absolute', async () => {
	// Passing a non-absolute path should throw an error during conversion.
	await expect(
		umbreld.client.files.rename.mutate({
			path: 'Home/relative/file.txt',
			newName: 'renamed.txt',
		}),
	).rejects.toThrow('[path-not-absolute]')
})

test('rename() throws when destination already exists', async () => {
	const testDir = `${umbreld.instance.dataDirectory}/home/rename-test-unique`
	await fse.mkdir(testDir, {recursive: true})

	// Create a file at the destination name that should conflict.
	const conflictPath = `${testDir}/target.txt`
	await fse.writeFile(conflictPath, 'conflict')

	// Create the file that we want to rename.
	const originalPath = `${testDir}/original.txt`
	await fse.writeFile(originalPath, 'original content')

	const virtualOriginalPath = '/Home/rename-test-unique/original.txt'
	await expect(
		umbreld.client.files.rename.mutate({
			path: virtualOriginalPath,
			newName: 'target.txt',
		}),
	).rejects.toThrow('[destination-already-exists]')

	await fse.remove(testDir)
})

test('rename() throws on filename traversal attack', async () => {
	const testDir = `${umbreld.instance.dataDirectory}/home/rename-test-invalid`
	await fse.mkdir(testDir, {recursive: true})

	// Create a source file that will be attempted to be renamed.
	const originalFilePath = `${testDir}/original.txt`
	await fse.writeFile(originalFilePath, 'some content')

	const virtualFilePath = '/Home/rename-test-invalid/original.txt'
	await expect(
		umbreld.client.files.rename.mutate({
			path: virtualFilePath,
			newName: 'traversal/attack.txt',
		}),
	).rejects.toThrow('[invalid-filename]')
	await expect(
		umbreld.client.files.rename.mutate({
			path: virtualFilePath,
			newName: 'traversal/../attack.txt',
		}),
	).rejects.toThrow('[invalid-filename]')

	await fse.remove(testDir)
})

test('rename() throws on invalid characters in filename', async () => {
	const testDir = `${umbreld.instance.dataDirectory}/home/rename-test-invalid`
	await fse.mkdir(testDir, {recursive: true})

	// Create a source file that will be attempted to be renamed.
	const originalFilePath = `${testDir}/original.txt`
	await fse.writeFile(originalFilePath, 'some content')

	const virtualFilePath = '/Home/rename-test-invalid/original.txt'
	await expect(
		umbreld.client.files.rename.mutate({
			path: virtualFilePath,
			newName: 'invalid:name.txt',
		}),
	).rejects.toThrow('[invalid-filename]')

	await fse.remove(testDir)
})

test('rename() renames a file successfully', async () => {
	const testDir = `${umbreld.instance.dataDirectory}/home/rename-test-file`
	await fse.mkdir(testDir, {recursive: true})

	const originalFilePath = `${testDir}/original.txt`
	await fse.writeFile(originalFilePath, 'hello world')

	const virtualOriginalPath = '/Home/rename-test-file/original.txt'
	const result = await umbreld.client.files.rename.mutate({
		path: virtualOriginalPath,
		newName: 'renamed.txt',
	})
	expect(result).toBe('/Home/rename-test-file/renamed.txt')

	// Check that the original file no longer exists
	expect(await fse.pathExists(originalFilePath)).toBe(false)
	// Check that the renamed file exists in the system
	const renamedSystemPath = `${testDir}/renamed.txt`
	expect(await fse.pathExists(renamedSystemPath)).toBe(true)

	await fse.remove(testDir)
})

test('rename() renames a directory successfully', async () => {
	const testDir = `${umbreld.instance.dataDirectory}/home/rename-test-dir`
	await fse.mkdir(testDir, {recursive: true})

	const originalDirPath = `${testDir}/original_dir`
	await fse.mkdir(originalDirPath)
	// Create a file inside the directory
	await fse.writeFile(`${originalDirPath}/file.txt`, 'content')

	const virtualOriginalPath = '/Home/rename-test-dir/original_dir'
	const result = await umbreld.client.files.rename.mutate({
		path: virtualOriginalPath,
		newName: 'renamed_dir',
	})
	expect(result).toBe('/Home/rename-test-dir/renamed_dir')

	const renamedDirSystemPath = `${testDir}/renamed_dir`
	expect(await fse.pathExists(renamedDirSystemPath)).toBe(true)
	// Verify file inside the renamed directory is still present
	expect(await fse.pathExists(`${renamedDirSystemPath}/file.txt`)).toBe(true)

	await fse.remove(testDir)
})

test('rename() returns the same path when newName is identical to current name', async () => {
	const testDir = `${umbreld.instance.dataDirectory}/home/rename-test-same`
	await fse.mkdir(testDir, {recursive: true})

	const filePath = `${testDir}/same.txt`
	await fse.writeFile(filePath, 'content same')

	const virtualFilePath = '/Home/rename-test-same/same.txt'
	const result = await umbreld.client.files.rename.mutate({
		path: virtualFilePath,
		newName: 'same.txt',
	})
	// No change is needed so the original virtual path is returned.
	expect(result).toBe(virtualFilePath)
	expect(await fse.pathExists(filePath)).toBe(true)

	await fse.remove(testDir)
})

test('rename() renames a symlink without altering its target', async () => {
	const testDir = `${umbreld.instance.dataDirectory}/home/rename-test-symlink`
	await fse.mkdir(testDir, {recursive: true})

	// Create a target file.
	const targetFile = `${testDir}/target.txt`
	await fse.writeFile(targetFile, 'link content')

	// Create a symlink pointing to the target file.
	const symlinkPath = `${testDir}/link`
	await fse.symlink(targetFile, symlinkPath)

	const virtualSymlinkPath = '/Home/rename-test-symlink/link'
	const result = await umbreld.client.files.rename.mutate({
		path: virtualSymlinkPath,
		newName: 'link-renamed',
	})
	expect(result).toBe('/Home/rename-test-symlink/link-renamed')

	const newSymlinkSystemPath = `${testDir}/link-renamed`
	const stats = await fse.lstat(newSymlinkSystemPath)
	expect(stats.isSymbolicLink()).toBe(true)
	// Verify that the symlink still points to the same target.
	const symlinkTarget = await fse.readlink(newSymlinkSystemPath)
	expect(symlinkTarget).toBe(targetFile)

	await fse.remove(testDir)
})
