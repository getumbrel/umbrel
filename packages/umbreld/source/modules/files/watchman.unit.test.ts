import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

type PendingCommand = {args: any[]; callback: (error: Error | null, response?: any) => void}
type FakeClient = {
	commands: PendingCommand[]
	sent: any[][]
	ended: boolean
	emit: (event: string, ...args: any[]) => boolean
}

const clients = vi.hoisted(() => [] as FakeClient[])

vi.mock('fb-watchman', async () => {
	const {EventEmitter} = await import('node:events')
	class Client extends EventEmitter {
		commands: PendingCommand[] = []
		sent: any[][] = []
		ended = false
		constructor() {
			super()
			clients.push(this as unknown as FakeClient)
		}
		command(args: any[], callback: PendingCommand['callback']) {
			this.sent.push(args)
			this.commands.push({args, callback})
		}
		// Like fb-watchman, ending fails every queued and in-flight command
		end() {
			this.ended = true
			for (const {callback} of this.commands.splice(0)) callback(new Error('The client was ended'))
		}
	}
	return {default: {Client}}
})

import Watchman, {WatchmanFreshInstanceError, WatchmanSubscriptionLostError, type FileChangeEvent} from './watchman.ts'

const S_IFREG = 0o100644
const S_IFDIR = 0o040755

function respond(client: FakeClient, response: Record<string, unknown>) {
	const command = client.commands.shift()
	if (!command) throw new Error('No pending command')
	command.callback(null, response)
}

function fail(client: FakeClient, message: string) {
	const command = client.commands.shift()
	if (!command) throw new Error('No pending command')
	command.callback(new Error(message))
}

async function nextCommand(client: FakeClient) {
	await vi.waitFor(() => expect(client.commands.length).toBeGreaterThan(0))
	return client.commands[0].args
}

// The client waiting on a command for a directory. Each `watch` runs on a
// short-lived client of its own, and everything else on one shared client.
async function waitingOn(command: string, directory = '/data/home') {
	const find = () =>
		clients.find(
			(client) => !client.ended && client.commands[0]?.args[0] === command && client.commands[0]?.args[1] === directory,
		)
	await vi.waitFor(() => expect(find()).toBeDefined())
	return find()!
}

// Complete watch and clock, and return the shared client waiting on subscribe
async function acceptWatchAndClock(directory = '/data/home') {
	const watchClient = await waitingOn('watch', directory)
	respond(watchClient, {watch: 'root'})
	const client = await waitingOn('clock', directory)
	respond(client, {clock: 'c:1:1'})
	const args = await nextCommand(client)
	expect(args[0]).toBe('subscribe')
	return {client, watchClient, name: args[2] as string}
}

// Complete watch, clock and subscribe for the next subscription
async function acceptSubscription(directory = '/data/home') {
	const accepted = await acceptWatchAndClock(directory)
	respond(accepted.client, {subscribe: accepted.name})
	return accepted
}

async function subscribed(watchman: Watchman, directory = '/data/home') {
	const callback = vi.fn<(error: Error | null, events: FileChangeEvent[]) => void>()
	const promise = watchman.subscribe(directory, callback)
	const {client, watchClient, name} = await acceptSubscription(directory)
	const subscription = await promise
	return {subscription, callback, client, watchClient, name}
}

function notify(client: FakeClient, notification: Record<string, unknown>) {
	client.emit('subscription', notification)
}

const file = (name: string, {exists = true, isNew = false, mode = S_IFREG} = {}) => ({
	name,
	mode,
	exists,
	new: isNew,
})

beforeEach(() => {
	clients.length = 0
	vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']})
})

afterEach(() => vi.useRealTimers())

describe('subscribing', () => {
	test('watches the root on its own connection, then reads its clock and subscribes', async () => {
		const watchman = new Watchman()
		const {client, watchClient, name} = await subscribed(watchman)

		expect(watchClient.sent).toEqual([['watch', '/data/home']])
		expect(watchClient.ended).toBe(true)
		expect(client.sent).toEqual([
			['clock', '/data/home'],
			['subscribe', '/data/home', name, {fields: ['name', 'mode', 'exists', 'new'], since: 'c:1:1'}],
		])
	})

	test('shares one connection across subscriptions', async () => {
		const watchman = new Watchman()
		const home = await subscribed(watchman, '/data/home')
		const trash = await subscribed(watchman, '/data/trash')

		expect(trash.client).toBe(home.client)
	})

	test('rejects when Watchman refuses the watch', async () => {
		const watchman = new Watchman()
		const promise = watchman.subscribe('/missing', vi.fn())
		const watchClient = await waitingOn('watch', '/missing')
		fail(watchClient, 'unable to resolve root /missing')

		await expect(promise).rejects.toThrow('unable to resolve root /missing')
		expect(watchClient.ended).toBe(true)
	})

	test('rejects and leaves no subscription behind when Watchman refuses it', async () => {
		const watchman = new Watchman()
		const callback = vi.fn()
		const promise = watchman.subscribe('/data/home', callback)
		const {client} = await acceptWatchAndClock()
		fail(client, 'unable to resolve root /data/home')

		await expect(promise).rejects.toThrow('unable to resolve root /data/home')
		client.emit('end')
		expect(callback).not.toHaveBeenCalled()
	})

	test('delivers notifications that arrive before the subscribe response resumes the caller', async () => {
		const watchman = new Watchman()
		const callback = vi.fn()
		const promise = watchman.subscribe('/data/home', callback)
		const {client, name} = await acceptWatchAndClock()
		// The response and the first notification in the same read
		respond(client, {subscribe: name})
		notify(client, {subscription: name, files: [file('a.txt', {isNew: true})]})
		await promise

		expect(callback).toHaveBeenCalledWith(null, [{path: '/data/home/a.txt', type: 'create'}])
	})

	test('rejects a subscription Watchman cancels in the same read as acknowledging it', async () => {
		const watchman = new Watchman()
		const promise = watchman.subscribe('/data/home', vi.fn())
		const {client, name} = await acceptWatchAndClock()
		// The root was deleted just as the subscription was made
		respond(client, {subscribe: name})
		notify(client, {subscription: name, canceled: true})

		await expect(promise).rejects.toBeInstanceOf(WatchmanSubscriptionLostError)
	})
})

describe('events', () => {
	test("maps Watchman's fields the same way as @parcel/watcher", async () => {
		const watchman = new Watchman()
		const {client, name, callback} = await subscribed(watchman)

		notify(client, {
			subscription: name,
			files: [
				file('created', {isNew: true}),
				file('updated'),
				file('deleted', {exists: false}),
				file('new-directory', {isNew: true, mode: S_IFDIR}),
				file('touched-directory', {mode: S_IFDIR}),
				file('removed-directory', {exists: false, mode: S_IFDIR}),
				// Created and removed again before Watchman looked
				file('transient', {exists: false, isNew: true, mode: 0}),
			],
		})

		expect(callback).toHaveBeenCalledWith(null, [
			{path: '/data/home/created', type: 'create'},
			{path: '/data/home/deleted', type: 'delete'},
			{path: '/data/home/new-directory', type: 'create'},
			{path: '/data/home/removed-directory', type: 'delete'},
			{path: '/data/home/updated', type: 'update'},
		])
	})

	test('coalesces repeated changes to a path within a batch like @parcel/watcher', async () => {
		const watchman = new Watchman()
		const {client, name, callback} = await subscribed(watchman)
		// The first notification after a quiet period is delivered straight away,
		// so the following ones form one batch.
		notify(client, {subscription: name, files: [file('first', {isNew: true})]})
		callback.mockClear()

		notify(client, {subscription: name, files: [file('created-then-deleted', {isNew: true})]})
		notify(client, {subscription: name, files: [file('created-then-deleted', {exists: false})]})
		notify(client, {subscription: name, files: [file('deleted-then-created', {exists: false})]})
		notify(client, {subscription: name, files: [file('deleted-then-created', {isNew: true})]})
		notify(client, {subscription: name, files: [file('created-then-updated', {isNew: true})]})
		notify(client, {subscription: name, files: [file('created-then-updated')]})
		notify(client, {subscription: name, files: [file('updated-then-deleted')]})
		notify(client, {subscription: name, files: [file('updated-then-deleted', {exists: false})]})
		await vi.advanceTimersByTimeAsync(50)

		expect(callback).toHaveBeenCalledOnce()
		expect(callback).toHaveBeenCalledWith(null, [
			{path: '/data/home/created-then-updated', type: 'create'},
			{path: '/data/home/deleted-then-created', type: 'update'},
			{path: '/data/home/updated-then-deleted', type: 'delete'},
		])
	})

	test('sorts each batch by path bytes', async () => {
		const watchman = new Watchman()
		const {client, name, callback} = await subscribed(watchman)

		notify(client, {
			subscription: name,
			files: [file('é', {isNew: true}), file('b/c', {isNew: true}), file('B', {isNew: true}), file('b', {isNew: true})],
		})

		expect(callback.mock.calls[0][1].map(({path}) => path)).toEqual([
			'/data/home/B',
			'/data/home/b',
			'/data/home/b/c',
			'/data/home/é',
		])
	})

	test('sorts by path bytes where string order differs', async () => {
		const watchman = new Watchman()
		const {client, name, callback} = await subscribed(watchman)

		// U+1F600 is stored as the surrogates U+D83D U+DE00, which sort before
		// U+E000 as strings but after it as UTF-8 bytes
		notify(client, {
			subscription: name,
			files: [file('😀', {isNew: true}), file('\uE000', {isNew: true}), file('z', {isNew: true})],
		})

		expect(callback.mock.calls[0][1].map(({path}) => path)).toEqual([
			'/data/home/z',
			'/data/home/\uE000',
			'/data/home/😀',
		])
	})

	test('sorts random batches the same as comparing bytes', async () => {
		const watchman = new Watchman()
		const {client, name, callback} = await subscribed(watchman)
		const characters = [
			'a',
			'B',
			'z',
			'.',
			'-',
			' ',
			'é',
			'ß',
			'中',
			'\u07FF',
			'\u0800',
			'\uD7FF',
			'\uE000',
			'\uFFFD',
			'😀',
			'𝄞',
		]
		const randomName = (pool: string[]) =>
			Array.from({length: 1 + Math.floor(Math.random() * 6)}, () => pool[Math.floor(Math.random() * pool.length)]).join(
				'',
			)
		// Batches without code units from U+D800 up take the string comparison
		const lowCharacters = characters.filter((character) => !/[\uD800-\uFFFF]/.test(character))

		for (const pool of [characters, lowCharacters, characters, lowCharacters]) {
			callback.mockClear()
			const names = [...new Set(Array.from({length: 2000}, () => randomName(pool)))]
			notify(client, {subscription: name, files: names.map((fileName) => file(fileName, {isNew: true}))})
			await vi.advanceTimersByTimeAsync(600)

			const paths = callback.mock.calls[0][1].map(({path}) => path)
			const expected = [...paths].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
			expect(paths).toEqual(expected)
		}
	})

	test('delivers the first change straight away, then batches until changes pause', async () => {
		const watchman = new Watchman()
		const {client, name, callback} = await subscribed(watchman)

		notify(client, {subscription: name, files: [file('one', {isNew: true})]})
		expect(callback).toHaveBeenCalledTimes(1)

		notify(client, {subscription: name, files: [file('two', {isNew: true})]})
		await vi.advanceTimersByTimeAsync(40)
		notify(client, {subscription: name, files: [file('three', {isNew: true})]})
		await vi.advanceTimersByTimeAsync(40)
		expect(callback).toHaveBeenCalledTimes(1)

		await vi.advanceTimersByTimeAsync(10)
		expect(callback).toHaveBeenCalledTimes(2)
		expect(callback).toHaveBeenLastCalledWith(null, [
			{path: '/data/home/three', type: 'create'},
			{path: '/data/home/two', type: 'create'},
		])
	})

	test('flushes continuous changes at least every 500ms', async () => {
		const watchman = new Watchman()
		const {client, name, callback} = await subscribed(watchman)
		notify(client, {subscription: name, files: [file('first', {isNew: true})]})
		callback.mockClear()

		for (let i = 0; i < 20; i++) {
			await vi.advanceTimersByTimeAsync(30)
			notify(client, {subscription: name, files: [file(`file-${i}`, {isNew: true})]})
		}

		expect(callback).toHaveBeenCalled()
		expect(callback.mock.calls[0][1].length).toBeLessThan(20)
	})

	test('ignores unilateral messages without file changes', async () => {
		const watchman = new Watchman()
		const {client, name, callback} = await subscribed(watchman)

		notify(client, {subscription: name, 'state-enter': 'hg.update'})
		notify(client, {subscription: 'someone-else', files: [file('x', {isNew: true})]})

		expect(callback).not.toHaveBeenCalled()
	})

	test('reports a fresh instance instead of every file as created', async () => {
		const watchman = new Watchman()
		const {client, name, callback} = await subscribed(watchman)

		notify(client, {subscription: name, is_fresh_instance: true, files: [file('a', {isNew: true})]})

		expect(callback).toHaveBeenCalledOnce()
		expect(callback.mock.calls[0][0]).toBeInstanceOf(WatchmanFreshInstanceError)
		expect(callback.mock.calls[0][1]).toEqual([])

		// The subscription stays active
		notify(client, {subscription: name, files: [file('b', {isNew: true})]})
		await vi.advanceTimersByTimeAsync(50)
		expect(callback).toHaveBeenLastCalledWith(null, [{path: '/data/home/b', type: 'create'}])
	})

	test('passes subscription errors through without dropping the subscription', async () => {
		const watchman = new Watchman()
		const {client, name, callback} = await subscribed(watchman)

		notify(client, {subscription: name, error: 'A non-recoverable condition has triggered'})

		expect(callback.mock.calls[0][0]?.message).toBe('A non-recoverable condition has triggered')
		expect(callback.mock.calls[0][0]).not.toBeInstanceOf(WatchmanSubscriptionLostError)
	})
})

describe('lost subscriptions', () => {
	test('reports a subscription Watchman canceled and stops delivering it', async () => {
		const watchman = new Watchman()
		const {client, name, callback} = await subscribed(watchman)

		notify(client, {subscription: name, canceled: true})
		notify(client, {subscription: name, files: [file('late', {isNew: true})]})

		expect(callback).toHaveBeenCalledOnce()
		expect(callback.mock.calls[0][0]).toBeInstanceOf(WatchmanSubscriptionLostError)
	})

	test('reports every subscription on a connection that ends and reconnects for new ones', async () => {
		const watchman = new Watchman()
		const home = await subscribed(watchman, '/data/home')
		const trashCallback = vi.fn()
		const trash = watchman.subscribe('/data/trash', trashCallback)
		await acceptSubscription('/data/trash')
		await trash

		home.client.emit('end')

		expect(home.callback.mock.calls[0][0]).toBeInstanceOf(WatchmanSubscriptionLostError)
		expect(trashCallback.mock.calls[0][0]).toBeInstanceOf(WatchmanSubscriptionLostError)

		const again = await subscribed(watchman, '/data/home')
		expect(again.client).not.toBe(home.client)
	})

	test('handles a connection error without crashing and fails its commands', async () => {
		const watchman = new Watchman()
		const {client, callback} = await subscribed(watchman)
		const pending = watchman.subscribe('/data/trash', vi.fn())
		respond(await waitingOn('watch', '/data/trash'), {watch: 'root'})
		await waitingOn('clock', '/data/trash')

		// An EventEmitter 'error' without a listener would throw
		expect(() => client.emit('error', new Error('read ECONNRESET'))).not.toThrow()

		await expect(pending).rejects.toThrow()
		expect(callback.mock.calls[0][0]).toBeInstanceOf(WatchmanSubscriptionLostError)
		expect(client.ended).toBe(true)
	})

	test('drops the connection when Watchman stops responding', async () => {
		const watchman = new Watchman()
		const {client, callback} = await subscribed(watchman)
		const pending = watchman.subscribe('/data/trash', vi.fn())
		pending.catch(() => {})
		respond(await waitingOn('watch', '/data/trash'), {watch: 'root'})
		await waitingOn('clock', '/data/trash')

		await vi.advanceTimersByTimeAsync(60_000)

		await expect(pending).rejects.toThrow("Watchman did not respond to 'clock' within 60s")
		expect(callback.mock.calls[0][0]).toBeInstanceOf(WatchmanSubscriptionLostError)
		expect(client.ended).toBe(true)
	})

	test('gives the initial crawl of a large root much longer than other commands', async () => {
		const watchman = new Watchman()
		const pending = watchman.subscribe('/data/home', vi.fn())
		const watchClient = await waitingOn('watch')

		await vi.advanceTimersByTimeAsync(10 * 60_000)
		expect(watchClient.ended).toBe(false)

		const {client, name} = await acceptWatchAndClock()
		respond(client, {subscribe: name})
		await expect(pending).resolves.toBeDefined()
	})

	test("doesn't hold up other roots while a large root is crawled", async () => {
		const watchman = new Watchman()
		const home = await subscribed(watchman, '/data/home')
		const large = watchman.subscribe('/data/large', vi.fn())
		large.catch(() => {})
		await waitingOn('watch', '/data/large')

		// Commands queued behind the crawl would time out after 60s
		const trash = await subscribed(watchman, '/data/trash')
		await vi.advanceTimersByTimeAsync(2 * 60_000)
		notify(home.client, {subscription: home.name, files: [file('a', {isNew: true})]})
		const unsubscribed = trash.subscription.unsubscribe()
		respond(home.client, {unsubscribe: trash.name})
		await unsubscribed

		expect(home.client.ended).toBe(false)
		expect(home.callback).toHaveBeenCalledOnce()
		expect(home.callback).toHaveBeenCalledWith(null, [{path: '/data/home/a', type: 'create'}])
	})

	test('fails only the root whose crawl times out', async () => {
		const watchman = new Watchman()
		const home = await subscribed(watchman, '/data/home')
		const large = watchman.subscribe('/data/large', vi.fn())
		const rejected = expect(large).rejects.toThrow("Watchman did not respond to 'watch' within 1800s")
		const largeWatch = await waitingOn('watch', '/data/large')

		await vi.advanceTimersByTimeAsync(30 * 60_000)

		await rejected
		expect(largeWatch.ended).toBe(true)
		expect(home.client.ended).toBe(false)
		expect(home.callback).not.toHaveBeenCalled()
	})
})

describe('unsubscribing and closing', () => {
	test('unsubscribes and stops delivering events', async () => {
		const watchman = new Watchman()
		const {subscription, client, name, callback} = await subscribed(watchman)

		const unsubscribed = subscription.unsubscribe()
		expect(await nextCommand(client)).toEqual(['unsubscribe', '/data/home', name])
		respond(client, {unsubscribe: name})
		await unsubscribed
		notify(client, {subscription: name, files: [file('late', {isNew: true})]})

		expect(callback).not.toHaveBeenCalled()
	})

	test('discards a pending batch when unsubscribing', async () => {
		const watchman = new Watchman()
		const {subscription, client, name, callback} = await subscribed(watchman)
		notify(client, {subscription: name, files: [file('first', {isNew: true})]})
		notify(client, {subscription: name, files: [file('pending', {isNew: true})]})
		callback.mockClear()

		const unsubscribed = subscription.unsubscribe()
		await nextCommand(client)
		respond(client, {unsubscribe: name})
		await unsubscribed
		await vi.advanceTimersByTimeAsync(1000)

		expect(callback).not.toHaveBeenCalled()
	})

	test('treats unsubscribing on a lost connection as done', async () => {
		const watchman = new Watchman()
		const {subscription, client} = await subscribed(watchman)
		client.emit('end')

		await expect(subscription.unsubscribe()).resolves.toBeUndefined()
		expect(client.commands).toEqual([])
	})

	test('rejects an unsubscribe Watchman refuses so the caller can log it', async () => {
		const watchman = new Watchman()
		const {subscription, client} = await subscribed(watchman)

		const unsubscribed = subscription.unsubscribe()
		await nextCommand(client)
		fail(client, 'unable to resolve root /data/home')

		await expect(unsubscribed).rejects.toThrow('unable to resolve root /data/home')
	})

	test('closes without notifying subscribers, and later subscriptions reconnect', async () => {
		const watchman = new Watchman()
		const {client, callback} = await subscribed(watchman)

		watchman.close()
		client.emit('end')

		expect(client.ended).toBe(true)
		expect(callback).not.toHaveBeenCalled()
		const again = await subscribed(watchman)
		expect(again.client).not.toBe(client)
	})
})
