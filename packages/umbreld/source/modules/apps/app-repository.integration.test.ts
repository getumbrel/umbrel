import {fileURLToPath} from 'node:url'
import path from 'node:path'
import http from 'node:http'
import type {AddressInfo} from 'node:net'

import {describe, beforeAll, afterAll, expect, test, vi} from 'vitest'
import fse from 'fs-extra'
import {$} from 'execa'

import runGitServer from '../test-utilities/run-git-server.ts'
import temporaryDirectory from '../utilities/temporary-directory.ts'

import AppRepository from './app-repository.ts'
import Umbreld from '../../index.ts'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))

const directory = temporaryDirectory()

let gitServer: Awaited<ReturnType<typeof runGitServer>>

beforeAll(async () => {
	await directory.createRoot()
	gitServer = await runGitServer()
})
afterAll(async () => {
	await directory.destroyRoot()
	await gitServer.close()
})

describe('AppRepository', async () => {
	test('is a class', () => {
		expect(AppRepository).toBeTypeOf('function')
		expect(AppRepository.toString().startsWith('class ')).toBe(true)
	})

	test('return an instance on valid URL', async () => {
		const umbreld = new Umbreld({dataDirectory: '/tmp'})
		const url = 'http://github.com/getumbrel/umbrel-apps.git'
		const appRepo = new AppRepository(umbreld, url)
		expect(appRepo.url).toBe(url)
	})

	test('throws error on invalid URL', async () => {
		const umbreld = new Umbreld({dataDirectory: '/tmp'})
		expect(() => new AppRepository(umbreld, 'invalid-url')).toThrow('Invalid URL')
	})
})

describe('appRepository.cleanUrl()', () => {
	test('cleans HTTP URLs', async () => {
		const umbreld = new Umbreld({dataDirectory: '/tmp'})
		const appRepo = new AppRepository(umbreld, 'http://github.com/getumbrel/umbrel-apps.git')
		expect(appRepo.cleanUrl()).toBe('getumbrel-umbrel-apps-github-98f08343')
	})

	test('cleans HTTPS URLs', async () => {
		const umbreld = new Umbreld({dataDirectory: '/tmp'})
		const appRepo = new AppRepository(umbreld, 'https://github.com/getumbrel/umbrel-apps.git')
		expect(appRepo.cleanUrl()).toBe('getumbrel-umbrel-apps-github-53f74447')
	})

	test('cleans token URLs', async () => {
		const umbreld = new Umbreld({dataDirectory: '/tmp'})
		const appRepo = new AppRepository(umbreld, 'https://somerandomtoken@github.com/getumbrel/umbrel-apps.git')
		expect(appRepo.cleanUrl()).toBe('getumbrel-umbrel-apps-github-5db4a3e5')
	})

	test('cleans GitLab URL', async () => {
		const umbreld = new Umbreld({dataDirectory: '/tmp'})
		const appRepo = new AppRepository(umbreld, 'https://gitlab.com/getumbrel/umbrel-apps.git')
		expect(appRepo.cleanUrl()).toBe('getumbrel-umbrel-apps-gitlab-8895504e')
	})

	test('cleans non user/repo urls', async () => {
		const umbreld = new Umbreld({dataDirectory: '/tmp'})
		const appRepo = new AppRepository(umbreld, 'https://example.com')
		expect(appRepo.cleanUrl()).toBe('example-100680ad')
	})

	test('removes dangerous characters', async () => {
		const umbreld = new Umbreld({dataDirectory: '/tmp'})
		const appRepo = new AppRepository(umbreld, `https://example.com/-+_)(*&^%$!~\`,<>?;:'"[{]}\\|=/`)
		expect(appRepo.cleanUrl()).toBe('example-fcd4912b')
	})
})

describe('appRepository.update()', () => {
	test("does initial install from URL if there's no local repo", async () => {
		const dataDirectory = await directory.create()
		const umbreld = new Umbreld({dataDirectory})
		const appRepository = new AppRepository(umbreld, gitServer.url)
		expect(await fse.exists(`${appRepository.path}/.git`)).toBe(false)
		expect(await fse.exists(`${appRepository.path}/umbrel-app-store.yml`)).toBe(false)
		await appRepository.update()
		expect(await fse.exists(`${appRepository.path}/.git`)).toBe(true)
		expect(await fse.exists(`${appRepository.path}/umbrel-app-store.yml`)).toBe(true)
	})

	test('updates when the remote repo has changed', async () => {
		const dataDirectory = await directory.create()
		const umbreld = new Umbreld({dataDirectory})
		const appRepository = new AppRepository(umbreld, gitServer.url)

		// Initial install
		await appRepository.update()
		const originalCommit = await appRepository.getCurrentCommit()
		expect(originalCommit).toBeTruthy()

		// Check we are updated
		expect(await appRepository.isUpdated()).toBe(true)

		// Add new commit to remote repo
		await gitServer.addNewCommit()

		// Check we are not updated
		expect(await appRepository.isUpdated()).toBe(false)

		// Update again
		await appRepository.update()
		const postUpdateCommit = await appRepository.getCurrentCommit()

		// Check we're on the new commit
		expect(originalCommit).not.toBe(postUpdateCommit)
	})

	test('does not update when both repos are the same', async () => {
		const dataDirectory = await directory.create()
		const umbreld = new Umbreld({dataDirectory})
		const appRepository = new AppRepository(umbreld, gitServer.url)

		// Initial install
		await appRepository.update()
		const originalCommit = await appRepository.getCurrentCommit()
		expect(originalCommit).toBeTruthy()

		// Check we are updated
		expect(await appRepository.isUpdated()).toBe(true)

		// Update again
		await appRepository.update()
		const postUpdateCommit = await appRepository.getCurrentCommit()

		// Check we're on the same commit
		expect(originalCommit).toBe(postUpdateCommit)
	})
})

describe('appRepository.atomicClone()', () => {
	test('removes its temporary clone and preserves the installed repository when promotion fails', async () => {
		const dataDirectory = await directory.create()
		const appRepository = new AppRepository(new Umbreld({dataDirectory}), gitServer.url)
		const originalMarker = `${appRepository.path}/original-marker`
		const moveError = new Error('Simulated promotion failure')

		await fse.outputFile(originalMarker, 'original')

		const move = vi.spyOn(fse, 'move').mockImplementationOnce(async (source: string, destination: string) => {
			expect(destination).toBe(appRepository.path)
			await expect(fse.pathExists(`${source}/.git`)).resolves.toBe(true)
			await expect(fse.pathExists(`${source}/umbrel-app-store.yml`)).resolves.toBe(true)
			throw moveError
		})

		try {
			await expect(appRepository.atomicClone()).rejects.toBe(moveError)
		} finally {
			move.mockRestore()
		}

		await expect(fse.readdir(`${dataDirectory}/app-stores/.tmp`)).resolves.toEqual([])
		await expect(fse.readFile(originalMarker, 'utf8')).resolves.toBe('original')
		await expect(fse.readdir(appRepository.path)).resolves.toEqual(['original-marker'])
	})

	test('does not mask a promotion failure when temporary cleanup also fails', async () => {
		const dataDirectory = await directory.create()
		const appRepository = new AppRepository(new Umbreld({dataDirectory}), gitServer.url)
		const moveError = new Error('Simulated promotion failure')
		const cleanupError = new Error('Simulated cleanup failure')
		const move = vi.spyOn(fse, 'move').mockRejectedValueOnce(moveError)
		const remove = vi.spyOn(fse, 'remove').mockRejectedValueOnce(cleanupError)
		const logError = vi.spyOn(appRepository.logger, 'error').mockImplementation(() => {})

		try {
			await expect(appRepository.atomicClone()).rejects.toBe(moveError)
			expect(logError).toHaveBeenCalledWith(expect.stringContaining(`${dataDirectory}/app-stores/.tmp/`), cleanupError)
		} finally {
			move.mockRestore()
			remove.mockRestore()
			logError.mockRestore()
			await fse.remove(`${dataDirectory}/app-stores/.tmp`)
		}
	})
})

// A store is third-party content cloned as root, so nothing it serves may write
// outside the clone. Git refuses to create these trees and refs itself, so the
// tests below write the objects and the ref advertisement directly.
describe('appRepository.atomicClone() with a hostile store', () => {
	test('refuses tree entries that climb out of the clone', async () => {
		const repository = `${path.dirname(gitServer.directory)}/escape.git`
		const $$ = $({cwd: repository})
		await $({cwd: path.dirname(repository)})`git init --quiet --bare ${repository}`
		const writeObject = async (type: string, content: Buffer) =>
			(await $$({input: content})`git hash-object --literally -w -t ${type} --stdin`).stdout
		const tree = async (mode: string, name: string, oid: string) =>
			writeObject('tree', Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(oid, 'hex')]))
		// x/../../../ESCAPED resolves to app-stores/ESCAPED from app-stores/.tmp/<token>
		let oid = await tree('100644', 'ESCAPED', await writeObject('blob', Buffer.from('escaped\n')))
		for (let level = 0; level < 3; level++) oid = await tree('40000', '..', oid)
		oid = await tree('40000', 'x', oid)
		const commit = await writeObject(
			'commit',
			Buffer.from(`tree ${oid}\nauthor a <a@a> 0 +0000\ncommitter a <a@a> 0 +0000\n\nescape\n`),
		)
		await $$`git update-ref HEAD ${commit}`

		const dataDirectory = await directory.create()
		const appRepository = new AppRepository(new Umbreld({dataDirectory}), gitServer.url.replace(/[^/]+$/, 'escape.git'))
		await expect(appRepository.atomicClone()).rejects.toMatchObject({code: 'UnsafeFilepathError'})
		await expect(fse.pathExists(`${dataDirectory}/app-stores/ESCAPED`)).resolves.toBe(false)
		await expect(fse.readdir(`${dataDirectory}/app-stores/.tmp`)).resolves.toEqual([])
	})

	test('refuses a default branch that climbs out of the git directory', async () => {
		const head = (await $({cwd: gitServer.directory})`git rev-parse HEAD`).stdout
		const branch = 'refs/heads/../../../../../ESCAPED'
		const packet = (line: string) => `${(line.length + 4).toString(16).padStart(4, '0')}${line}`
		// Advertise a HEAD symref to a branch name containing `..`, and serve the
		// fixture repository's real objects for it
		const server = http.createServer((request, response) => {
			if (request.method === 'GET' && request.url?.includes('/info/refs')) {
				response.setHeader('Content-Type', 'application/x-git-upload-pack-advertisement')
				response.end(
					packet('# service=git-upload-pack\n') +
						'0000' +
						packet(`${head} HEAD\0side-band-64k ofs-delta shallow no-progress symref=HEAD:${branch}\n`) +
						packet(`${head} ${branch}\n`) +
						'0000',
				)
				return
			}
			response.setHeader('Content-Type', 'application/x-git-upload-pack-result')
			const uploadPack = $({cwd: gitServer.directory, stdin: 'pipe'})`git upload-pack --stateless-rpc .`
			request.pipe(uploadPack.stdin!)
			uploadPack.stdout!.pipe(response)
		})
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

		try {
			const dataDirectory = await directory.create()
			const {port} = server.address() as AddressInfo
			const appRepository = new AppRepository(new Umbreld({dataDirectory}), `http://127.0.0.1:${port}/store.git`)
			await expect(appRepository.atomicClone()).rejects.toMatchObject({code: 'InvalidRefNameError'})
			await expect(fse.pathExists(`${dataDirectory}/app-stores/ESCAPED`)).resolves.toBe(false)
			await expect(fse.readdir(`${dataDirectory}/app-stores/.tmp`)).resolves.toEqual([])
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()))
		}
	})
})

describe('appRepository.readRegistry()', () => {
	test('reads community registry', async () => {
		const umbreld = new Umbreld({dataDirectory: '/tmp'})
		const appRepo = new AppRepository(umbreld, 'http://github.com/getumbrel/umbrel-apps.git')

		// Forcefully set app repo path to the community repo fixture
		appRepo.path = `${currentDirectory}/../test-utilities/fixtures/community-repo`
		umbreld.appStore.defaultAppStoreRepo = appRepo.path

		// Read registry
		const registry = await appRepo.readRegistry()
		const expectedRegistry = {
			url: 'http://github.com/getumbrel/umbrel-apps.git',
			meta: {
				id: 'sparkles',
				name: 'Sparkles',
			},
			apps: [
				{
					appStoreId: 'sparkles',
					manifestVersion: '1.0.0',
					id: 'sparkles-hello-world',
					name: 'Hello World',
					tagline: "Replace this tagline with your app's tagline",
					icon: 'https://svgur.com/i/mvA.svg',
					category: 'Development',
					version: '1.0.0',
					port: 4000,
					description: "Add your app's description here.\n\nYou can also add newlines!",
					developer: 'Umbrel',
					website: 'https://umbrel.com',
					submitter: 'Umbrel',
					submission: 'https://github.com/getumbrel/umbrel-hello-world-app',
					repo: 'https://github.com/getumbrel/umbrel-hello-world-app',
					support: 'https://github.com/getumbrel/umbrel-hello-world-app/issues',
					gallery: [
						'https://i.imgur.com/yyVG0Jb.jpeg',
						'https://i.imgur.com/yyVG0Jb.jpeg',
						'https://i.imgur.com/yyVG0Jb.jpeg',
					],
					releaseNotes: "Add what's new in the latest version of your app here.",
					dependencies: [],
					path: '',
					defaultUsername: '',
					defaultPassword: '',
					backupIgnore: ['data', 'logs', 'cache'],
				},
			],
		}
		expect(registry).toStrictEqual(expectedRegistry)
	})
})
