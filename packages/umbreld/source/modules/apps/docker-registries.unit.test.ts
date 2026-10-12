import {describe, test, expect, beforeEach, afterEach, vi} from 'vitest'
import {mkdtemp} from 'node:fs/promises'
import path from 'node:path'
import {tmpdir} from 'node:os'
import fse from 'fs-extra'

import DockerRegistries, {
	normalizeRegistryHost,
	parseImageRegistry,
	formatDockerConfigJson,
} from './docker-registries.js'

describe('Docker Registries URL & Image Parsing', () => {
	test('normalizeRegistryHost normalizes protocols, paths, ports and Docker Hub aliases', () => {
		expect(normalizeRegistryHost('https://registry.gitlab.com/')).toBe('registry.gitlab.com')
		expect(normalizeRegistryHost('http://registry.gitlab.com/v2/')).toBe('registry.gitlab.com')
		expect(normalizeRegistryHost('registry.gitlab.com')).toBe('registry.gitlab.com')
		expect(normalizeRegistryHost('https://gitlab.mycorp.internal:5050/group/project')).toBe(
			'gitlab.mycorp.internal:5050',
		)
		expect(normalizeRegistryHost('gitlab.mycorp.internal:5050')).toBe('gitlab.mycorp.internal:5050')
		expect(normalizeRegistryHost('https://ghcr.io/')).toBe('ghcr.io')
		expect(normalizeRegistryHost('docker.io')).toBe('docker.io')
		expect(normalizeRegistryHost('https://index.docker.io/v1/')).toBe('docker.io')
		expect(normalizeRegistryHost('registry-1.docker.io')).toBe('docker.io')
	})

	test('parseImageRegistry extracts the correct registry host from image references', () => {
		// Self-hosted and third-party registries with domains
		expect(parseImageRegistry('registry.gitlab.com/my-group/my-project/my-app:1.2.3')).toBe('registry.gitlab.com')
		expect(parseImageRegistry('gitlab.company.com:5050/team/service:latest')).toBe('gitlab.company.com:5050')
		expect(parseImageRegistry('ghcr.io/getumbrel/tor:0.4.9.11')).toBe('ghcr.io')
		expect(
			parseImageRegistry(
				'ghcr.io/getumbrel/tor:0.4.9.11@sha256:e382b8629c0dfef6ceb396b062622d4e4e955b19d6f16b883fd2c0723ad5671a',
			),
		).toBe('ghcr.io')
		expect(parseImageRegistry('192.168.1.100:5000/internal-tool:v1')).toBe('192.168.1.100:5000')
		expect(parseImageRegistry('localhost:5000/test-app:dev')).toBe('localhost:5000')

		// Docker Hub images
		expect(parseImageRegistry('docker.io/library/ubuntu:latest')).toBe('docker.io')
		expect(parseImageRegistry('docker.io/myusername/myapp:1.0')).toBe('docker.io')
		expect(parseImageRegistry('myusername/myapp:1.0')).toBe('docker.io')
		expect(parseImageRegistry('ubuntu:latest')).toBe('docker.io')
		expect(parseImageRegistry('postgres:16-alpine')).toBe('docker.io')
	})

	test('formatDockerConfigJson creates a valid Docker config JSON with base64 encoded auth', () => {
		const json = formatDockerConfigJson([
			{
				id: '1',
				url: 'https://registry.gitlab.com',
				username: 'deploy-token',
				password: 'token-secret-123',
				createdAt: 1000,
			},
			{
				id: '2',
				url: 'docker.io',
				username: 'dockeruser',
				password: 'dockerpassword',
				createdAt: 2000,
			},
		])

		const parsed = JSON.parse(json)
		expect(parsed.auths).toBeDefined()

		// GitLab auth
		const expectedGitlabAuth = Buffer.from('deploy-token:token-secret-123').toString('base64')
		expect(parsed.auths['registry.gitlab.com']).toEqual({auth: expectedGitlabAuth})
		expect(parsed.auths['https://registry.gitlab.com']).toEqual({auth: expectedGitlabAuth})

		// Docker Hub auth
		const expectedDockerAuth = Buffer.from('dockeruser:dockerpassword').toString('base64')
		expect(parsed.auths['https://index.docker.io/v1/']).toEqual({auth: expectedDockerAuth})
		expect(parsed.auths['docker.io']).toEqual({auth: expectedDockerAuth})
	})
})

describe('DockerRegistries Management Class', () => {
	let tempDir: string
	let storeData: Record<string, any>
	let fakeUmbreld: any
	let registries: DockerRegistries

	beforeEach(async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), 'umbreld-registries-test-'))
		storeData = {}
		fakeUmbreld = {
			dataDirectory: tempDir,
			store: {
				get: vi.fn(async (key: string) => storeData[key]),
				set: vi.fn(async (key: string, val: any) => {
					storeData[key] = val
					return true
				}),
			},
		}
		registries = new DockerRegistries(fakeUmbreld)
	})

	afterEach(async () => {
		await fse.remove(tempDir)
	})

	test('init creates docker-config directory and empty config.json with secure permissions', async () => {
		await registries.init()
		expect(await fse.pathExists(registries.dockerConfigDirectory)).toBe(true)
		expect(await fse.pathExists(registries.dockerConfigFilePath)).toBe(true)

		const content = await fse.readJson(registries.dockerConfigFilePath)
		expect(content).toEqual({auths: {}})
	})

	test('add saves credentials, updates store and writes to config.json', async () => {
		const added = await registries.add({
			url: 'https://registry.gitlab.com',
			username: 'gitlab-user',
			password: 'gl-pat-secret-token',
		})

		expect(added.id).toBeDefined()
		expect(added.url).toBe('https://registry.gitlab.com')
		expect(added.username).toBe('gitlab-user')
		expect(added.createdAt).toBeTypeOf('number')
		// Verify password is NOT in the public return value
		expect((added as any).password).toBeUndefined()

		// Verify store
		const stored = await registries.getCredentials()
		expect(stored).toHaveLength(1)
		expect(stored[0].password).toBe('gl-pat-secret-token')

		// Verify config.json on disk
		const config = await fse.readJson(registries.dockerConfigFilePath)
		const expectedAuth = Buffer.from('gitlab-user:gl-pat-secret-token').toString('base64')
		expect(config.auths['registry.gitlab.com'].auth).toBe(expectedAuth)
	})

	test('add with existing registry updates credentials instead of duplicating', async () => {
		await registries.add({
			url: 'registry.gitlab.com',
			username: 'old-user',
			password: 'old-password',
		})

		await registries.add({
			url: 'https://registry.gitlab.com/',
			username: 'new-user',
			password: 'new-password',
		})

		const stored = await registries.getCredentials()
		expect(stored).toHaveLength(1)
		expect(stored[0].username).toBe('new-user')
		expect(stored[0].password).toBe('new-password')
	})

	test('list returns sanitized records without exposing passwords', async () => {
		await registries.add({
			url: 'registry.gitlab.com',
			username: 'gl-user',
			password: 'super-secret-token',
		})

		const list = await registries.list()
		expect(list).toHaveLength(1)
		expect(list[0].username).toBe('gl-user')
		expect(list[0].url).toBe('registry.gitlab.com')
		expect((list[0] as any).password).toBeUndefined()
	})

	test('getAuthForImage returns credentials matching the image registry', async () => {
		await registries.add({
			url: 'https://registry.gitlab.com',
			username: 'gitlab+deploy-token',
			password: 'token-abc-123',
		})

		// Private image on gitlab
		const auth = await registries.getAuthForImage('registry.gitlab.com/my-team/backend-service:v2.0.0')
		expect(auth).toEqual({
			username: 'gitlab+deploy-token',
			password: 'token-abc-123',
			serveraddress: 'registry.gitlab.com',
		})

		// Public image on docker hub or ghcr - returns undefined
		const publicAuth = await registries.getAuthForImage('ghcr.io/getumbrel/tor:0.4.9.11')
		expect(publicAuth).toBeUndefined()

		const dockerHubAuth = await registries.getAuthForImage('redis:alpine')
		expect(dockerHubAuth).toBeUndefined()
	})

	test('remove removes credentials and updates config.json', async () => {
		const added = await registries.add({
			url: 'registry.gitlab.com',
			username: 'gl-user',
			password: 'secret',
		})

		const removed = await registries.remove(added.id)
		expect(removed).toBe(true)

		const stored = await registries.getCredentials()
		expect(stored).toHaveLength(0)

		const config = await fse.readJson(registries.dockerConfigFilePath)
		expect(config.auths).toEqual({})
	})
})
