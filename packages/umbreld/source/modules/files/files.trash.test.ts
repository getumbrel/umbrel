import nodePath from 'node:path'
import {createHash} from 'node:crypto'
import {link, lstat, rename} from 'node:fs/promises'

import {expect, beforeAll, afterAll, test, vi} from 'vitest'
import fse from 'fs-extra'
import {$} from 'execa'
import createTestUmbreld from '../test-utilities/create-test-umbreld.ts'
import {OWNER_USER_ID} from '../user/constants.ts'

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

test('trash() restores an atomically claimed file when its expected revision does not match', async () => {
	const systemPath = `${umbreld.instance.dataDirectory}/home/replaced-photo.jpg`
	await fse.writeFile(systemPath, 'replacement bytes')

	await expect(
		umbreld.instance.files.trash('/Home/replaced-photo.jpg', OWNER_USER_ID, {
			inode: 'not-the-replacement',
			size: 17,
			modifiedNs: '0',
			ctimeNs: '0',
		}),
	).rejects.toThrow('[source-changed]')

	await expect(fse.readFile(systemPath, 'utf8')).resolves.toBe('replacement bytes')
	expect((await fse.readdir(nodePath.dirname(systemPath))).some((name) => name.endsWith('.umbrel-trash'))).toBe(false)
})

test('trash() moves the exact atomically claimed revision', async () => {
	const systemPath = `${umbreld.instance.dataDirectory}/home/revision-photo.jpg`
	const trashSystemPath = `${umbreld.instance.dataDirectory}/trash/revision-photo.jpg`
	await fse.writeFile(systemPath, 'expected bytes')
	const stats = await lstat(systemPath, {bigint: true})

	await expect(
		umbreld.instance.files.trash('/Home/revision-photo.jpg', OWNER_USER_ID, {
			inode: stats.ino.toString(),
			size: Number(stats.size),
			modifiedNs: stats.mtimeNs.toString(),
			ctimeNs: stats.ctimeNs.toString(),
		}),
	).resolves.toBe('/Trash/revision-photo.jpg')

	await expect(fse.pathExists(systemPath)).resolves.toBe(false)
	await expect(fse.readFile(trashSystemPath, 'utf8')).resolves.toBe('expected bytes')
	await fse.remove(trashSystemPath)
	await fse.remove(`${umbreld.instance.dataDirectory}/trash-meta/revision-photo.jpg.json`)
})

test('recoverTrashClaim() restores an interrupted revision claim without overwriting', async () => {
	const originalSystemPath = `${umbreld.instance.dataDirectory}/home/interrupted-photo.jpg`
	const claimId = createHash('sha256').update(originalSystemPath).digest('hex').slice(0, 32)
	const claimSystemPath = `${umbreld.instance.dataDirectory}/home/.${claimId}.umbrel-trash`
	const manifestSystemPath = `${umbreld.instance.dataDirectory}/home/.${claimId}.json.umbrel-trash`
	await fse.writeFile(originalSystemPath, 'claimed bytes')
	const stats = await lstat(originalSystemPath, {bigint: true})
	await fse.writeJson(manifestSystemPath, {
		version: 1,
		originalSystemPath,
		revision: {
			inode: stats.ino.toString(),
			size: Number(stats.size),
			modifiedNs: stats.mtimeNs.toString(),
			ctimeNs: stats.ctimeNs.toString(),
		},
	})
	await rename(originalSystemPath, claimSystemPath)

	await expect(umbreld.instance.files.recoverTrashClaim('/Home/interrupted-photo.jpg', OWNER_USER_ID)).resolves.toBe(
		true,
	)
	await expect(fse.readFile(originalSystemPath, 'utf8')).resolves.toBe('claimed bytes')
	await expect(fse.pathExists(claimSystemPath)).resolves.toBe(false)
	await expect(fse.pathExists(manifestSystemPath)).resolves.toBe(false)
	await fse.remove(originalSystemPath)
})

test('trash() replaces an incomplete claim manifest atomically', async () => {
	const originalSystemPath = `${umbreld.instance.dataDirectory}/home/incomplete-manifest.jpg`
	const trashSystemPath = `${umbreld.instance.dataDirectory}/trash/incomplete-manifest.jpg`
	const claimId = createHash('sha256').update(originalSystemPath).digest('hex').slice(0, 32)
	const manifestSystemPath = `${umbreld.instance.dataDirectory}/home/.${claimId}.json.umbrel-trash`
	await fse.writeFile(originalSystemPath, 'original bytes')
	await fse.writeFile(manifestSystemPath, '')
	const stats = await lstat(originalSystemPath, {bigint: true})
	const revision = {
		inode: stats.ino.toString(),
		size: Number(stats.size),
		modifiedNs: stats.mtimeNs.toString(),
		ctimeNs: stats.ctimeNs.toString(),
	}

	await expect(umbreld.instance.files.trash('/Home/incomplete-manifest.jpg', OWNER_USER_ID, revision)).resolves.toBe(
		'/Trash/incomplete-manifest.jpg',
	)
	await expect(fse.pathExists(manifestSystemPath)).resolves.toBe(false)

	await fse.remove(trashSystemPath)
	await fse.remove(`${umbreld.instance.dataDirectory}/trash-meta/incomplete-manifest.jpg.json`)
})

test('recoverTrashClaim() keeps its journal until the index observes the restored file', async () => {
	const originalSystemPath = `${umbreld.instance.dataDirectory}/home/interrupted-index-update.jpg`
	const claimId = createHash('sha256').update(originalSystemPath).digest('hex').slice(0, 32)
	const claimSystemPath = `${umbreld.instance.dataDirectory}/home/.${claimId}.umbrel-trash`
	const manifestSystemPath = `${umbreld.instance.dataDirectory}/home/.${claimId}.json.umbrel-trash`
	await fse.writeFile(claimSystemPath, 'claimed bytes')
	const stats = await lstat(claimSystemPath, {bigint: true})
	await fse.writeJson(manifestSystemPath, {
		version: 1,
		originalSystemPath,
		revision: {
			inode: stats.ino.toString(),
			size: Number(stats.size),
			modifiedNs: stats.mtimeNs.toString(),
			ctimeNs: stats.ctimeNs.toString(),
		},
	})
	const movePath = vi
		.spyOn(umbreld.instance.files.fileIndex, 'movePathRequired')
		.mockRejectedValueOnce(new Error('[file-index-unavailable]'))

	await expect(
		umbreld.instance.files.recoverTrashClaim('/Home/interrupted-index-update.jpg', OWNER_USER_ID),
	).rejects.toThrow('[file-index-unavailable]')
	await expect(fse.readFile(originalSystemPath, 'utf8')).resolves.toBe('claimed bytes')
	await expect(fse.pathExists(claimSystemPath)).resolves.toBe(false)
	await expect(fse.pathExists(manifestSystemPath)).resolves.toBe(true)

	await expect(
		umbreld.instance.files.recoverTrashClaim('/Home/interrupted-index-update.jpg', OWNER_USER_ID),
	).resolves.toBe(true)
	expect(movePath).toHaveBeenCalledTimes(2)
	await expect(fse.pathExists(manifestSystemPath)).resolves.toBe(false)
	movePath.mockRestore()
	await fse.remove(originalSystemPath)
})

test('recoverTrashClaim() never mistakes a replacement for a restored claim', async () => {
	const originalSystemPath = `${umbreld.instance.dataDirectory}/home/replaced-after-claim.jpg`
	const trashSystemPath = `${umbreld.instance.dataDirectory}/trash/replaced-after-claim.jpg`
	const claimId = createHash('sha256').update(originalSystemPath).digest('hex').slice(0, 32)
	const claimSystemPath = `${umbreld.instance.dataDirectory}/home/.${claimId}.umbrel-trash`
	const manifestSystemPath = `${umbreld.instance.dataDirectory}/home/.${claimId}.json.umbrel-trash`
	await fse.writeFile(originalSystemPath, 'claimed bytes')
	const stats = await lstat(originalSystemPath, {bigint: true})
	await fse.writeJson(manifestSystemPath, {
		version: 1,
		originalSystemPath,
		revision: {
			inode: stats.ino.toString(),
			size: Number(stats.size),
			modifiedNs: stats.mtimeNs.toString(),
			ctimeNs: stats.ctimeNs.toString(),
		},
	})
	await rename(originalSystemPath, claimSystemPath)
	await rename(claimSystemPath, trashSystemPath)
	await fse.writeFile(originalSystemPath, 'replacement bytes')

	await expect(umbreld.instance.files.recoverTrashClaim('/Home/replaced-after-claim.jpg', OWNER_USER_ID)).resolves.toBe(
		false,
	)
	await expect(fse.readFile(originalSystemPath, 'utf8')).resolves.toBe('replacement bytes')
	await expect(fse.readFile(trashSystemPath, 'utf8')).resolves.toBe('claimed bytes')
	await expect(fse.pathExists(manifestSystemPath)).resolves.toBe(false)

	await fse.remove(originalSystemPath)
	await fse.remove(trashSystemPath)
})

test('recoverTrashClaim() completes an interrupted hard-link restoration', async () => {
	const originalSystemPath = `${umbreld.instance.dataDirectory}/home/interrupted-hard-link.jpg`
	const claimId = createHash('sha256').update(originalSystemPath).digest('hex').slice(0, 32)
	const claimSystemPath = `${umbreld.instance.dataDirectory}/home/.${claimId}.umbrel-trash`
	const manifestSystemPath = `${umbreld.instance.dataDirectory}/home/.${claimId}.json.umbrel-trash`
	await fse.writeFile(claimSystemPath, 'claimed bytes')
	const stats = await lstat(claimSystemPath, {bigint: true})
	await fse.writeJson(manifestSystemPath, {
		version: 1,
		originalSystemPath,
		revision: {
			inode: stats.ino.toString(),
			size: Number(stats.size),
			modifiedNs: stats.mtimeNs.toString(),
			ctimeNs: stats.ctimeNs.toString(),
		},
	})
	await link(claimSystemPath, originalSystemPath)

	await expect(
		umbreld.instance.files.recoverTrashClaim('/Home/interrupted-hard-link.jpg', OWNER_USER_ID),
	).resolves.toBe(true)
	await expect(fse.readFile(originalSystemPath, 'utf8')).resolves.toBe('claimed bytes')
	await expect(fse.pathExists(claimSystemPath)).resolves.toBe(false)
	await expect(fse.pathExists(manifestSystemPath)).resolves.toBe(false)
	await fse.remove(originalSystemPath)
})

test('trash() serializes concurrent claims for the same revision', async () => {
	const originalSystemPath = `${umbreld.instance.dataDirectory}/home/concurrent-photo.jpg`
	const trashSystemPath = `${umbreld.instance.dataDirectory}/trash/concurrent-photo.jpg`
	await fse.writeFile(originalSystemPath, 'claimed once')
	const stats = await lstat(originalSystemPath, {bigint: true})
	const revision = {
		inode: stats.ino.toString(),
		size: Number(stats.size),
		modifiedNs: stats.mtimeNs.toString(),
		ctimeNs: stats.ctimeNs.toString(),
	}

	const results = await Promise.allSettled([
		umbreld.instance.files.trash('/Home/concurrent-photo.jpg', OWNER_USER_ID, revision),
		umbreld.instance.files.trash('/Home/concurrent-photo.jpg', OWNER_USER_ID, revision),
	])
	expect(results.filter(({status}) => status === 'fulfilled')).toHaveLength(1)
	expect(results.filter(({status}) => status === 'rejected')).toHaveLength(1)
	await expect(fse.readFile(trashSystemPath, 'utf8')).resolves.toBe('claimed once')
	expect((await fse.readdir(nodePath.dirname(originalSystemPath))).some((name) => name.endsWith('.umbrel-trash'))).toBe(
		false,
	)

	await fse.remove(trashSystemPath)
	await fse.remove(`${umbreld.instance.dataDirectory}/trash-meta/concurrent-photo.jpg.json`)
})

test('recoverTrashClaim() preserves both files when the original name is occupied', async () => {
	const originalSystemPath = `${umbreld.instance.dataDirectory}/home/interrupted-conflict.jpg`
	const claimId = createHash('sha256').update(originalSystemPath).digest('hex').slice(0, 32)
	const claimSystemPath = `${umbreld.instance.dataDirectory}/home/.${claimId}.umbrel-trash`
	const manifestSystemPath = `${umbreld.instance.dataDirectory}/home/.${claimId}.json.umbrel-trash`
	await fse.writeFile(claimSystemPath, 'claimed bytes')
	const stats = await lstat(claimSystemPath, {bigint: true})
	await fse.writeJson(manifestSystemPath, {
		version: 1,
		originalSystemPath,
		revision: {
			inode: stats.ino.toString(),
			size: Number(stats.size),
			modifiedNs: stats.mtimeNs.toString(),
			ctimeNs: stats.ctimeNs.toString(),
		},
	})
	await fse.writeFile(originalSystemPath, 'replacement bytes')

	await expect(umbreld.instance.files.recoverTrashClaim('/Home/interrupted-conflict.jpg', OWNER_USER_ID)).resolves.toBe(
		true,
	)
	await expect(fse.readFile(originalSystemPath, 'utf8')).resolves.toBe('replacement bytes')
	await expect(fse.readFile(`${umbreld.instance.dataDirectory}/trash/interrupted-conflict.jpg`, 'utf8')).resolves.toBe(
		'claimed bytes',
	)
	await expect(fse.pathExists(claimSystemPath)).resolves.toBe(false)
	await expect(fse.pathExists(manifestSystemPath)).resolves.toBe(false)
	await fse.remove(originalSystemPath)
	await fse.remove(`${umbreld.instance.dataDirectory}/trash/interrupted-conflict.jpg`)
	await fse.remove(`${umbreld.instance.dataDirectory}/trash-meta/interrupted-conflict.jpg.json`)
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
