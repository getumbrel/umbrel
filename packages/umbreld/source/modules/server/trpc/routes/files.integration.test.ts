import {setTimeout as sleep} from 'node:timers/promises'

import {expect, beforeAll, afterAll, test, describe} from 'vitest'
import {$} from 'execa'

import createTestUmbreld from '../../../test-utilities/create-test-umbreld.js'
import fse from 'fs-extra'
import temporaryDirectory from '../../../utilities/temporary-directory.js'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>

beforeAll(async () => {
	umbreld = await createTestUmbreld()
})

afterAll(async () => {
	await umbreld.cleanup()
})

// Helpers to keep track of the expected file structure

const notedFiles = {} as Record<string, Record<string, Record<string, any>>>

function note(path: string, props: Record<string, any>) {
	const noteDirectory = (path: string) => {
		const pos = path.lastIndexOf('/')
		if (pos > 0) {
			const parentPath = path.slice(0, pos)
			noteDirectory(parentPath)
			note(path, {type: 'directory'})
		}
		notedFiles[path] ||= {}
		return notedFiles[path]
	}
	const pos = path.lastIndexOf('/')
	if (pos > 0) {
		const parentPath = path.slice(0, pos)
		const files = noteDirectory(parentPath)
		const name = path.slice(pos + 1)
		files[name] = props
	} else if (props.type === 'directory') {
		notedFiles[path] ||= {}
	} else {
		throw new Error('Root cannot contain files')
	}
}

function undo(path: string) {
	delete notedFiles[path]
	const pos = path.lastIndexOf('/')
	if (pos > 0) {
		const files = notedFiles[path.slice(0, pos)]
		if (files) delete files[path.slice(pos + 1)]
	}
}

async function expectNoted() {
	for (const directory of Object.keys(notedFiles)) {
		const expectItems = []
		for (const [name, props] of Object.entries(notedFiles[directory])) {
			expectItems.push(expect.objectContaining({name, ...props}))
		}
		const query = umbreld.client.files.list.query({path: directory})
		await expect(query, `Directory ${directory}`).resolves.toEqual(
			expect.objectContaining({
				items: expect.arrayContaining(expectItems),
			}),
		)
		const items = (await query).items
		await expect(items, `Directory ${directory}`).toHaveLength(expectItems.length)
	}
}

// Reusable fixtures

const invalidPaths = {
	// See Files#validateVirtualPath for the rationale
	'\0': 'Path must not contain invalid characters',
	'': 'Path must be absolute',
	' ': 'Path must be absolute',
	'.': 'Path must be absolute',
	'..': 'Path must be absolute',
	Data: 'Path must be absolute',
	'/./DoesNotExist': 'Cannot map',
	'/../DoesNotExist': 'Cannot map',
}

const invalidFilenames = {
	// File names are trimmed to their base names, in turn limiting possible
	// errors to empty names, exact traversal patterns and invalid characters.
	'': 'Filename must not be empty',
	' ': 'Filename must not be empty',
	'/': 'Filename must not be empty',
	'.': 'Filename must not contain traversal patterns',
	'..': 'Filename must not contain traversal patterns',
	'dir/': 'Filename must not contain redundant characters',
	'dir/file': 'Filename must not contain redundant characters',
	'dir/..': 'Filename must not contain redundant characters',
	'dir/.': 'Filename must not contain redundant characters',
	'../file': 'Filename must not contain redundant characters',
	'./file': 'Filename must not contain redundant characters',
	'<file>': 'Filename must not contain reserved characters',
	'*': 'Filename must not contain reserved characters',
	'a:b': 'Filename must not contain reserved characters',
	'"abc"': 'Filename must not contain reserved characters',
	'cmd |': 'Filename must not contain reserved characters',
	'que?': 'Filename must not contain reserved characters',
	'dir\\file': 'Filename must not contain reserved characters',
	'eof\0': 'Filename must not contain reserved characters',
}

// The following tests are stateful and must be run in order

describe.sequential('preferences', () => {
	test.sequential('throws when not logged in', async () => {
		await umbreld.ensureLoggedOut()
		await expect(umbreld.client.files.preferences.query()).rejects.toThrow('Invalid token')
		await umbreld.ensureLoggedIn()
	})

	test.sequential('returns default preferences', async () => {
		await expect(umbreld.client.files.preferences.query()).resolves.toEqual({
			view: 'icons',
			sortBy: 'name',
			sortOrder: 'asc',
		})
	})

	test.sequential('returns updated preferences', async () => {
		await expect(
			umbreld.client.files.setPreferences.mutate({view: 'icons', sortBy: 'size', sortOrder: 'desc'}),
		).resolves.toBe(true)
		await expect(umbreld.client.files.preferences.query()).resolves.toEqual({
			view: 'icons',
			sortBy: 'size',
			sortOrder: 'desc',
		})
	})

	test.sequential('returns partially updated preferences', async () => {
		await expect(umbreld.client.files.setPreferences.mutate({view: 'list'})).resolves.toBe(true)
		await expect(umbreld.client.files.preferences.query()).resolves.toEqual({
			view: 'list',
			sortBy: 'size',
			sortOrder: 'desc',
		})
	})
})

describe.sequential('list', () => {
	test.sequential('throws when not logged in', async () => {
		await umbreld.ensureLoggedOut()
		await expect(umbreld.client.files.list.query({path: '/'})).rejects.toThrow('Invalid token')
		await umbreld.ensureLoggedIn()
	})

	test.sequential('throws on invalid paths', async () => {
		for (const [invalidPath, message] of Object.entries(invalidPaths)) {
			await expect(umbreld.client.files.list.query({path: invalidPath}), `Pattern '${invalidPath}'`).rejects.toThrow(
				message,
			)
		}
	})

	test.sequential('lists the root directory', async () => {
		const expected = {
			count: 100,
			items: [
				{
					name: 'Apps',
					path: '/Apps',
					type: 'directory',
					size: expect.any(Number),
					created: expect.any(String),
					modified: expect.any(String),
					ops: expect.any(Number),
				},
				{
					name: 'External',
					path: '/External',
					type: 'directory',
					size: expect.any(Number),
					created: expect.any(String),
					modified: expect.any(String),
					ops: expect.any(Number),
				},
				{
					name: 'Home',
					path: '/Home',
					type: 'directory',
					size: expect.any(Number),
					created: expect.any(String),
					modified: expect.any(String),
					ops: expect.any(Number),
				},
				{
					name: 'Trash',
					path: '/Trash',
					type: 'directory',
					size: expect.any(Number),
					created: expect.any(String),
					modified: expect.any(String),
					ops: expect.any(Number),
				},
			],
			start: 0,
			stats: {
				name: '',
				path: '/',
				type: 'directory',
				ops: 0,
			},
			total: 4,
		}
		const query = umbreld.client.files.list.query({path: '/'})
		await expect(query).resolves.toMatchObject(expected)
		for (const item of (await query).items) {
			note(item.path, {type: item.type})
		}
	})

	test.sequential('lists the /Home directory', async () => {
		const query = umbreld.client.files.list.query({path: '/Home'})
		await expect(query).resolves.toMatchObject({
			items: expect.arrayContaining([expect.objectContaining({name: 'Documents', type: 'directory'})]),
		})
		for (const item of (await query).items) {
			note(item.path, {type: item.type})
		}

		await expectNoted()
	})

	test.sequential('throws on symlink traversal attempt', async () => {
		await $`ln -s / ${umbreld.instance.files.homeDirectory}/symlink-to-root`
		note('/Home/symlink-to-root', {type: 'symbolic-link'})

		await expect(umbreld.client.files.list.query({path: '/Home/symlink-to-root'})).rejects.toThrow(
			'Canonical target must not escape canonical base path',
		)

		await expectNoted()
	})

	test.sequential('lists files in expected order', async () => {
		await fse.mkdir(`${umbreld.instance.files.homeDirectory}/Order`)
		note('/Home/Order', {type: 'directory'})
		await sleep(100)
		await fse.writeFile(`${umbreld.instance.files.homeDirectory}/Order/1`, '1')
		note('/Home/Order/1', {type: 'application/octet-stream'})
		await sleep(100)
		await fse.mkdir(`${umbreld.instance.files.homeDirectory}/Order/2`)
		note('/Home/Order/2', {type: 'directory'})
		await sleep(100)
		await fse.writeFile(`${umbreld.instance.files.homeDirectory}/Order/4`, '4_')
		note('/Home/Order/4', {type: 'application/octet-stream'})
		await sleep(100)
		await fse.writeFile(`${umbreld.instance.files.homeDirectory}/Order/3`, '3')
		note('/Home/Order/3', {type: 'application/octet-stream'})

		await expectNoted()

		await expect(
			umbreld.client.files.list.query({path: '/Home/Order', sortBy: 'name', sortOrder: 'asc'}),
		).resolves.toMatchObject({
			items: [
				expect.objectContaining({name: '1', type: 'application/octet-stream'}),
				expect.objectContaining({name: '2', type: 'directory'}),
				expect.objectContaining({name: '3', type: 'application/octet-stream'}),
				expect.objectContaining({name: '4', type: 'application/octet-stream'}),
			],
		})

		await expect(
			umbreld.client.files.list.query({path: '/Home/Order', sortBy: 'name', sortOrder: 'desc'}),
		).resolves.toMatchObject({
			items: [
				expect.objectContaining({name: '4', type: 'application/octet-stream'}),
				expect.objectContaining({name: '3', type: 'application/octet-stream'}),
				expect.objectContaining({name: '2', type: 'directory'}),
				expect.objectContaining({name: '1', type: 'application/octet-stream'}),
			],
		})

		await expect(
			umbreld.client.files.list.query({path: '/Home/Order', sortBy: 'size', sortOrder: 'asc'}),
		).resolves.toMatchObject({
			items: [
				expect.objectContaining({name: '1', type: 'application/octet-stream'}),
				expect.objectContaining({name: '3', type: 'application/octet-stream'}),
				expect.objectContaining({name: '4', type: 'application/octet-stream'}),
				expect.objectContaining({name: '2', type: 'directory'}),
			],
		})

		await expect(
			umbreld.client.files.list.query({path: '/Home/Order', sortBy: 'size', sortOrder: 'desc'}),
		).resolves.toMatchObject({
			items: [
				expect.objectContaining({name: '2', type: 'directory'}),
				expect.objectContaining({name: '4', type: 'application/octet-stream'}),
				expect.objectContaining({name: '3', type: 'application/octet-stream'}),
				expect.objectContaining({name: '1', type: 'application/octet-stream'}),
			],
		})

		await expect(
			umbreld.client.files.list.query({path: '/Home/Order', sortBy: 'created', sortOrder: 'asc'}),
		).resolves.toMatchObject({
			items: [
				expect.objectContaining({name: '1', type: 'application/octet-stream'}),
				expect.objectContaining({name: '2', type: 'directory'}),
				expect.objectContaining({name: '4', type: 'application/octet-stream'}),
				expect.objectContaining({name: '3', type: 'application/octet-stream'}),
			],
		})

		await expect(
			umbreld.client.files.list.query({path: '/Home/Order', sortBy: 'created', sortOrder: 'desc'}),
		).resolves.toMatchObject({
			items: [
				expect.objectContaining({name: '3', type: 'application/octet-stream'}),
				expect.objectContaining({name: '4', type: 'application/octet-stream'}),
				expect.objectContaining({name: '2', type: 'directory'}),
				expect.objectContaining({name: '1', type: 'application/octet-stream'}),
			],
		})

		await $`touch ${umbreld.instance.files.homeDirectory}/Order/1`

		await expect(
			umbreld.client.files.list.query({path: '/Home/Order', sortBy: 'modified', sortOrder: 'asc'}),
		).resolves.toMatchObject({
			items: [
				expect.objectContaining({name: '2', type: 'directory'}),
				expect.objectContaining({name: '4', type: 'application/octet-stream'}),
				expect.objectContaining({name: '3', type: 'application/octet-stream'}),
				expect.objectContaining({name: '1', type: 'application/octet-stream'}),
			],
		})

		await expect(
			umbreld.client.files.list.query({path: '/Home/Order', sortBy: 'modified', sortOrder: 'desc'}),
		).resolves.toMatchObject({
			items: [
				expect.objectContaining({name: '1', type: 'application/octet-stream'}),
				expect.objectContaining({name: '3', type: 'application/octet-stream'}),
				expect.objectContaining({name: '4', type: 'application/octet-stream'}),
				expect.objectContaining({name: '2', type: 'directory'}),
			],
		})

		await fse.writeFile(`${umbreld.instance.files.homeDirectory}/Order/5.txt`, '5')
		note('/Home/Order/5.txt', {type: 'text/plain'})

		await expectNoted()

		await expect(
			umbreld.client.files.list.query({path: '/Home/Order', sortBy: 'type', sortOrder: 'asc'}),
		).resolves.toMatchObject({
			items: [
				expect.objectContaining({name: '1', type: 'application/octet-stream'}),
				expect.objectContaining({name: '3', type: 'application/octet-stream'}),
				expect.objectContaining({name: '4', type: 'application/octet-stream'}),
				expect.objectContaining({name: '2', type: 'directory'}),
				expect.objectContaining({name: '5.txt', type: 'text/plain'}),
			],
		})

		await expect(
			umbreld.client.files.list.query({path: '/Home/Order', sortBy: 'type', sortOrder: 'desc'}),
		).resolves.toMatchObject({
			items: [
				expect.objectContaining({name: '5.txt', type: 'text/plain'}),
				expect.objectContaining({name: '2', type: 'directory'}),
				expect.objectContaining({name: '4', type: 'application/octet-stream'}),
				expect.objectContaining({name: '3', type: 'application/octet-stream'}),
				expect.objectContaining({name: '1', type: 'application/octet-stream'}),
			],
		})

		await expectNoted()

		await fse.remove(`${umbreld.instance.files.homeDirectory}/Order`)
		undo('/Home/Order')

		await expectNoted()
	})

	test.sequential('ignores .DS_Store in directory listings', async () => {
		await fse.writeFile(`${umbreld.instance.files.homeDirectory}/.DS_Store`, 'DS_Store content')

		const query = umbreld.client.files.list.query({path: '/Home'})
		await expect(query).resolves.not.toMatchObject({
			items: expect.arrayContaining([expect.objectContaining({name: '.DS_Store'})]),
		})
	})

	test.sequential('ignores .directory in directory listings', async () => {
		await fse.writeFile(`${umbreld.instance.files.homeDirectory}/.directory`, 'directory content')

		const query = umbreld.client.files.list.query({path: '/Home'})
		await expect(query).resolves.not.toMatchObject({
			items: expect.arrayContaining([expect.objectContaining({name: '.directory'})]),
		})
	})
})

describe.sequential('createDirectory', () => {
	test.sequential('throws when not logged in', async () => {
		await umbreld.ensureLoggedOut()
		await expect(umbreld.client.files.createDirectory.mutate({path: '/Home', name: 'NewDirectory'})).rejects.toThrow(
			'Invalid token',
		)
		await umbreld.ensureLoggedIn()
	})

	test.sequential('throws on invalid paths', async () => {
		for (const [invalidPath, message] of Object.entries(invalidPaths)) {
			await expect(
				umbreld.client.files.createDirectory.mutate({path: invalidPath, name: 'TargetDirectory'}),
				`Pattern '${invalidPath}'`,
			).rejects.toThrow(message)
		}
	})

	test.sequential('throws on invalid directory names', async () => {
		for (const [invalidFilename, message] of Object.entries(invalidFilenames)) {
			await expect(
				umbreld.client.files.createDirectory.mutate({path: '/Home', name: invalidFilename}),
				`Pattern '${invalidFilename}'`,
			).rejects.toThrow(message)
		}
	})

	test.sequential('creates a directory', async () => {
		await expect(umbreld.client.files.createDirectory.mutate({path: '/Home', name: 'TargetDirectory'})).resolves.toBe(
			'/Home/TargetDirectory',
		)
		note('/Home/TargetDirectory', {type: 'directory'})

		await expectNoted()
	})

	test.sequential('throws when the parent directory does not exist', async () => {
		await expect(
			umbreld.client.files.createDirectory.mutate({path: '/Home/DoesNotExist', name: 'TargetDirectory'}),
		).rejects.toThrow('ENOENT')
	})

	test.sequential('does not throw when the directory already exists', async () => {
		await expect(umbreld.client.files.createDirectory.mutate({path: '/Home', name: 'TargetDirectory'})).resolves.toBe(
			'/Home/TargetDirectory',
		)

		await expectNoted()
	})

	test.sequential('throws when trying to create a directory at a non-directory', async () => {
		await fse.writeFile(`${umbreld.instance.files.homeDirectory}/CreateDirectory`, 'CreateDirectory')
		note('/Home/CreateDirectory', {type: 'application/octet-stream'})

		await expect(umbreld.client.files.createDirectory.mutate({path: '/Home', name: 'CreateDirectory'})).rejects.toThrow(
			'ENOTDIR',
		)

		await expectNoted()
	})

	test.sequential('throws when the parent is not a directory', async () => {
		await expect(
			umbreld.client.files.createDirectory.mutate({path: '/Home/CreateDirectory', name: 'TargetDirectory'}),
		).rejects.toThrow('ENOTDIR')

		await expectNoted()
	})
})

describe.sequential('copy', () => {
	test.sequential('throws when not logged in', async () => {
		await umbreld.ensureLoggedOut()
		await expect(
			umbreld.client.files.copy.mutate({path: '/Home/Test.txt', toDirectory: '/Home/TargetDirectory'}),
		).rejects.toThrow('Invalid token')
		await umbreld.ensureLoggedIn()
	})

	test.sequential('throws on invalid paths', async () => {
		for (const [invalidPath, message] of Object.entries(invalidPaths)) {
			await expect(
				umbreld.client.files.copy.mutate({path: invalidPath, toDirectory: '/Home/TargetDirectory'}),
				`Pattern '${invalidPath}'`,
			).rejects.toThrow(message)
		}
	})

	test.sequential('throws on invalid target paths', async () => {
		for (const [invalidPath, message] of Object.entries(invalidPaths)) {
			await expect(
				umbreld.client.files.copy.mutate({path: '/Home/Test.txt', toDirectory: invalidPath}),
				`Pattern '${invalidPath}'`,
			).rejects.toThrow(message)
		}
	})

	test.sequential('throws when the source file or directory does not exist', async () => {
		await expect(
			umbreld.client.files.copy.mutate({path: '/Home/DoesNotExist', toDirectory: '/Home/TargetDirectory'}),
		).rejects.toThrow('ENOENT')

		await expectNoted()
	})

	test.sequential('copies a file to another directory', async () => {
		await fse.writeFile(`${umbreld.instance.files.homeDirectory}/Test.txt`, 'Test')
		note('/Home/Test.txt', {type: 'text/plain'})

		await expect(
			umbreld.client.files.copy.mutate({path: '/Home/Test.txt', toDirectory: '/Home/TargetDirectory'}),
		).resolves.toBe(true)
		note('/Home/TargetDirectory/Test.txt', {type: 'text/plain'})

		await expectNoted()
	})

	test.sequential('handles existing files by adding a suffix', async () => {
		await expect(
			umbreld.client.files.copy.mutate({path: '/Home/Test.txt', toDirectory: '/Home/TargetDirectory'}),
		).resolves.toBe(true)
		note('/Home/TargetDirectory/Test (2).txt', {type: 'text/plain'})

		await expectNoted()
	})

	test.sequential('copies a directory to another directory', async () => {
		await fse.mkdir(`${umbreld.instance.files.homeDirectory}/TestDirectory`)
		await fse.writeFile(`${umbreld.instance.files.homeDirectory}/TestDirectory/Test2.txt`, 'Test2')
		note('/Home/TestDirectory/Test2.txt', {type: 'text/plain'})

		await expect(
			umbreld.client.files.copy.mutate({path: '/Home/TestDirectory', toDirectory: '/Home/TargetDirectory'}),
		).resolves.toBe(true)
		note('/Home/TargetDirectory/TestDirectory/Test2.txt', {type: 'text/plain'})

		await expect(
			fse.readFile(`${umbreld.instance.files.homeDirectory}/TargetDirectory/TestDirectory/Test2.txt`, 'utf8'),
		).resolves.toBe('Test2')

		await expectNoted()
	})

	test.sequential('throws instead of overwriting directory contents', async () => {
		await expect(
			umbreld.client.files.copy.mutate({path: '/Home/TestDirectory', toDirectory: '/Home/TargetDirectory'}),
		).resolves.toBe(true)
		note('/Home/TargetDirectory/TestDirectory (2)/Test2.txt', {type: 'text/plain'})

		await expectNoted()
	})

	test.sequential('throws when trying to copy a directory into itself', async () => {
		await expect(
			umbreld.client.files.copy.mutate({path: '/Home/TargetDirectory', toDirectory: '/Home/TargetDirectory'}),
		).rejects.toThrow('EINVAL')

		await expectNoted()
	})

	test.sequential('throws when trying to copy a base directory', async () => {
		await expect(umbreld.client.files.copy.mutate({path: '/Trash', toDirectory: '/Home'})).rejects.toThrow('ENOTSUP')

		await expectNoted()
	})
})

describe.sequential('move', () => {
	test.sequential('throws when not logged in', async () => {
		await umbreld.ensureLoggedOut()
		await expect(
			umbreld.client.files.move.mutate({path: '/Home/Test.txt', toDirectory: '/Home/TargetDirectory'}),
		).rejects.toThrow('Invalid token')
		await umbreld.ensureLoggedIn()
	})

	test.sequential('throws on invalid paths', async () => {
		for (const [invalidPath, message] of Object.entries(invalidPaths)) {
			await expect(
				umbreld.client.files.move.mutate({path: invalidPath, toDirectory: '/Home/TargetDirectory'}),
				`Pattern '${invalidPath}'`,
			).rejects.toThrow(message)
		}
	})

	test.sequential('throws on invalid target paths', async () => {
		for (const [invalidPath, message] of Object.entries(invalidPaths)) {
			await expect(
				umbreld.client.files.move.mutate({path: '/Home/Test.txt', toDirectory: invalidPath}),
				`Pattern '${invalidPath}'`,
			).rejects.toThrow(message)
		}
	})

	test.sequential('throws when the source file or directory does not exist', async () => {
		await expect(
			umbreld.client.files.move.mutate({path: '/Home/DoesNotExist', toDirectory: '/Home/TargetDirectory'}),
		).rejects.toThrow('ENOENT')

		await expectNoted()
	})

	test.sequential('moves a file to another directory', async () => {
		await fse.writeFile(`${umbreld.instance.files.homeDirectory}/Move.txt`, 'MoveMe')
		note('/Home/Move.txt', {type: 'text/plain'})

		await expect(
			umbreld.client.files.move.mutate({path: '/Home/Move.txt', toDirectory: '/Home/TargetDirectory'}),
		).resolves.toBe(true)
		note('/Home/TargetDirectory/Move.txt', {type: 'text/plain'})
		undo('/Home/Move.txt')

		await expectNoted()
	})

	test.sequential('throws instead of overwriting a file', async () => {
		await fse.writeFile(`${umbreld.instance.files.homeDirectory}/TargetDirectory/Overwrite.txt`, 'Overwrite-1')
		note('/Home/TargetDirectory/Overwrite.txt', {type: 'text/plain'})

		await fse.writeFile(`${umbreld.instance.files.homeDirectory}/Overwrite.txt`, 'Overwrite-2')
		note('/Home/Overwrite.txt', {type: 'text/plain'})

		await expect(
			umbreld.client.files.move.mutate({path: '/Home/Overwrite.txt', toDirectory: '/Home/TargetDirectory'}),
		).rejects.toThrow('EEXIST')

		await expectNoted()
	})

	test.sequential('overwrites a file when explicitly requested', async () => {
		await expect(
			umbreld.client.files.move.mutate({
				path: '/Home/Overwrite.txt',
				toDirectory: '/Home/TargetDirectory',
				overwrite: true,
			}),
		).resolves.toBe(true)
		undo('/Home/Overwrite.txt')

		await expect(
			fse.readFile(`${umbreld.instance.files.homeDirectory}/TargetDirectory/Overwrite.txt`, 'utf8'),
		).resolves.toBe('Overwrite-2')

		await expectNoted()
	})

	test.sequential('moves a directory to another directory', async () => {
		await fse.mkdir(`${umbreld.instance.files.homeDirectory}/MoveDirectory`)
		note('/Home/MoveDirectory', {type: 'directory'})

		await expect(
			umbreld.client.files.move.mutate({path: '/Home/MoveDirectory', toDirectory: '/Home/TargetDirectory'}),
		).resolves.toBe(true)
		note('/Home/TargetDirectory/MoveDirectory', {type: 'directory'})
		undo('/Home/MoveDirectory')

		await expectNoted()
	})

	test.sequential('throws instead of overwriting a directory', async () => {
		await fse.mkdir(`${umbreld.instance.files.homeDirectory}/TargetDirectory/OverwriteDirectory`)
		note('/Home/TargetDirectory/OverwriteDirectory', {type: 'directory'})

		await fse.mkdir(`${umbreld.instance.files.homeDirectory}/OverwriteDirectory`)
		note('/Home/OverwriteDirectory', {type: 'directory'})

		await expect(
			umbreld.client.files.move.mutate({path: '/Home/OverwriteDirectory', toDirectory: '/Home/TargetDirectory'}),
		).rejects.toThrow('EEXIST')

		await expectNoted()
	})

	test.sequential('overwrites a directory when explicitly requested', async () => {
		await expect(
			umbreld.client.files.move.mutate({
				path: '/Home/OverwriteDirectory',
				toDirectory: '/Home/TargetDirectory',
				overwrite: true,
			}),
		).resolves.toBe(true)
		undo('/Home/OverwriteDirectory')

		await expectNoted()
	})

	test.sequential('throws when trying to overwrite a file with a directory', async () => {
		await fse.writeFile(
			`${umbreld.instance.files.homeDirectory}/TargetDirectory/MoveDirectoryHere`,
			'MoveDirectoryHere',
		)
		note('/Home/TargetDirectory/MoveDirectoryHere', {type: 'application/octet-stream'})

		await fse.mkdir(`${umbreld.instance.files.homeDirectory}/MoveDirectoryHere`)
		note('/Home/MoveDirectoryHere', {type: 'directory'})

		await expect(
			umbreld.client.files.move.mutate({
				path: '/Home/MoveDirectoryHere',
				toDirectory: '/Home/TargetDirectory',
				overwrite: true,
			}),
		).rejects.toThrow('ENOTDIR')

		await expectNoted()
	})

	test.sequential('throws when trying to overwrite a directory with a file', async () => {
		await fse.mkdir(`${umbreld.instance.files.homeDirectory}/TargetDirectory/MoveFileHere`)
		note('/Home/TargetDirectory/MoveFileHere', {type: 'directory'})

		await fse.writeFile(`${umbreld.instance.files.homeDirectory}/MoveFileHere`, 'MoveFileHere')
		note('/Home/MoveFileHere', {type: 'application/octet-stream'})

		await expect(
			umbreld.client.files.move.mutate({
				path: '/Home/MoveFileHere',
				toDirectory: '/Home/TargetDirectory',
				overwrite: true,
			}),
		).rejects.toThrow('EISDIR')

		await expectNoted()
	})

	test.sequential('throws when trying to move a directory into itself', async () => {
		await expect(
			umbreld.client.files.move.mutate({path: '/Home/TargetDirectory', toDirectory: '/Home/TargetDirectory'}),
		).rejects.toThrow('EINVAL')

		await expectNoted()
	})

	test.sequential('throws when trying to move a base directory', async () => {
		await expect(
			umbreld.client.files.move.mutate({path: '/Home', toDirectory: '/Home/TargetDirectory'}),
		).rejects.toThrow('Cannot move a base directory')

		await expectNoted()
	})
})

describe.sequential('rename', () => {
	test.sequential('throws when not logged in', async () => {
		await umbreld.ensureLoggedOut()
		await expect(umbreld.client.files.rename.mutate({path: '/Home/Test.txt', toName: 'Test2.txt'})).rejects.toThrow(
			'Invalid token',
		)
		await umbreld.ensureLoggedIn()
	})

	test.sequential('throws on invalid paths', async () => {
		for (const [invalidPath, message] of Object.entries(invalidPaths)) {
			await expect(
				umbreld.client.files.rename.mutate({path: invalidPath, toName: 'Target'}),
				`Pattern '${invalidPath}'`,
			).rejects.toThrow(message)
		}
	})

	test.sequential('throws on invalid target names', async () => {
		for (const [invalidFilename, message] of Object.entries(invalidFilenames)) {
			await expect(
				umbreld.client.files.rename.mutate({path: '/Home/Test.txt', toName: invalidFilename}),
				`Pattern '${invalidFilename}'`,
			).rejects.toThrow(message)
		}
	})

	test.sequential('throws when the source file or directory does not exist', async () => {
		await expect(
			umbreld.client.files.rename.mutate({path: '/Home/DoesNotExist', toName: 'DoesNotExist'}),
		).rejects.toThrow('ENOENT')

		await expectNoted()
	})

	test.sequential('renames a file within a directory', async () => {
		await fse.writeFile(`${umbreld.instance.files.homeDirectory}/Rename.txt`, 'Rename')
		note('/Home/Rename.txt', {type: 'text/plain'})

		await expect(umbreld.client.files.rename.mutate({path: '/Home/Rename.txt', toName: 'Renamed.txt'})).resolves.toBe(
			'/Home/Renamed.txt',
		)
		note('/Home/Renamed.txt', {type: 'text/plain'})
		undo('/Home/Rename.txt')

		await expectNoted()
	})

	test.sequential('throws instead of overwriting a file', async () => {
		await fse.writeFile(`${umbreld.instance.files.homeDirectory}/Rename.txt`, 'Rename-2')
		note('/Home/Rename.txt', {type: 'text/plain'})

		await expect(umbreld.client.files.rename.mutate({path: '/Home/Rename.txt', toName: 'Renamed.txt'})).rejects.toThrow(
			'EEXIST',
		)

		await expectNoted()
	})

	test.sequential('overwrites a file when explicitly requested', async () => {
		await expect(
			umbreld.client.files.rename.mutate({path: '/Home/Rename.txt', toName: 'Renamed.txt', overwrite: true}),
		).resolves.toBe('/Home/Renamed.txt')
		note('/Home/Renamed.txt', {type: 'text/plain'})
		undo('/Home/Rename.txt')

		await expect(fse.readFile(`${umbreld.instance.files.homeDirectory}/Renamed.txt`, 'utf8')).resolves.toBe('Rename-2')

		await expectNoted()
	})

	test.sequential('renames a directory within a directory', async () => {
		await fse.mkdir(`${umbreld.instance.files.homeDirectory}/RenameDirectory`)
		note('/Home/RenameDirectory', {type: 'directory'})

		await expect(
			umbreld.client.files.rename.mutate({path: '/Home/RenameDirectory', toName: 'RenamedDirectory'}),
		).resolves.toBe('/Home/RenamedDirectory')
		note('/Home/RenamedDirectory', {type: 'directory'})
		undo('/Home/RenameDirectory')

		await expectNoted()
	})

	test.sequential('throws instead of overwriting a directory', async () => {
		await fse.mkdir(`${umbreld.instance.files.homeDirectory}/RenameDirectory`)
		note('/Home/RenameDirectory', {type: 'directory'})

		await expect(
			umbreld.client.files.rename.mutate({path: '/Home/RenameDirectory', toName: 'RenamedDirectory'}),
		).rejects.toThrow('EEXIST')

		await expectNoted()
	})

	test.sequential('overwrites a directory when explicitly requested', async () => {
		await expect(
			umbreld.client.files.rename.mutate({path: '/Home/RenameDirectory', toName: 'RenamedDirectory', overwrite: true}),
		).resolves.toBe('/Home/RenamedDirectory')
		note('/Home/RenamedDirectory', {type: 'directory'})
		undo('/Home/RenameDirectory')

		await expectNoted()
	})

	test.sequential('throws when trying to overwrite a directory with a file', async () => {
		await fse.writeFile(`${umbreld.instance.files.homeDirectory}/Rename.txt`, 'Rename')
		note('/Home/Rename.txt', {type: 'text/plain'})

		await expect(
			umbreld.client.files.rename.mutate({path: '/Home/Rename.txt', toName: 'RenamedDirectory', overwrite: true}),
		).rejects.toThrow('EISDIR')

		await expectNoted()
	})

	test.sequential('throws when trying to overwrite a file with a directory', async () => {
		await fse.mkdir(`${umbreld.instance.files.homeDirectory}/RenameDirectory`)
		note('/Home/RenameDirectory', {type: 'directory'})

		await expect(
			umbreld.client.files.rename.mutate({path: '/Home/RenameDirectory', toName: 'Renamed.txt', overwrite: true}),
		).rejects.toThrow('ENOTDIR')

		await expectNoted()
	})

	test.sequential('throws when trying to rename a base directory', async () => {
		await expect(umbreld.client.files.rename.mutate({path: '/Home', toName: 'Renamed'})).rejects.toThrow('ENOTSUP')

		await expectNoted()
	})

	test.sequential('throws when trying to rename Downloads', async () => {
		await expect(umbreld.client.files.rename.mutate({path: '/Home/Downloads', toName: 'Renamed'})).rejects.toThrow(
			'ENOTSUP',
		)

		await expectNoted()
	})

	test.sequential('throws when trying to rename an app data directory', async () => {
		await expect(umbreld.client.files.rename.mutate({path: '/Apps/foo', toName: 'Renamed'})).rejects.toThrow('ENOTSUP')

		await expectNoted()
	})
})

describe.sequential('delete', () => {
	test.sequential('throws when not logged in', async () => {
		await umbreld.ensureLoggedOut()
		await expect(umbreld.client.files.delete.mutate({path: '/Home/Test.txt'})).rejects.toThrow('Invalid token')
		await umbreld.ensureLoggedIn()
	})

	test.sequential('throws on invalid paths', async () => {
		for (const [invalidPath, message] of Object.entries(invalidPaths)) {
			await expect(umbreld.client.files.delete.mutate({path: invalidPath}), `Pattern '${invalidPath}'`).rejects.toThrow(
				message,
			)
		}
	})

	test.sequential('deletes a file', async () => {
		await fse.writeFile(`${umbreld.instance.files.homeDirectory}/Delete.txt`, 'Delete')
		note('/Home/Delete.txt', {type: 'text/plain'})

		await expectNoted()

		await expect(umbreld.client.files.delete.mutate({path: '/Home/Delete.txt'})).resolves.toBe(true)
		undo('/Home/Delete.txt')

		await expectNoted()
	})

	test.sequential('deletes a directory including contents', async () => {
		await fse.mkdir(`${umbreld.instance.files.homeDirectory}/DeleteDirectory`)
		note('/Home/DeleteDirectory', {type: 'directory'})

		await fse.writeFile(`${umbreld.instance.files.homeDirectory}/DeleteDirectory/Delete.txt`, 'Delete')
		note('/Home/DeleteDirectory/Delete.txt', {type: 'text/plain'})

		await expectNoted()

		await expect(umbreld.client.files.delete.mutate({path: '/Home/DeleteDirectory'})).resolves.toBe(true)
		undo('/Home/DeleteDirectory')

		await expectNoted()
	})

	test.sequential('does nothing when a file or directory does not exist', async () => {
		await expect(umbreld.client.files.delete.mutate({path: '/Home/DoesNotExist'})).resolves.toBe(true)

		await expectNoted()
	})

	test.sequential('throws when trying to delete a base directory', async () => {
		await expect(umbreld.client.files.delete.mutate({path: '/Home'})).rejects.toThrow('ENOTSUP')

		await expectNoted()
	})
})

describe.sequential('trash', () => {
	test.sequential('throws when not logged in', async () => {
		await umbreld.ensureLoggedOut()
		await expect(umbreld.client.files.trash.mutate({path: '/Home/Test.txt'})).rejects.toThrow('Invalid token')
		await umbreld.ensureLoggedIn()
	})

	test.sequential('throws on invalid paths', async () => {
		for (const [invalidPath, message] of Object.entries(invalidPaths)) {
			await expect(umbreld.client.files.trash.mutate({path: invalidPath}), `Pattern '${invalidPath}'`).rejects.toThrow(
				message,
			)
		}
	})

	test.sequential('moves a file to trash', async () => {
		await fse.writeFile(`${umbreld.instance.files.homeDirectory}/Trash.txt`, 'Trash')
		note('/Home/Trash.txt', {type: 'text/plain'})

		await expectNoted()

		await expect(umbreld.client.files.trash.mutate({path: '/Home/Trash.txt'})).resolves.toBe(true)
		note('/Trash/Trash.txt', {type: 'text/plain'})
		undo('/Home/Trash.txt')

		await expectNoted()
	})

	test.sequential('moves a directory to trash', async () => {
		await fse.mkdir(`${umbreld.instance.files.homeDirectory}/TrashDirectory`)
		note('/Home/TrashDirectory', {type: 'directory'})

		await fse.writeFile(`${umbreld.instance.files.homeDirectory}/TrashDirectory/Trash.txt`, 'Trash')
		note('/Home/TrashDirectory/Trash.txt', {type: 'text/plain'})

		await expectNoted()

		await expect(umbreld.client.files.trash.mutate({path: '/Home/TrashDirectory'})).resolves.toBe(true)
		note('/Trash/TrashDirectory', {type: 'directory'})
		note('/Trash/TrashDirectory/Trash.txt', {type: 'text/plain'})
		undo('/Home/TrashDirectory')

		await expectNoted()
	})

	test.sequential('throws when trying to trash an already trashed file or directory', async () => {
		await expect(umbreld.client.files.trash.mutate({path: '/Trash/Trash'})).rejects.toThrow('ENOTSUP')

		await expectNoted()
	})

	test.sequential('throws when trying to trash a base directory', async () => {
		await expect(umbreld.client.files.trash.mutate({path: '/Home'})).rejects.toThrow('ENOTSUP')

		await expectNoted()
	})

	test.sequential('throws when trying to trash /Home/Downloads', async () => {
		await expect(umbreld.client.files.trash.mutate({path: '/Home/Downloads'})).rejects.toThrow('ENOTSUP')

		await expectNoted()
	})
})

describe.sequential('restore', () => {
	test.sequential('throws when not logged in', async () => {
		await umbreld.ensureLoggedOut()
		await expect(umbreld.client.files.restore.mutate({path: '/Home/Test.txt'})).rejects.toThrow('Invalid token')
		await umbreld.ensureLoggedIn()
	})

	test.sequential('throws on invalid paths', async () => {
		for (const [invalidPath, message] of Object.entries(invalidPaths)) {
			await expect(
				umbreld.client.files.restore.mutate({path: invalidPath}),
				`Pattern '${invalidPath}'`,
			).rejects.toThrow(message)
		}
	})

	test.sequential('moves a trashed file back to the original location', async () => {
		await expect(umbreld.client.files.restore.mutate({path: '/Trash/Trash.txt'})).resolves.toBe(true)
		note('/Home/Trash.txt', {type: 'text/plain'})
		undo('/Trash/Trash.txt')

		await expectNoted()
	})

	test.sequential('moves a trashed file back to the original location in a subfolder', async () => {
		await fse.mkdir(`${umbreld.instance.files.homeDirectory}/TrashDirectory`)
		await fse.writeFile(`${umbreld.instance.files.homeDirectory}/TrashDirectory/SubTrash.txt`, 'SubTrash')
		note('/Home/TrashDirectory/SubTrash.txt', {type: 'text/plain'})

		await expectNoted()

		await expect(umbreld.client.files.trash.mutate({path: '/Home/TrashDirectory/SubTrash.txt'})).resolves.toBe(true)
		note('/Trash/SubTrash.txt', {type: 'text/plain'})
		undo('/Home/TrashDirectory/SubTrash.txt')

		await expectNoted()

		await expect(umbreld.client.files.restore.mutate({path: '/Trash/SubTrash.txt'})).resolves.toBe(true)
		note('/Home/TrashDirectory/SubTrash.txt', {type: 'text/plain'})
		undo('/Trash/SubTrash.txt')

		await expectNoted()
	})

	test.sequential(
		'moves a trashed file back to the original location in a subfolder even when the subfolder no longer exists',
		async () => {
			await expect(umbreld.client.files.trash.mutate({path: '/Home/TrashDirectory/SubTrash.txt'})).resolves.toBe(true)
			note('/Trash/SubTrash.txt', {type: 'text/plain'})
			undo('/Home/TrashDirectory/SubTrash.txt')

			await expectNoted()

			await fse.remove(`${umbreld.instance.files.homeDirectory}/TrashDirectory`)
			undo('/Home/TrashDirectory')

			await expectNoted()

			await expect(umbreld.client.files.restore.mutate({path: '/Trash/SubTrash.txt'})).resolves.toBe(true)
			note('/Home/TrashDirectory/SubTrash.txt', {type: 'text/plain'})
			undo('/Trash/SubTrash.txt')

			await expectNoted()
		},
	)

	test.sequential('throws when trying to restore a file that is not in trash', async () => {
		await expect(umbreld.client.files.restore.mutate({path: '/Home/Trash.txt'})).rejects.toThrow('ENOTSUP')

		await expectNoted()
	})

	test.sequential('throws when trying to restore the trash base directory', async () => {
		await expect(umbreld.client.files.restore.mutate({path: '/Trash'})).rejects.toThrow('ENOTSUP')

		await expectNoted()
	})

	test.sequential('handles existing files by adding a suffix', async () => {
		await fse.writeFile(`${umbreld.instance.files.homeDirectory}/Restore.txt`, 'Restore-2')
		note('/Home/Restore.txt', {type: 'text/plain'})

		await expect(umbreld.client.files.trash.mutate({path: '/Home/Restore.txt'})).resolves.toBe(true)
		note('/Trash/Restore.txt', {type: 'text/plain'})
		undo('/Home/Restore.txt')

		await fse.writeFile(`${umbreld.instance.files.homeDirectory}/Restore.txt`, 'Restore-1')
		note('/Home/Restore.txt', {type: 'text/plain'})

		await expect(umbreld.client.files.restore.mutate({path: '/Trash/Restore.txt'})).resolves.toBe(true)
		note('/Home/Restore (2).txt', {type: 'text/plain'})
		undo('/Trash/Restore.txt')

		await expectNoted()
	})
})

describe.sequential('emptyTrash', () => {
	test.sequential('throws when not logged in', async () => {
		await umbreld.ensureLoggedOut()
		await expect(umbreld.client.files.emptyTrash.mutate()).rejects.toThrow('Invalid token')
		await umbreld.ensureLoggedIn()
	})

	test.sequential('empties the trash', async () => {
		await expect(umbreld.client.files.emptyTrash.mutate()).resolves.toMatchObject({deleted: 1, failed: 0})
		undo('/Trash/TrashDirectory')
		undo('/Trash/RestoreDirectory')
		undo('/Trash/Restore.txt')

		await expect(fse.readdir(umbreld.instance.files.trashDirectory)).resolves.toHaveLength(0)
		await expect(fse.readdir(umbreld.instance.files.trashMetaDirectory)).resolves.toHaveLength(0)

		await expectNoted()
	})
})

describe.sequential('archive', () => {
	test.sequential('throws when not logged in', async () => {
		await umbreld.ensureLoggedOut()
		await expect(umbreld.client.files.archive.mutate({paths: ['/Home/Test.txt']})).rejects.toThrow('Invalid token')
		await umbreld.ensureLoggedIn()
	})

	test.sequential('throws on invalid paths', async () => {
		for (const [invalidPath, message] of Object.entries(invalidPaths)) {
			await expect(
				umbreld.client.files.archive.mutate({paths: [invalidPath]}),
				`Pattern '${invalidPath}'`,
			).rejects.toThrow(message)
		}
	})

	test.sequential('throws when trying to archive a base directory', async () => {
		await expect(umbreld.client.files.archive.mutate({paths: ['/Home']})).rejects.toThrow('ENOTSUP')

		await expectNoted()
	})

	test.sequential('throws when trying to archive in trash', async () => {
		await expect(umbreld.client.files.archive.mutate({paths: ['/Trash/InTrash']})).rejects.toThrow('ENOTSUP')

		await expectNoted()
	})

	test.sequential('archives a file', async () => {
		await fse.writeFile(`${umbreld.instance.files.homeDirectory}/Archive.txt`, 'Archive')
		note('/Home/Archive.txt', {type: 'text/plain'})

		await expect(umbreld.client.files.archive.mutate({paths: ['/Home/Archive.txt']})).resolves.toBe(
			'/Home/Archive.txt.zip',
		)
		note('/Home/Archive.txt.zip', {type: 'application/zip'})

		await expectNoted()
	})

	test.sequential('archives a directory', async () => {
		await fse.mkdir(`${umbreld.instance.files.homeDirectory}/ArchiveDirectory`)
		await fse.writeFile(`${umbreld.instance.files.homeDirectory}/ArchiveDirectory/Archive.txt`, 'Archive')
		note('/Home/ArchiveDirectory/Archive.txt', {type: 'text/plain'})

		await expect(umbreld.client.files.archive.mutate({paths: ['/Home/ArchiveDirectory']})).resolves.toBe(
			'/Home/ArchiveDirectory.zip',
		)
		note('/Home/ArchiveDirectory.zip', {type: 'application/zip'})

		await expectNoted()
	})

	test.sequential('archives a list of files', async () => {
		await expect(
			umbreld.client.files.archive.mutate({paths: ['/Home/Archive.txt', '/Home/ArchiveDirectory']}),
		).resolves.toBe('/Home/Archive.zip')
		note('/Home/Archive.zip', {type: 'application/zip'})

		await expectNoted()
	})

	test.sequential('increments filename index when file of same name already exists', async () => {
		await expect(umbreld.client.files.archive.mutate({paths: ['/Home/ArchiveDirectory']})).resolves.toBe(
			'/Home/ArchiveDirectory (2).zip',
		)
		note('/Home/ArchiveDirectory (2).zip', {type: 'application/zip'})

		await expectNoted()
	})
})

let archiveExtensionsToTest = ['.tar.gz', '.tgz', '.tar.bz2', '.tar.xz', '.tar', '.zip', '.7z']

describe.sequential('supportedArchiveExtensions', () => {
	test.sequential('throws when not logged in', async () => {
		await umbreld.ensureLoggedOut()
		await expect(umbreld.client.files.archiveExtensions.query()).rejects.toThrow('Invalid token')
		await umbreld.ensureLoggedIn()
	})

	test.sequential('returns supported archive types', async () => {
		await expect(umbreld.client.files.archiveExtensions.query()).resolves.toEqual(
			expect.arrayContaining(archiveExtensionsToTest),
		)
	})
})

describe.sequential('extract', async () => {
	test.sequential('throws when not logged in', async () => {
		await umbreld.ensureLoggedOut()
		await expect(umbreld.client.files.extract.mutate({path: '/Home/Extract.tar.gz'})).rejects.toThrow('Invalid token')
		await umbreld.ensureLoggedIn()
	})

	test.sequential('throws on invalid paths', async () => {
		for (const [invalidPath, message] of Object.entries(invalidPaths)) {
			await expect(
				umbreld.client.files.extract.mutate({path: invalidPath}),
				`Pattern '${invalidPath}'`,
			).rejects.toThrow(message)
		}
	})

	const temp = temporaryDirectory()
	const directory = await temp.create()
	const archives = {} as Record<string, {Plain?: Buffer; Empty: Buffer; Single: Buffer; Multiple: Buffer}>
	try {
		await fse.writeFile(`${directory}/Extract.txt`, 'Extract')
		await fse.mkdir(`${directory}/ExtractEmpty`)
		await fse.mkdir(`${directory}/ExtractSingle`)
		await fse.writeFile(`${directory}/ExtractSingle/Test.txt`, 'Test')
		await fse.mkdir(`${directory}/ExtractMultiple`)
		await fse.writeFile(`${directory}/ExtractMultiple/Test1.txt`, 'Test1')
		await fse.writeFile(`${directory}/ExtractMultiple/Test2.txt`, 'Test2')
		for (const extension of archiveExtensionsToTest) {
			if (extension.startsWith('.tar.') || extension === '.tgz') {
				await $({
					cwd: directory,
					shell: true,
				})`7z a -ttar -so ExtractEmpty.tar ExtractEmpty/ | 7z a -si ExtractEmpty${extension}`
				await $({
					cwd: directory,
					shell: true,
				})`7z a -ttar -so ExtractSingle.tar ExtractSingle/ | 7z a -si ExtractSingle${extension}`
				await $({
					cwd: directory,
					shell: true,
				})`7z a -ttar -so ExtractMultiple.tar ExtractMultiple/ | 7z a -si ExtractMultiple${extension}`
			} else {
				await $({cwd: directory})`7z a ExtractPlain${extension} Extract.txt` // no top-level
				await $({cwd: directory})`7z a ExtractEmpty${extension} ExtractEmpty/`
				await $({cwd: directory})`7z a ExtractSingle${extension} ExtractSingle/`
				await $({cwd: directory})`7z a ExtractMultiple${extension} ExtractMultiple/`
			}
			archives[extension] = {
				Plain: await fse.readFile(`${directory}/ExtractPlain${extension}`).catch(() => undefined),
				Empty: await fse.readFile(`${directory}/ExtractEmpty${extension}`),
				Single: await fse.readFile(`${directory}/ExtractSingle${extension}`),
				Multiple: await fse.readFile(`${directory}/ExtractMultiple${extension}`),
			}
		}
	} finally {
		await temp.destroy()
	}

	for (const [extension, kinds] of Object.entries(archives)) {
		test.sequential(`extracts ${extension.substring(1)} archives`, async () => {
			for (const [kind, buffer] of Object.entries(kinds)) {
				if (buffer === undefined) continue
				await fse.writeFile(`${umbreld.instance.files.homeDirectory}/Extract${kind}${extension}`, buffer)
				note(`/Home/Extract${kind}${extension}`, {type: expect.any(String)})
				await expect(umbreld.client.files.extract.mutate({path: `/Home/Extract${kind}${extension}`})).resolves.toBe(
					`/Home/Extract${kind}`,
				)
				if (kind === 'Plain') {
					note(`/Home/Extract${kind}/Extract.txt`, {type: 'text/plain'})
				} else if (kind === 'Empty') {
					note(`/Home/Extract${kind}`, {type: 'directory'})
				} else if (kind === 'Single') {
					note(`/Home/Extract${kind}/Test.txt`, {type: 'text/plain'})
				} else if (kind === 'Multiple') {
					note(`/Home/Extract${kind}/Test1.txt`, {type: 'text/plain'})
					note(`/Home/Extract${kind}/Test2.txt`, {type: 'text/plain'})
				}

				await expectNoted()

				await fse.remove(`${umbreld.instance.files.homeDirectory}/Extract${kind}${extension}`)
				undo(`/Home/Extract${kind}${extension}`)
				await fse.remove(`${umbreld.instance.files.homeDirectory}/Extract${kind}`)
				undo(`/Home/Extract${kind}`)
			}

			await expectNoted()
		})
	}
})

describe.sequential('sharePassword', () => {
	test.sequential('throws when not logged in', async () => {
		await umbreld.ensureLoggedOut()
		await expect(umbreld.client.files.sharePassword.query()).rejects.toThrow('Invalid token')
		await umbreld.ensureLoggedIn()
	})

	test.sequential('returns the 128 bit share password', async () => {
		await expect(umbreld.client.files.sharePassword.query()).resolves.toEqual(expect.stringMatching(/^[0-9a-f]{32}$/))
	})
})

describe.sequential('shares', () => {
	test.sequential('throws when not logged in', async () => {
		await umbreld.ensureLoggedOut()
		await expect(umbreld.client.files.shares.query()).rejects.toThrow('Invalid token')
		await umbreld.ensureLoggedIn()
	})

	test.sequential('returns default shared directories', async () => {
		await expect(umbreld.client.files.shares.query()).resolves.toEqual([])
	})
})

describe.sequential('share', () => {
	test.sequential('throws when not logged in', async () => {
		await umbreld.ensureLoggedOut()
		await expect(umbreld.client.files.share.mutate({path: '/Home/Test.txt'})).rejects.toThrow('Invalid token')
		await umbreld.ensureLoggedIn()
	})

	test.sequential('throws on invalid paths', async () => {
		for (const [invalidPath, message] of Object.entries(invalidPaths)) {
			await expect(umbreld.client.files.share.mutate({path: invalidPath}), `Pattern '${invalidPath}'`).rejects.toThrow(
				message,
			)
		}
	})

	test.sequential('shares a directory', async () => {
		await fse.mkdir(`${umbreld.instance.files.homeDirectory}/ShareDirectory`)
		await fse.writeFile(`${umbreld.instance.files.homeDirectory}/ShareDirectory/Share.txt`, 'Share')
		note('/Home/ShareDirectory/Share.txt', {type: 'text/plain'})

		await expect(umbreld.client.files.share.mutate({path: '/Home/ShareDirectory'})).resolves.toEqual('ShareDirectory')
		await expect(umbreld.client.files.shares.query()).resolves.toEqual([
			{name: 'ShareDirectory', path: '/Home/ShareDirectory'},
		])

		await expectNoted()
	})

	test.sequential('does not share the same directory twice', async () => {
		await expect(umbreld.client.files.share.mutate({path: '/Home/ShareDirectory'})).resolves.toEqual('ShareDirectory')
		await expect(umbreld.client.files.shares.query()).resolves.toEqual([
			{name: 'ShareDirectory', path: '/Home/ShareDirectory'},
		])

		await expectNoted()
	})

	test.sequential('does not share /Apps directory', async () => {
		await expect(umbreld.client.files.share.mutate({path: '/Apps'})).rejects.toThrow('ENOTSUP')
		await expect(umbreld.client.files.shares.query()).resolves.toEqual([
			{name: 'ShareDirectory', path: '/Home/ShareDirectory'},
		])
	})

	test.sequential('shares a directory with identical name under a unique name', async () => {
		await fse.mkdir(`${umbreld.instance.files.homeDirectory}/TargetDirectory/ShareDirectory`)
		note('/Home/TargetDirectory/ShareDirectory', {type: 'directory'})

		await expect(umbreld.client.files.share.mutate({path: '/Home/TargetDirectory/ShareDirectory'})).resolves.toEqual(
			'ShareDirectory (2)',
		)
		await expect(umbreld.client.files.shares.query()).resolves.toEqual([
			{name: 'ShareDirectory', path: '/Home/ShareDirectory'},
			{name: 'ShareDirectory (2)', path: '/Home/TargetDirectory/ShareDirectory'},
		])

		await expectNoted()
	})
})

describe.sequential('unshare', async () => {
	test.sequential('throws when not logged in', async () => {
		await umbreld.ensureLoggedOut()
		await expect(umbreld.client.files.unshare.mutate({path: '/Home/ShareDirectory'})).rejects.toThrow('Invalid token')
		await umbreld.ensureLoggedIn()
	})

	test.sequential('throws on invalid paths', async () => {
		for (const [invalidPath, message] of Object.entries(invalidPaths)) {
			await expect(
				umbreld.client.files.unshare.mutate({path: invalidPath}),
				`Pattern '${invalidPath}'`,
			).rejects.toThrow(message)
		}
	})

	test.sequential('unshares a directory', async () => {
		await expect(umbreld.client.files.unshare.mutate({path: '/Home/ShareDirectory'})).resolves.toBe(true)
		await expect(umbreld.client.files.shares.query()).resolves.toEqual([
			{name: 'ShareDirectory (2)', path: '/Home/TargetDirectory/ShareDirectory'},
		])

		await expectNoted()
	})
})

import {DEFAULT_DIRECTORIES} from '../../../files/files.js'

describe.sequential('favorites', () => {
	test.sequential('throws when not logged in', async () => {
		await umbreld.ensureLoggedOut()
		await expect(umbreld.client.files.favorites.query()).rejects.toThrow('Invalid token')
		await umbreld.ensureLoggedIn()
	})

	test.sequential('returns default favorite directories', async () => {
		await expect(umbreld.client.files.favorites.query()).resolves.toEqual(
			DEFAULT_DIRECTORIES.map((name) => ({name, path: `/Home/${name}`})),
		)
	})
})

describe.sequential('addFavorite', () => {
	test.sequential('throws when not logged in', async () => {
		await umbreld.ensureLoggedOut()
		await expect(umbreld.client.files.addFavorite.mutate({path: '/Home/Test.txt'})).rejects.toThrow('Invalid token')
		await umbreld.ensureLoggedIn()
	})

	test.sequential('throws on invalid paths', async () => {
		for (const [invalidPath, message] of Object.entries(invalidPaths)) {
			await expect(
				umbreld.client.files.addFavorite.mutate({path: invalidPath}),
				`Pattern '${invalidPath}'`,
			).rejects.toThrow(message)
		}
	})

	test.sequential('adds a directory to favorites', async () => {
		await fse.mkdir(`${umbreld.instance.files.homeDirectory}/FavoriteDirectory`)
		note('/Home/FavoriteDirectory', {type: 'directory'})

		await expect(umbreld.client.files.addFavorite.mutate({path: '/Home/FavoriteDirectory'})).resolves.toBe(true)
		await expect(umbreld.client.files.favorites.query()).resolves.toEqual([
			...DEFAULT_DIRECTORIES.map((name) => ({name, path: `/Home/${name}`})),
			{name: 'FavoriteDirectory', path: '/Home/FavoriteDirectory'},
		])

		await expectNoted()
	})

	test.sequential('does not favorite the same directory twice', async () => {
		await expect(umbreld.client.files.addFavorite.mutate({path: '/Home/FavoriteDirectory'})).resolves.toBe(true)
		await expect(umbreld.client.files.favorites.query()).resolves.toEqual([
			...DEFAULT_DIRECTORIES.map((name) => ({name, path: `/Home/${name}`})),
			{name: 'FavoriteDirectory', path: '/Home/FavoriteDirectory'},
		])

		await expectNoted()
	})

	test.sequential('favorites a directory with identical name', async () => {
		await fse.mkdir(`${umbreld.instance.files.homeDirectory}/TargetDirectory/FavoriteDirectory`)
		note('/Home/TargetDirectory/FavoriteDirectory', {type: 'directory'})

		await expect(
			umbreld.client.files.addFavorite.mutate({path: '/Home/TargetDirectory/FavoriteDirectory'}),
		).resolves.toBe(true)
		await expect(umbreld.client.files.favorites.query()).resolves.toEqual([
			...DEFAULT_DIRECTORIES.map((name) => ({name, path: `/Home/${name}`})),
			{name: 'FavoriteDirectory', path: '/Home/FavoriteDirectory'},
			{name: 'FavoriteDirectory', path: '/Home/TargetDirectory/FavoriteDirectory'},
		])

		await expectNoted()
	})
})

describe('deleteFavorite', () => {
	test.sequential('throws when not logged in', async () => {
		await umbreld.ensureLoggedOut()
		await expect(umbreld.client.files.deleteFavorite.mutate({path: '/Home/FavoriteDirectory'})).rejects.toThrow(
			'Invalid token',
		)
		await umbreld.ensureLoggedIn()
	})

	test.sequential('throws on invalid paths', async () => {
		for (const [invalidPath, message] of Object.entries(invalidPaths)) {
			await expect(
				umbreld.client.files.deleteFavorite.mutate({path: invalidPath}),
				`Pattern '${invalidPath}'`,
			).rejects.toThrow(message)
		}
	})

	test.sequential('deletes a directory from favorites', async () => {
		await expect(umbreld.client.files.deleteFavorite.mutate({path: '/Home/FavoriteDirectory'})).resolves.toBe(true)
		await expect(umbreld.client.files.favorites.query()).resolves.toEqual([
			...DEFAULT_DIRECTORIES.map((name) => ({name, path: `/Home/${name}`})),
			{name: 'FavoriteDirectory', path: '/Home/TargetDirectory/FavoriteDirectory'},
		])

		await expectNoted()
	})
})
