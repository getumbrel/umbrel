import Dockerode from 'dockerode'
import {afterEach, describe, expect, test, vi} from 'vitest'

import ImageCleanup, {removeUnusedImages} from './image-cleanup.js'

function deferred() {
	let resolve!: () => void
	const promise = new Promise<void>((done) => (resolve = done))
	return {promise, resolve}
}

const logger = () => ({log: vi.fn(), error: vi.fn()})

describe('image cleanup coordination', () => {
	afterEach(() => vi.useRealTimers())

	test('allows app operations during the startup delay and coalesces their cleanup requests', async () => {
		vi.useFakeTimers()
		const sweep = vi.fn(async () => {})
		const cleanup = new ImageCleanup(sweep, logger())
		cleanup.schedule(10 * 60 * 1000)
		await expect(cleanup.runOperation(async () => 'started')).resolves.toBe('started')
		await expect(cleanup.runOperation(async () => 'updated', {cleanupAfter: true})).resolves.toBe('updated')
		await vi.advanceTimersByTimeAsync(10 * 60 * 1000 - 1)
		expect(sweep).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1)
		expect(sweep).toHaveBeenCalledOnce()
		await cleanup.runOperation(async () => {})
		expect(sweep).toHaveBeenCalledOnce()
	})

	test('waits for active operations when the startup delay expires', async () => {
		vi.useFakeTimers()
		const sweep = vi.fn(async () => {})
		const cleanup = new ImageCleanup(sweep, logger())
		cleanup.schedule(10 * 60 * 1000)
		const update = deferred()
		const operation = cleanup.runOperation(() => update.promise, {cleanupAfter: true})
		await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
		expect(sweep).not.toHaveBeenCalled()
		update.resolve()
		await operation
		await cleanup.runOperation(async () => {})
		expect(sweep).toHaveBeenCalledOnce()
	})

	test('cancels scheduled cleanup on shutdown and gives the next startup a fresh delay', async () => {
		vi.useFakeTimers()
		const sweep = vi.fn(async () => {})
		const cleanup = new ImageCleanup(sweep, logger())
		cleanup.schedule(10 * 60 * 1000)
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
		cleanup.enabled = false
		expect(vi.getTimerCount()).toBe(0)
		await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
		expect(sweep).not.toHaveBeenCalled()
		await cleanup.runOperation(async () => {
			cleanup.enabled = true
			cleanup.schedule(10 * 60 * 1000)
		})
		await vi.advanceTimersByTimeAsync(10 * 60 * 1000 - 1)
		expect(sweep).not.toHaveBeenCalled()
		await vi.advanceTimersByTimeAsync(1)
		expect(sweep).toHaveBeenCalledOnce()
	})

	test('allows concurrent operations and sweeps once after every operation settles, including failures', async () => {
		const sweep = vi.fn(async () => {})
		const cleanup = new ImageCleanup(sweep, logger())
		const first = deferred()
		const second = deferred()
		const operations = [
			cleanup.runOperation(() => first.promise, {cleanupAfter: true}),
			cleanup.runOperation(
				async () => {
					await second.promise
					throw new Error('update failed')
				},
				{cleanupAfter: true},
			),
		]
		const result = Promise.allSettled(operations)
		first.resolve()
		await operations[0]
		expect(sweep).not.toHaveBeenCalled()
		second.resolve()
		await result
		await cleanup.runOperation(async () => {})
		expect(sweep).toHaveBeenCalledOnce()
	})

	test('nested operations and background reinstalls keep cleanup pending until the entire batch settles', async () => {
		const sweep = vi.fn(async () => {})
		const cleanup = new ImageCleanup(sweep, logger())
		const background = deferred()
		let reinstall!: Promise<void>
		await cleanup.runOperation(
			async () => {
				await cleanup.runOperation(async () => {}, {cleanupAfter: true})
				reinstall = cleanup.runOperation(() => background.promise)
			},
			{cleanupAfter: true},
		)
		expect(sweep).not.toHaveBeenCalled()
		background.resolve()
		await reinstall
		await cleanup.runOperation(async () => {})
		expect(sweep).toHaveBeenCalledOnce()
	})

	test('holds new operations until an ongoing sweep finishes and then allows them to overlap', async () => {
		const sweeping = deferred()
		const operation = deferred()
		const cleanup = new ImageCleanup(() => sweeping.promise, logger())
		await cleanup.runOperation(async () => {}, {cleanupAfter: true})
		const start = vi.fn(() => operation.promise)
		const first = cleanup.runOperation(start)
		const second = cleanup.runOperation(start)
		await Promise.resolve()
		expect(start).not.toHaveBeenCalled()
		sweeping.resolve()
		await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2))
		operation.resolve()
		await Promise.all([first, second])
	})

	test('logs cleanup failures without failing operations or leaving the gate locked', async () => {
		const log = logger()
		const failure = new Error('Docker unavailable')
		const sweep = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined)
		const cleanup = new ImageCleanup(sweep, log)
		await expect(cleanup.runOperation(async () => 'installed', {cleanupAfter: true})).resolves.toBe('installed')
		await cleanup.runOperation(async () => {}, {cleanupAfter: true})
		await cleanup.runOperation(async () => {})
		expect(log.error).toHaveBeenCalledWith('Failed to clean up unused Docker images', failure)
		expect(sweep).toHaveBeenCalledTimes(2)
	})

	test('defers pending cleanup during shutdown until startup has established the installed set again', async () => {
		const sweep = vi.fn(async () => {})
		const cleanup = new ImageCleanup(sweep, logger())
		await cleanup.runOperation(
			async () => {
				cleanup.enabled = false
			},
			{cleanupAfter: true},
		)
		expect(sweep).not.toHaveBeenCalled()
		await cleanup.runOperation(
			async () => {
				cleanup.enabled = true
				expect(sweep).not.toHaveBeenCalled()
			},
			{cleanupAfter: true},
		)
		await cleanup.runOperation(async () => {})
		expect(sweep).toHaveBeenCalledOnce()
	})
})

function dockerFixture() {
	const missing = Object.assign(new Error('No such image'), {statusCode: 404})
	const images = [
		{Id: 'shared', RepoTags: ['app:current', 'alias:latest'], RepoDigests: ['app@sha256:current']},
		{Id: 'tor', RepoTags: [], RepoDigests: ['tor@sha256:current']},
		{Id: 'running', RepoTags: ['other:running']},
		{Id: 'stopped', RepoTags: ['other:stopped']},
		{Id: 'old', RepoTags: ['old:one', 'old:two'], RepoDigests: ['old@sha256:old']},
		{Id: 'dangling', RepoTags: ['<none>:<none>'], RepoDigests: ['<none>@<none>']},
		{Id: 'manual', RepoTags: ['manually-pulled:latest']},
	]
	const inspect = vi.fn(async (reference: string) => {
		const image = images.find((image) =>
			[image.Id, ...(image.RepoTags ?? []), ...(image.RepoDigests ?? [])].includes(reference),
		)
		if (!image) throw missing
		return image
	})
	const remove = vi.fn(async (_reference: string, _options: unknown) => {})
	const listContainers = vi.fn(async () => [{ImageID: 'running'}, {ImageID: 'stopped'}])
	const docker = {
		listImages: vi.fn(async () => images),
		listContainers,
		getImage: (reference: string) => ({
			inspect: () => inspect(reference),
			remove: (options: unknown) => remove(reference, options),
		}),
	}
	return {docker: docker as unknown as Dockerode, inspect, remove, listContainers, missing}
}

describe('unused images', () => {
	test('keeps expected IDs and all container images, and removes tagged, digest-only and dangling leftovers', async () => {
		const {docker, remove} = dockerFixture()
		await removeUnusedImages(
			['app@sha256:current', 'alias:latest', 'tor@sha256:current', 'not-downloaded'],
			logger(),
			docker,
		)
		const removed = remove.mock.calls.map(([reference]) => reference)
		expect(removed).toEqual([
			'old:one',
			'old:two',
			'old@sha256:old',
			'old',
			'dangling',
			'manually-pulled:latest',
			'manual',
		])
		for (const [, options] of remove.mock.calls) expect(options).toEqual({force: false, noprune: true})
		expect(docker.listImages).toHaveBeenCalledWith({all: true})
		expect(docker.listContainers).toHaveBeenCalledOnce()
		expect(docker.listContainers).toHaveBeenCalledWith({all: true})
	})

	test('aborts before any deletion when an expected image cannot be inspected reliably', async () => {
		const {docker, inspect, remove} = dockerFixture()
		inspect.mockRejectedValueOnce(new Error('Docker connection lost'))
		await expect(removeUnusedImages(['app:current'], logger(), docker)).rejects.toThrow('Docker connection lost')
		expect(remove).not.toHaveBeenCalled()
	})

	test('aborts before deletion when containers cannot be listed', async () => {
		const {docker, listContainers, remove} = dockerFixture()
		listContainers.mockRejectedValueOnce(new Error('Docker connection lost'))
		await expect(removeUnusedImages([], logger(), docker)).rejects.toThrow('Docker connection lost')
		expect(remove).not.toHaveBeenCalled()
	})

	test('continues after a deletion conflict without forcing it', async () => {
		const {docker, remove} = dockerFixture()
		const log = logger()
		const conflict = Object.assign(new Error('image is in use'), {statusCode: 409})
		remove.mockRejectedValueOnce(conflict)
		await removeUnusedImages(['shared', 'tor'], log, docker)
		expect(log.error).toHaveBeenCalledWith('Could not remove unused Docker image old', conflict)
		expect(remove).toHaveBeenCalledWith('dangling', {force: false, noprune: true})
		expect(remove.mock.calls.map(([reference]) => reference)).not.toContain('old:two')
	})
})
