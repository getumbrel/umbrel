import {describe, beforeAll, afterAll, expect, test} from 'vitest'
import fse from 'fs-extra'
import {Git} from 'node-git-server'
import getPort from 'get-port'
import waitPort from 'wait-port'

import temporaryDirectory from './utilities/temporary-directory.js'

import AppRepository from './app-repository.js'

const directory = temporaryDirectory()

beforeAll(directory.createRoot)
afterAll(directory.destroyRoot)

describe('AppRepository', async () => {
	test('is a class', () => {
		expect(AppRepository).toBeTypeOf('function')
		expect(AppRepository.toString().startsWith('class ')).toBe(true)
	})

	test('return an instance on valid URL', async () => {
		const url = 'http://github.com/getumbrel/umbrel-apps.git'
		const appRepo = new AppRepository({} as any, url)
		expect(appRepo.url).toBe(url)
	})

	test('throws error on invalid URL', async () => {
		expect(() => new AppRepository({} as any, 'invalid-url')).toThrow('Invalid URL')
	})
})

describe('appRepository.cleanUrl()', () => {
	test('cleans HTTP URLs', async () => {
		const appRepo = new AppRepository({} as any, 'http://github.com/getumbrel/umbrel-apps.git')
		expect(appRepo.cleanUrl()).toBe('getumbrel-umbrel-apps-github-98f08343')
	})

	test('cleans HTTPS URLs', async () => {
		const appRepo = new AppRepository({} as any, 'https://github.com/getumbrel/umbrel-apps.git')
		expect(appRepo.cleanUrl()).toBe('getumbrel-umbrel-apps-github-53f74447')
	})

	test('cleans token URLs', async () => {
		const appRepo = new AppRepository({} as any, 'https://somerandomtoken@github.com/getumbrel/umbrel-apps.git')
		expect(appRepo.cleanUrl()).toBe('getumbrel-umbrel-apps-github-5db4a3e5')
	})

	test('cleans GitLab URL', async () => {
		const appRepo = new AppRepository({} as any, 'https://gitlab.com/getumbrel/umbrel-apps.git')
		expect(appRepo.cleanUrl()).toBe('getumbrel-umbrel-apps-gitlab-8895504e')
	})

	test('cleans non user/repo urls', async () => {
		const appRepo = new AppRepository({} as any, 'https://example.com')
		expect(appRepo.cleanUrl()).toBe('example-100680ad')
	})

	test('removes dangerous characters', async () => {
		const appRepo = new AppRepository({} as any, `https://example.com/-+_)(*&^%$!~\`,<>?;:'"[{]}\\|=/`)
		expect(appRepo.cleanUrl()).toBe('example-fcd4912b')
	})
})

describe('appRepository.update()', () => {
	test.skip('installs from a URL', async () => {
		const gitDirectory = await directory.create()
		const repos = new Git(gitDirectory, {autoCreate: true})
		const port = await getPort()
		repos.listen(port)
		await waitPort({host: 'localhost', port})
		const dataDirectory = await directory.create()
		const appRepository = new AppRepository({dataDirectory} as any, `http://localhost:${port}/umbrel-apps.git`)
		await appRepository.update()
		expect(await fse.exists(`${appRepository.path}/.git`)).toBe(true)
	})
})
