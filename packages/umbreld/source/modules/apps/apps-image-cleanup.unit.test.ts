import {beforeEach, describe, expect, test, vi} from 'vitest'

import type Umbreld from '../../index.js'
import App from './app.js'
import Apps from './apps.js'
import {removeUnusedImages} from './image-cleanup.js'
import appEnvironment from './legacy-compat/app-environment.js'

vi.mock('./app.js', async (original) => ({
	...(await original<typeof import('./app.js')>()),
	readManifestInDirectory: vi.fn(async () => ({manifestVersion: '1.0.0'})),
}))
vi.mock('./legacy-compat/app-environment.js', () => ({default: vi.fn()}))
vi.mock('./image-cleanup.js', async (original) => ({
	...(await original<typeof import('./image-cleanup.js')>()),
	removeUnusedImages: vi.fn(async () => {}),
}))

beforeEach(() => {
	vi.restoreAllMocks()
	vi.mocked(removeUnusedImages).mockClear()
	vi.mocked(appEnvironment).mockResolvedValue(['system:current'])
})

function fixture() {
	const logger = {log: vi.fn(), error: vi.fn()}
	const apps = new Apps({
		version: '2.0.0',
		dataDirectory: '/unused-image-cleanup-test',
		logger: {createChildLogger: () => logger},
		store: {get: async () => ['stopped', 'updating']},
		appStore: {getAppTemplateFilePath: async () => '/unused-app-template'},
	} as unknown as Umbreld)
	const stopped = {id: 'stopped', state: 'stopped', getExpectedImages: vi.fn(async () => ['stopped:pinned'])}
	const updating = {
		id: 'updating',
		state: 'ready',
		getExpectedImages: vi.fn(async () => ['updating:current']),
		update: vi.fn(async () => true),
	}
	apps.instances = [stopped, updating] as unknown as App[]
	return {apps, stopped, updating, logger}
}

describe('app image cleanup requests', () => {
	test('collects installed stopped apps and system images after a successful update', async () => {
		const {apps} = fixture()
		await apps.update('updating')
		await apps.imageCleanup.runOperation(async () => {})
		expect(removeUnusedImages).toHaveBeenCalledWith(
			['system:current', 'stopped:pinned', 'updating:current'],
			apps.logger,
		)
	})

	test('collects the final installed configuration after a failed update', async () => {
		const {apps, updating} = fixture()
		updating.update.mockImplementation(async () => {
			updating.getExpectedImages.mockResolvedValue(['updating:partially-updated'])
			throw new Error('start failed')
		})
		await expect(apps.update('updating')).rejects.toThrow('start failed')
		await apps.imageCleanup.runOperation(async () => {})
		expect(removeUnusedImages).toHaveBeenCalledWith(
			['system:current', 'stopped:pinned', 'updating:partially-updated'],
			apps.logger,
		)
	})

	test('skips the entire sweep when even one stopped app configuration is unreadable', async () => {
		const {apps, stopped, logger} = fixture()
		stopped.getExpectedImages.mockRejectedValue(new Error('invalid Compose'))
		await apps.update('updating')
		await apps.imageCleanup.runOperation(async () => {})
		expect(removeUnusedImages).not.toHaveBeenCalled()
		expect(logger.error).toHaveBeenCalledWith('Failed to clean up unused Docker images', expect.any(Error))
	})

	test('does not omit persisted apps whose directory was missing at startup', async () => {
		const {apps, updating} = fixture()
		apps.instances = [updating] as unknown as App[]
		vi.spyOn(App.prototype, 'getExpectedImages').mockRejectedValue(new Error('missing installed config'))
		await apps.update('updating')
		await apps.imageCleanup.runOperation(async () => {})
		expect(removeUnusedImages).not.toHaveBeenCalled()
	})

	test('skips deletion when the system image list is unavailable', async () => {
		const {apps} = fixture()
		vi.mocked(appEnvironment).mockRejectedValue(new Error('invalid system Compose'))
		await apps.update('updating')
		await apps.imageCleanup.runOperation(async () => {})
		expect(removeUnusedImages).not.toHaveBeenCalled()
	})
})
