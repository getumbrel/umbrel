import {setTimeout as sleep} from 'node:timers/promises'
import {buffer} from 'node:stream/consumers'

import {expect, beforeAll, beforeEach, afterAll, afterEach, describe, test} from 'vitest'
import {createTRPCProxyClient, createWSClient, wsLink} from '@trpc/client'
import archiver from 'archiver'
import {WebSocket} from 'ws'
import got from 'got'
import {CookieJar} from 'tough-cookie'
import pWaitFor from 'p-wait-for'

import {createTestVm} from '../test-utilities/create-test-umbreld.ts'
import runGitServer from '../test-utilities/run-git-server.ts'
import type {AppRouter} from '../server/trpc/common.ts'
import type {events} from '../event-bus/event-bus.ts'
import * as totp from '../utilities/totp.ts'
import {resolveWallpaperAppearance} from './wallpapers.ts'

type BrowserSession = {
	dashboardToken: string
	browserCookie: string
	appCookie: string
	setCookies: string[]
}

const browserSessions = new Map<string, BrowserSession>()

function trpcData<T>(body: unknown) {
	return (body as {result?: {data?: T}}).result?.data as T
}

async function tarWithSymlink(path: string, target: string) {
	const archive = archiver('tar')
	const contents = buffer(archive)
	archive.symlink(path, target)
	await archive.finalize()
	return contents
}

async function issueWebSocketTicket(port: number, token: string, target: 'trpc' | 'terminal' | 'machines') {
	const session = browserSessions.get(token)
	if (!session) return
	const response = await got.post(`http://localhost:${port}/trpc/user.createWebSocketTicket`, {
		json: {target},
		headers: {authorization: `Bearer ${token}`, cookie: session.browserCookie},
		responseType: 'json',
		throwHttpErrors: false,
		retry: {limit: 0},
	})
	if (response.statusCode !== 200) return
	return trpcData<string>(response.body)
}

// Open an event subscription over a websocket authenticated with the given
// token and resolve whether it was allowed to start or rejected. This exercises
// role enforcement on the websocket transport (not just http).
async function trySubscriptionOverWebSocket(
	port: number,
	token: string,
	event: 'system:disk:change' | 'files:operation-progress' | 'machines:updated',
): Promise<'started' | 'error'> {
	const wsClient = createWSClient({
		url: async () => {
			const ticket = await issueWebSocketTicket(port, token, 'trpc')
			if (!ticket) throw new Error('Unable to mint WebSocket ticket')
			return `ws://localhost:${port}/trpc?ticket=${ticket}`
		},
		retryDelayMs: () => 100,
	})
	const client = createTRPCProxyClient<AppRouter>({links: [wsLink({client: wsClient})]})
	try {
		return await new Promise<'started' | 'error'>((resolve) => {
			const subscription = client.eventBus.listen.subscribe(
				{event},
				{
					onStarted: () => resolve('started'),
					onError: () => resolve('error'),
				},
			)
			// Safety net so the test can't hang
			setTimeout(() => {
				subscription.unsubscribe()
				resolve('error')
			}, 10_000)
		})
	} finally {
		wsClient.close()
	}
}

async function tryRawWebSocketUpgrade(port: number, path: string, token: string): Promise<'open' | 'closed'> {
	const target = path.startsWith('/terminal') ? 'terminal' : 'trpc'
	const ticket = await issueWebSocketTicket(port, token, target)
	if (!ticket) return 'closed'
	return new Promise((resolve) => {
		const separator = path.includes('?') ? '&' : '?'
		const ws = new WebSocket(`ws://localhost:${port}${path}${separator}ticket=${ticket}`)
		let settled = false
		const settle = (result: 'open' | 'closed') => {
			if (settled) return
			settled = true
			ws.removeAllListeners()
			if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close()
			resolve(result)
		}
		ws.on('open', () => settle('open'))
		ws.on('error', () => settle('closed'))
		ws.on('close', () => settle('closed'))
		setTimeout(() => settle('closed'), 10_000)
	})
}

// Subscribe to events over a websocket authenticated with the given token and
// collect everything streamed to it. Await `started` before triggering the
// action under test, otherwise events emitted while the subscription is still
// being established are silently missed.
function subscribeToEventsAs<T>(port: number, token: string, event: (typeof events)[number]) {
	const wsClient = createWSClient({
		url: async () => {
			const ticket = await issueWebSocketTicket(port, token, 'trpc')
			if (!ticket) throw new Error('Unable to mint WebSocket ticket')
			return `ws://localhost:${port}/trpc?ticket=${ticket}`
		},
		retryDelayMs: () => 100,
	})
	const client = createTRPCProxyClient<AppRouter>({links: [wsLink({client: wsClient})]})
	const collected: T[] = []
	let resolveStarted = () => {}
	const started = new Promise<void>((resolve) => {
		resolveStarted = resolve
	})
	const subscription = client.eventBus.listen.subscribe(
		{event},
		{
			onStarted: () => resolveStarted(),
			onData: (data) => collected.push(data as T),
			onError: (error) => console.error(`Subscription error for ${event}:`, error),
		},
	)
	return {
		collected,
		started,
		close: () => {
			subscription.unsubscribe()
			wsClient.close()
		},
	}
}

describe('Multi-user accounts', () => {
	let umbreld: Awaited<ReturnType<typeof createTestVm>>
	let gitServer: Awaited<ReturnType<typeof runGitServer>>
	let failed = false
	const expectedDefaultWallpaper = resolveWallpaperAppearance('23')

	const ownerCredentials = {
		name: 'satoshi',
		password: 'moneyprintergobrrr',
	}

	const memberCredentials = {
		name: 'hal',
		password: 'runningbitcoin',
	}

	let memberUserId: string
	let ownerToken: string
	let memberToken: string
	let appHostPort: number

	async function createBrowserSession(
		credentials: {userId?: string; password: string; totpToken?: string},
		userAgent?: string,
	) {
		const response = await got.post(`http://localhost:${umbreld.vm.httpPort}/trpc/user.login`, {
			json: credentials,
			headers: userAgent ? {'user-agent': userAgent} : undefined,
			responseType: 'json',
			retry: {limit: 0},
		})
		const setCookies = response.headers['set-cookie'] ?? []
		const serializedCookie = (name: string) => {
			const cookie = setCookies.find((value) => value.startsWith(`${name}=`))
			if (!cookie) throw new Error(`Login did not set ${name}`)
			return cookie.split(';')[0]!
		}
		const session = {
			dashboardToken: trpcData<string>(response.body),
			browserCookie: serializedCookie('UMBREL_BROWSER_SESSION'),
			appCookie: serializedCookie('UMBREL_APP_SESSION'),
			setCookies,
		}
		browserSessions.set(session.dashboardToken, session)
		return session
	}

	beforeAll(async () => {
		umbreld = await createTestVm({
			device: 'umbrel-home',
			forwardPorts: [{guestPort: 4000}],
		})
		gitServer = await runGitServer()
		await umbreld.vm.powerOn()
		appHostPort = umbreld.vm.getHostPort(4000)
		await umbreld.signup()
		ownerToken = (await createBrowserSession({password: ownerCredentials.password})).dashboardToken
		await loginAs(ownerToken)
	})

	afterAll(async () => {
		await umbreld?.cleanup()
		await gitServer?.close()
	})

	// The tests are stateful and must run in order, once one fails the rest
	// would only produce misleading cascade failures, so skip them
	afterEach(({task}) => {
		if (task.result?.state === 'fail') failed = true
	})

	beforeEach(({skip}) => {
		if (failed) skip()
	})

	// Switch the authenticated client between accounts
	async function loginAs(token: string) {
		const session = browserSessions.get(token)
		if (!session) throw new Error('Unknown browser session')
		await umbreld.setBrowserSession(token, session.setCookies)
	}

	async function requestApp(token?: string) {
		const session = token ? browserSessions.get(token) : undefined
		return got.get(`http://127.0.0.1:${appHostPort}/`, {
			headers: {
				host: 'umbrel.local:4000',
				...(session ? {cookie: session.appCookie} : {}),
			},
			followRedirect: false,
			throwHttpErrors: false,
			retry: {limit: 0},
		})
	}

	async function openAppWebSocket(token: string) {
		const session = browserSessions.get(token)
		if (!session) throw new Error('Unknown browser session')
		return new Promise<WebSocket>((resolve, reject) => {
			const socket = new WebSocket(`ws://127.0.0.1:${appHostPort}/socket`, {
				headers: {
					host: 'umbrel.local:4000',
					cookie: session.appCookie,
				},
			})
			const timeout = setTimeout(() => {
				socket.terminate()
				reject(new Error('App WebSocket did not open'))
			}, 10_000)
			socket.once('open', () => {
				clearTimeout(timeout)
				resolve(socket)
			})
			socket.once('error', (error) => {
				clearTimeout(timeout)
				reject(error)
			})
		})
	}

	test('listAccounts() initially returns just the owner', async () => {
		await expect(umbreld.client.user.listAccounts.query()).resolves.toStrictEqual([
			{userId: '0', name: ownerCredentials.name, wallpaper: expectedDefaultWallpaper, language: 'en'},
		])
	})

	test('createUser() rejects short passwords', async () => {
		await expect(
			umbreld.client.user.createUser.mutate({name: memberCredentials.name, password: 'short'}),
		).rejects.toThrow('Password must be at least 6 characters')
	})

	test("createUser() rejects the owner's name", async () => {
		await expect(
			umbreld.client.user.createUser.mutate({name: ownerCredentials.name, password: memberCredentials.password}),
		).rejects.toThrow('already exists')
	})

	test('createUser() creates a member with a slug id derived from the name', async () => {
		const member = await umbreld.client.user.createUser.mutate(memberCredentials)
		expect(member.name).toBe(memberCredentials.name)
		// 'hal' -> 'Hal'
		expect(member.userId).toBe('Hal')
		memberUserId = member.userId
	})

	test('createUser() rejects duplicate member names', async () => {
		await expect(umbreld.client.user.createUser.mutate(memberCredentials)).rejects.toThrow('already exists')
	})

	test('createUser() derives a unique slug on collision', async () => {
		// A different name that normalises to the same slug as 'Hal' gets a -n suffix
		const second = await umbreld.client.user.createUser.mutate({name: 'H-A-L', password: 'passwordpassword'})
		expect(second.userId).toBe('Hal-2')
		await umbreld.client.user.deleteUser.mutate({userId: second.userId})

		// Deleted ids are permanent security identities and are never reassigned.
		const third = await umbreld.client.user.createUser.mutate({name: 'H-A-L', password: 'passwordpassword'})
		expect(third.userId).toBe('Hal-3')
		// Clean up so the rest of the suite sees just the owner and Hal.
		await umbreld.client.user.deleteUser.mutate({userId: third.userId})
	})

	test('listAccounts() returns the owner and the member', async () => {
		const accounts = [
			{userId: '0', name: ownerCredentials.name, wallpaper: expectedDefaultWallpaper, language: 'en'},
			{userId: memberUserId, name: memberCredentials.name, wallpaper: expectedDefaultWallpaper, language: 'en'},
		]
		await expect(umbreld.client.user.listAccounts.query()).resolves.toStrictEqual(accounts)

		// The restricted app-auth origin uses the same public account picker data.
		await expect(
			got.get(`http://127.0.0.1:${umbreld.vm.httpPort}/app-auth/v1/account/accounts`, {retry: {limit: 0}}).json(),
		).resolves.toStrictEqual(accounts)
	})

	test('login rejects an unknown user id', async () => {
		await expect(
			umbreld.unauthenticatedClient.user.login.mutate({userId: 'deadbeef', password: memberCredentials.password}),
		).rejects.toThrow('Incorrect password')
	})

	test("login rejects a member id with the owner's password", async () => {
		await expect(
			umbreld.unauthenticatedClient.user.login.mutate({userId: memberUserId, password: ownerCredentials.password}),
		).rejects.toThrow('Incorrect password')
	})

	test('member can log in and gets a token', async () => {
		memberToken = (
			await createBrowserSession({
				userId: memberUserId,
				password: memberCredentials.password,
			})
		).dashboardToken
		expect(memberToken).toBeTypeOf('string')
	})

	test('member get returns their own account with member role', async () => {
		await loginAs(memberToken)
		const account = await umbreld.client.user.get.query()
		expect(account.name).toBe(memberCredentials.name)
		expect(account.role).toBe('member')
	})

	test("member starts with the owner's language at creation", async () => {
		// The member copied English when it was created. Later owner changes are independent.
		await loginAs(ownerToken)
		await umbreld.client.user.set.mutate({language: 'fr'})

		await loginAs(memberToken)
		await expect(umbreld.client.user.get.query()).resolves.toMatchObject({language: 'en'})
		await expect(umbreld.client.user.language.query()).resolves.toBe('en')
		await expect(umbreld.client.user.listAccounts.query()).resolves.toContainEqual({
			userId: memberUserId,
			name: memberCredentials.name,
			wallpaper: expectedDefaultWallpaper,
			language: 'en',
		})
	})

	test('member language preference overrides the owner without changing it', async () => {
		await loginAs(memberToken)
		await umbreld.client.user.set.mutate({language: 'de'})
		await expect(umbreld.client.user.get.query()).resolves.toMatchObject({language: 'de'})
		await expect(umbreld.client.user.language.query()).resolves.toBe('de')

		// The legacy unauthenticated endpoint remains owner-scoped, while the
		// account picker payload exposes the selected member's effective language.
		await expect(umbreld.unauthenticatedClient.user.language.query()).resolves.toBe('fr')
		await expect(umbreld.unauthenticatedClient.user.listAccounts.query()).resolves.toContainEqual({
			userId: memberUserId,
			name: memberCredentials.name,
			wallpaper: expectedDefaultWallpaper,
			language: 'de',
		})

		// Later owner changes do not replace the member's explicit preference.
		await loginAs(ownerToken)
		await umbreld.client.user.set.mutate({language: 'es'})
		await expect(umbreld.client.user.language.query()).resolves.toBe('es')

		await loginAs(memberToken)
		await expect(umbreld.client.user.language.query()).resolves.toBe('de')
	})

	test("member's home has the default skeleton at /Users/<slug>", async () => {
		await loginAs(memberToken)
		const listing = await umbreld.client.files.list.query({path: `/Users/${memberUserId}`})
		const names = listing.files.map((file) => file.name).sort()
		expect(names).toStrictEqual(['Documents', 'Downloads', 'Photos', 'Videos'])

		// Members may export and favorite eligible folders from their own Home.
		const documents = listing.files.find((file) => file.name === 'Documents')!
		expect(documents.operations).toContain('share')
		expect(documents.operations).toContain('favorite')
	})

	test('member favorites and the Files favorites widget are account-scoped', async () => {
		await loginAs(memberToken)
		const memberHome = `/Users/${memberUserId}`
		await expect(umbreld.client.files.favorites.query()).resolves.toStrictEqual(
			['Downloads', 'Documents', 'Photos', 'Videos'].map((folder) => `${memberHome}/${folder}`),
		)

		// Keep the new favorite within the widget's four-item display limit.
		await umbreld.client.files.removeFavorite.mutate({path: `${memberHome}/Videos`})
		await umbreld.client.files.createDirectory.mutate({path: `${memberHome}/favorite-me`})
		await umbreld.client.files.addFavorite.mutate({path: `${memberHome}/favorite-me`})
		expect((await umbreld.client.widget.data.query({widgetId: 'umbrel:files-favorites'})).paths).toContain(
			`${memberHome}/favorite-me`,
		)

		await loginAs(ownerToken)
		expect(await umbreld.client.files.favorites.query()).not.toContain(`${memberHome}/favorite-me`)
		expect((await umbreld.client.widget.data.query({widgetId: 'umbrel:files-favorites'})).paths).not.toContain(
			`${memberHome}/favorite-me`,
		)
		await loginAs(memberToken)
	})

	test("member home and trash changes are watched like the owner's filesystem", async () => {
		type FileChange = {type: 'create' | 'update' | 'delete'; path: string}
		const changes = subscribeToEventsAs<FileChange>(umbreld.vm.httpPort, memberToken, 'files:watcher:change')
		await changes.started

		const memberRoot = `${umbreld.vm.dataDirectory}/members/${memberUserId}`
		try {
			await umbreld.vm.sshAsRoot(
				`touch '${memberRoot}/home/Documents/watched-home.txt' '${memberRoot}/trash/watched-trash.txt'`,
			)
			await pWaitFor(
				() => {
					const paths = changes.collected.map((change) => change.path)
					return (
						paths.includes(`/Users/${memberUserId}/Documents/watched-home.txt`) &&
						paths.includes(`/Users/${memberUserId}/Trash/watched-trash.txt`)
					)
				},
				{interval: 100, timeout: 10_000},
			)
			await pWaitFor(
				async () =>
					(await umbreld.client.widget.data.query({widgetId: 'umbrel:files-recents'})).items.some(
						(file: {name: string}) => file.name === 'watched-home.txt',
					),
				{interval: 100, timeout: 10_000},
			)

			await loginAs(ownerToken)
			expect((await umbreld.client.widget.data.query({widgetId: 'umbrel:files-recents'})).items).not.toEqual(
				expect.arrayContaining([expect.objectContaining({name: 'watched-home.txt'})]),
			)
			await loginAs(memberToken)
		} finally {
			changes.close()
			await umbreld.vm.sshAsRoot(
				`rm -f '${memberRoot}/home/Documents/watched-home.txt' '${memberRoot}/trash/watched-trash.txt'`,
			)
			await loginAs(memberToken)
		}
	})

	test("member cannot list the owner's root or base directories", async () => {
		await loginAs(memberToken)
		await expect(umbreld.client.files.list.query({path: '/'})).rejects.toThrow()
		await expect(umbreld.client.files.list.query({path: '/Home'})).rejects.toThrow('forbidden')
		await expect(umbreld.client.files.list.query({path: '/Apps'})).rejects.toThrow('forbidden')
	})

	test("member cannot access another user's files", async () => {
		await loginAs(memberToken)
		await expect(umbreld.client.files.list.query({path: '/Users/someone-else'})).rejects.toThrow('forbidden')
	})

	test('member and owner homes are isolated', async () => {
		// Member creates a file in their own home
		await loginAs(memberToken)
		await umbreld.client.files.createDirectory.mutate({path: `/Users/${memberUserId}/member-only`})

		// Owner creates a file in their home
		await loginAs(ownerToken)
		await umbreld.client.files.createDirectory.mutate({path: '/Home/owner-only'})

		// Owner doesn't see the member's directory
		const ownerHome = await umbreld.client.files.list.query({path: '/Home'})
		const ownerNames = ownerHome.files.map((file) => file.name)
		expect(ownerNames).toContain('owner-only')
		expect(ownerNames).not.toContain('member-only')

		// Member doesn't see the owner's directory
		await loginAs(memberToken)
		const memberHome = await umbreld.client.files.list.query({path: `/Users/${memberUserId}`})
		const memberNames = memberHome.files.map((file) => file.name)
		expect(memberNames).toContain('member-only')
		expect(memberNames).not.toContain('owner-only')
	})

	test('members are denied owner-only endpoints', async () => {
		await loginAs(memberToken)
		await expect(umbreld.client.user.listAccounts.query()).resolves.toBeDefined() // public, allowed
		await expect(umbreld.client.user.createUser.mutate({name: 'eve', password: 'passwordpassword'})).rejects.toThrow(
			'owner',
		)
		await expect(umbreld.client.user.deleteUser.mutate({userId: memberUserId})).rejects.toThrow('owner')
		await expect(umbreld.client.machines.list.query()).rejects.toThrow('owner')
		await expect(umbreld.client.machines.capabilities.query()).rejects.toThrow('owner')
	})

	test('members can view the read-only device summary', async () => {
		await loginAs(memberToken)
		await expect(umbreld.client.system.deviceName.query()).resolves.toBeTypeOf('string')
		await expect(umbreld.client.system.version.query()).resolves.toMatchObject({version: expect.any(String)})
		await expect(umbreld.client.system.getIpAddresses.query()).resolves.toEqual(
			expect.arrayContaining([expect.any(String)]),
		)
		await expect(umbreld.client.system.uptime.query()).resolves.toBeGreaterThan(0)

		// Device management remains owner-only.
		await expect(umbreld.client.system.getNetworkInterfaces.query()).rejects.toThrow('owner')
	})

	test('members get empty apps and the default umbrel widgets before any apps are shared', async () => {
		await loginAs(memberToken)
		// The app list is empty, widgets fall back to the umbrel defaults at read
		// time, and unshared app widget data stays inaccessible.
		await expect(umbreld.client.apps.list.query()).resolves.toStrictEqual([])
		await expect(umbreld.client.widget.enabled.query()).resolves.toStrictEqual([
			'umbrel:files-favorites',
			'umbrel:storage',
			'umbrel:system-stats',
		])
		await expect(umbreld.client.widget.data.query({widgetId: 'bitcoin:stats'})).rejects.toThrow('[widget-not-found]')

		// The owner still sees their real apps/widgets
		await loginAs(ownerToken)
		await expect(umbreld.client.widget.enabled.query()).resolves.toBeInstanceOf(Array)
	})

	test('member can trash and restore within their own home', async () => {
		await loginAs(memberToken)
		await umbreld.client.files.createDirectory.mutate({path: `/Users/${memberUserId}/Documents/note`})
		const trashedPath = await umbreld.client.files.trash.mutate({path: `/Users/${memberUserId}/Documents/note`})
		expect(trashedPath).toContain(`/Users/${memberUserId}/Trash/`)

		// It shows in the member's trash
		const trash = await umbreld.client.files.list.query({path: `/Users/${memberUserId}/Trash`})
		expect(trash.files.map((file) => file.name)).toContain('note')

		// Restore puts it back
		await umbreld.client.files.restore.mutate({path: trashedPath})
		const documents = await umbreld.client.files.list.query({path: `/Users/${memberUserId}/Documents`})
		expect(documents.files.map((file) => file.name)).toContain('note')
	})

	test('the http file api scopes uploads to the authenticated account', async () => {
		await loginAs(ownerToken)
		await umbreld.api.post('files/upload?path=/Home/owner-http.txt', {body: 'owner upload'})

		// Owner sees it and can read it back over http
		const ownerHome = await umbreld.client.files.list.query({path: '/Home'})
		expect(ownerHome.files.map((file) => file.name)).toContain('owner-http.txt')
		const download = await umbreld.api.get('files/view?path=/Home/owner-http.txt', {responseType: 'text'})
		expect(download.body).toBe('owner upload')

		// Member's home is unaffected
		await loginAs(memberToken)
		const memberHome = await umbreld.client.files.list.query({path: `/Users/${memberUserId}`})
		expect(memberHome.files.map((file) => file.name)).not.toContain('owner-http.txt')

		await umbreld.api.post(`files/upload?path=${encodeURIComponent(`/Users/${memberUserId}/member-http.txt`)}`, {
			body: 'member upload',
		})
		const memberDownload = await umbreld.api.get(
			`files/view?path=${encodeURIComponent(`/Users/${memberUserId}/member-http.txt`)}`,
			{responseType: 'text'},
		)
		expect(memberDownload.body).toBe('member upload')
	})

	test('websocket role enforcement blocks members from owner-only subscriptions', async () => {
		const port = umbreld.vm.httpPort
		// The owner can start an owner-only event subscription over websocket
		await expect(trySubscriptionOverWebSocket(port, ownerToken, 'system:disk:change')).resolves.toBe('started')
		// A member cannot, even over websocket (which previously bypassed role checks)
		await expect(trySubscriptionOverWebSocket(port, memberToken, 'system:disk:change')).resolves.toBe('error')
		await expect(trySubscriptionOverWebSocket(port, ownerToken, 'machines:updated')).resolves.toBe('started')
		await expect(trySubscriptionOverWebSocket(port, memberToken, 'machines:updated')).resolves.toBe('error')
	})

	test('members can subscribe to their own scoped events', async () => {
		const port = umbreld.vm.httpPort
		// Operation progress is whitelisted for members (filtered to their own operations)
		await expect(trySubscriptionOverWebSocket(port, memberToken, 'files:operation-progress')).resolves.toBe('started')
	})

	test('terminal websockets are owner-only', async () => {
		const port = umbreld.vm.httpPort
		await expect(tryRawWebSocketUpgrade(port, '/terminal?rows=24&cols=80', memberToken)).resolves.toBe('closed')
		await expect(
			tryRawWebSocketUpgrade(port, '/terminal?appId=sparkles-hello-world&rows=24&cols=80', memberToken),
		).resolves.toBe('closed')
	})

	test('terminal websockets open for the owner', async () => {
		const port = umbreld.vm.httpPort
		await expect(tryRawWebSocketUpgrade(port, '/terminal?rows=24&cols=80', ownerToken)).resolves.toBe('open')
	})

	test('machine console and audio websocket tickets are owner-only', async () => {
		const port = umbreld.vm.httpPort
		await expect(issueWebSocketTicket(port, memberToken, 'machines')).resolves.toBeUndefined()
		await expect(issueWebSocketTicket(port, ownerToken, 'machines')).resolves.toMatch(/^[0-9a-f]+$/)
	})

	test('view preferences are scoped per account', async () => {
		await loginAs(ownerToken)
		const ownerPreferences = await umbreld.client.files.viewPreferences.query()

		// Member updates their own preferences
		await loginAs(memberToken)
		await umbreld.client.files.updateViewPreferences.mutate({view: 'list', sortBy: 'size'})
		const memberPreferences = await umbreld.client.files.viewPreferences.query()
		expect(memberPreferences.view).toBe('list')
		expect(memberPreferences.sortBy).toBe('size')

		// The owner's preferences are unaffected
		await loginAs(ownerToken)
		await expect(umbreld.client.files.viewPreferences.query()).resolves.toStrictEqual(ownerPreferences)
	})

	test('profile settings are scoped per account', async () => {
		await loginAs(ownerToken)
		const ownerWallpaper = (await umbreld.client.user.get.query()).wallpaper

		// Member sets their own wallpaper
		await loginAs(memberToken)
		await umbreld.client.user.set.mutate({wallpaper: '3'})
		await expect(umbreld.client.user.get.query()).resolves.toMatchObject({
			wallpaper: resolveWallpaperAppearance('3'),
		})
		await expect(umbreld.client.user.listAccounts.query()).resolves.toContainEqual({
			userId: memberUserId,
			name: memberCredentials.name,
			wallpaper: resolveWallpaperAppearance('3'),
			language: 'de',
		})

		// Members can't take an existing account's name
		await expect(umbreld.client.user.set.mutate({name: ownerCredentials.name})).rejects.toThrow('already exists')

		// The owner's wallpaper is unaffected
		await loginAs(ownerToken)
		await expect(umbreld.client.user.get.query()).resolves.toMatchObject({wallpaper: ownerWallpaper})
		// Uniqueness applies in both directions so the account picker never has
		// two entries with the same display name.
		await expect(umbreld.client.user.set.mutate({name: memberCredentials.name})).rejects.toThrow('already exists')
	})

	test('member can change their own password', async () => {
		await loginAs(memberToken)

		// The old password must be correct
		await expect(
			umbreld.client.user.changePassword.mutate({oldPassword: 'wrong-password', newPassword: 'satoshishotfirst'}),
		).rejects.toThrow('Incorrect password')

		// Change the password
		await umbreld.client.user.changePassword.mutate({
			oldPassword: memberCredentials.password,
			newPassword: 'satoshishotfirst',
		})

		// The old password no longer works, the new one does
		await expect(
			umbreld.unauthenticatedClient.user.login.mutate({userId: memberUserId, password: memberCredentials.password}),
		).rejects.toThrow('Incorrect password')
		await expect(
			umbreld.unauthenticatedClient.user.login.mutate({userId: memberUserId, password: 'satoshishotfirst'}),
		).resolves.toBeTypeOf('string')
		memberCredentials.password = 'satoshishotfirst'

		// The owner's password is unaffected
		await expect(
			umbreld.unauthenticatedClient.user.login.mutate({password: ownerCredentials.password}),
		).resolves.toBeTypeOf('string')
	})

	test('member can enable 2fa for their own account', async () => {
		await loginAs(memberToken)
		const totpUri = await umbreld.client.user.generateTotpUri.query()
		await umbreld.client.user.enable2fa.mutate({totpUri, totpToken: totp.generateToken(totpUri)})
		await expect(umbreld.client.user.is2faEnabled.query()).resolves.toBe(true)

		// The owner's 2fa status is unaffected
		await loginAs(ownerToken)
		await expect(umbreld.client.user.is2faEnabled.query()).resolves.toBe(false)

		// Member login now requires a totp token
		await expect(
			umbreld.unauthenticatedClient.user.login.mutate({userId: memberUserId, password: memberCredentials.password}),
		).rejects.toThrow('Missing 2FA code')
		await expect(
			umbreld.unauthenticatedClient.user.login.mutate({
				userId: memberUserId,
				password: memberCredentials.password,
				totpToken: totp.generateToken(totpUri),
			}),
		).resolves.toBeTypeOf('string')

		// Owner login is unaffected by the member's 2fa
		await expect(
			umbreld.unauthenticatedClient.user.login.mutate({password: ownerCredentials.password}),
		).resolves.toBeTypeOf('string')
	})

	test("owner can reset a member's password, clearing their 2fa", async () => {
		// Members can't reset passwords
		await loginAs(memberToken)
		await expect(
			umbreld.client.user.resetUserPassword.mutate({userId: memberUserId, password: 'newmemberpassword'}),
		).rejects.toThrow('owner')

		// The owner's own password can't be reset this way
		await loginAs(ownerToken)
		await expect(
			umbreld.client.user.resetUserPassword.mutate({userId: '0', password: 'newownerpassword'}),
		).rejects.toThrow('cannot be reset')

		// Owner resets the member's password
		await umbreld.client.user.resetUserPassword.mutate({userId: memberUserId, password: 'newmemberpassword'})

		// The member can log in with the new password without a totp token since
		// the reset also cleared their 2fa (recovery for a lost authenticator)
		await expect(
			umbreld.unauthenticatedClient.user.login.mutate({userId: memberUserId, password: 'newmemberpassword'}),
		).resolves.toBeTypeOf('string')
		memberCredentials.password = 'newmemberpassword'

		await loginAs(memberToken)
		await expect(umbreld.client.user.is2faEnabled.query()).resolves.toBe(false)
		// Password recovery deliberately preserves active sessions. The owner
		// can inspect and revoke them separately when compromise is suspected.
		await expect(umbreld.client.user.get.query()).resolves.toMatchObject({userId: memberUserId})
	})

	test('members manage only their own sessions and the owner can administer member sessions', async () => {
		const managedSession = await createBrowserSession(
			{userId: memberUserId, password: memberCredentials.password},
			'Managed member browser/1.0',
		)

		// A member sees their own sessions but cannot inspect the owner's.
		await loginAs(memberToken)
		await expect(umbreld.client.user.listSessions.query()).resolves.toEqual(
			expect.arrayContaining([expect.objectContaining({current: true})]),
		)
		await expect(umbreld.client.user.listAccountSessions.query({userId: '0'})).rejects.toThrow('owner')

		// The owner can identify and revoke an individual member session.
		await loginAs(ownerToken)
		const sessions = await umbreld.client.user.listAccountSessions.query({userId: memberUserId})
		const target = sessions.find(
			(session) => session.client.type === 'browser' && session.client.userAgent === 'Managed member browser/1.0',
		)
		if (!target) throw new Error('Managed member session was not listed')
		expect(target.current).toBe(false)
		await expect(
			umbreld.client.user.revokeAccountSession.mutate({userId: memberUserId, sessionId: target.id}),
		).resolves.toEqual({revoked: true, revokedCurrent: false})

		await loginAs(managedSession.dashboardToken)
		await expect(umbreld.client.user.get.query()).rejects.toThrow('Invalid token')

		// Revoking every member session leaves the owner's session intact.
		await loginAs(ownerToken)
		const result = await umbreld.client.user.revokeAllAccountSessions.mutate({userId: memberUserId})
		expect(result.revokedCount).toBeGreaterThan(0)
		expect(result.revokedCurrent).toBe(false)
		await expect(umbreld.client.user.get.query()).resolves.toMatchObject({role: 'owner'})

		await loginAs(memberToken)
		await expect(umbreld.client.user.get.query()).rejects.toThrow('Invalid token')

		// Continue the stateful suite with a fresh member session.
		memberToken = (
			await createBrowserSession({userId: memberUserId, password: memberCredentials.password}, 'Member primary/2.0')
		).dashboardToken
	})

	test('member can archive and unarchive their own files', async () => {
		await loginAs(memberToken)
		await umbreld.client.files.createDirectory.mutate({path: `/Users/${memberUserId}/Documents/zipme`})
		const zipPath = await umbreld.client.files.archive.mutate({paths: [`/Users/${memberUserId}/Documents/zipme`]})
		expect(zipPath).toBe(`/Users/${memberUserId}/Documents/zipme.zip`)
		const unarchivedPath = await umbreld.client.files.unarchive.mutate({path: zipPath})
		expect(unarchivedPath).toContain(`/Users/${memberUserId}/Documents/zipme`)

		// Owner paths are rejected
		await expect(umbreld.client.files.archive.mutate({paths: ['/Home/Documents']})).rejects.toThrow('forbidden')
		await expect(umbreld.client.files.unarchive.mutate({path: '/Home/archive.zip'})).rejects.toThrow()
	})

	test('archive symlinks cannot redirect member uploads into owner files', async () => {
		const ownerCanaryVirtualPath = '/Home/upload-symlink-canary.txt'
		const ownerCanarySystemPath = `${umbreld.vm.dataDirectory}/home/upload-symlink-canary.txt`
		const attackDirectory = `/Users/${memberUserId}/Documents/upload-symlink-attack`
		const archivePath = `${attackDirectory}.tar`

		// Seed an owner file that the member must not be able to overwrite.
		await loginAs(ownerToken)
		await umbreld.api.post(`files/upload?path=${encodeURIComponent(ownerCanaryVirtualPath)}`, {
			body: 'owner content',
		})

		// Upload and extract an archive containing the predictable symlink used
		// by the old upload staging scheme.
		await loginAs(memberToken)
		const maliciousArchive = await tarWithSymlink('.target.txt.umbrel-upload', ownerCanarySystemPath)
		await umbreld.api.post(`files/upload?path=${encodeURIComponent(archivePath)}`, {body: maliciousArchive})
		await expect(umbreld.client.files.unarchive.mutate({path: archivePath})).resolves.toBe(attackDirectory)

		// A normal upload beside that symlink must use a fresh, exclusively
		// opened staging file and leave the owner's file untouched.
		await expect(
			umbreld.api.post(`files/upload?path=${encodeURIComponent(`${attackDirectory}/target.txt`)}`, {
				body: 'member content',
			}),
		).resolves.toMatchObject({statusCode: 200})

		await loginAs(ownerToken)
		const ownerCanary = await umbreld.api.get(`files/view?path=${encodeURIComponent(ownerCanaryVirtualPath)}`, {
			responseType: 'text',
		})
		expect(ownerCanary.body).toBe('owner content')

		await loginAs(memberToken)
		const memberUpload = await umbreld.api.get(
			`files/view?path=${encodeURIComponent(`${attackDirectory}/target.txt`)}`,
			{responseType: 'text'},
		)
		expect(memberUpload.body).toBe('member content')
	})

	test('archive output cannot follow extracted symlinks outside the member filesystem', async () => {
		const ownerTargetName = 'archive-output-symlink-canary.zip'
		const ownerTargetSystemPath = `${umbreld.vm.dataDirectory}/home/${ownerTargetName}`
		const attackDirectory = `/Users/${memberUserId}/Documents/archive-output-symlink-attack`
		const maliciousArchivePath = `${attackDirectory}.tar`

		// Introduce a dangling output symlink through the supported upload and
		// unarchive surfaces, exactly as a member could from the file browser.
		await loginAs(memberToken)
		const maliciousArchive = await tarWithSymlink('payload.zip', ownerTargetSystemPath)
		await umbreld.api.post(`files/upload?path=${encodeURIComponent(maliciousArchivePath)}`, {
			body: maliciousArchive,
		})
		await expect(umbreld.client.files.unarchive.mutate({path: maliciousArchivePath})).resolves.toBe(attackDirectory)
		await umbreld.api.post(`files/upload?path=${encodeURIComponent(`${attackDirectory}/payload`)}`, {
			body: 'member content',
		})

		// The dangling symlink occupies payload.zip, so archive creation must
		// reserve a different path without following it.
		await expect(umbreld.client.files.archive.mutate({paths: [`${attackDirectory}/payload`]})).resolves.toBe(
			`${attackDirectory}/payload (2).zip`,
		)

		// No archive was written through the symlink into the owner's home.
		await loginAs(ownerToken)
		const ownerHome = await umbreld.client.files.list.query({path: '/Home'})
		expect(ownerHome.files.map((file) => file.name)).not.toContain(ownerTargetName)
	})

	test('owner can share a path with all members', async () => {
		// Owner creates a subtree and shares a subdirectory of it
		await loginAs(ownerToken)
		await umbreld.client.files.createDirectory.mutate({path: '/Home/Photos/holiday'})
		await umbreld.client.files.createDirectory.mutate({path: '/Home/Photos/holiday/rome'})
		await umbreld.client.files.createDirectory.mutate({path: '/Home/Photos/private'})
		await umbreld.client.files.addMemberShare.mutate({path: '/Home/Photos/holiday', sharedWith: 'all'})

		// The member can list the shared directory and inside it
		await loginAs(memberToken)
		const listing = await umbreld.client.files.list.query({path: '/Home/Photos/holiday'})
		expect(listing.files.map((file) => file.name)).toContain('rome')
		await expect(umbreld.client.files.list.query({path: '/Home/Photos/holiday/rome'})).resolves.toBeDefined()

		// Ancestors are traversable but only show the whitelisted path down to the
		// share, with no operations on the entries along the way
		const home = await umbreld.client.files.list.query({path: '/Home'})
		expect(home.files.map((file) => file.name)).toStrictEqual(['Photos'])
		expect(home.operations).toStrictEqual([])
		expect(home.files[0].operations).toStrictEqual([])
		const photos = await umbreld.client.files.list.query({path: '/Home/Photos'})
		expect(photos.files.map((file) => file.name)).toStrictEqual(['holiday'])

		// But nothing beside the whitelisted path
		await expect(umbreld.client.files.list.query({path: '/Home/Photos/private'})).rejects.toThrow('forbidden')
		await expect(umbreld.client.files.list.query({path: '/Home/Documents'})).rejects.toThrow('forbidden')

		// Traversal can't widen the grant
		await expect(umbreld.client.files.list.query({path: '/Home/Photos/holiday/../private'})).rejects.toThrow(
			'forbidden',
		)

		// Archive output is derived from the normalized source. An alias that
		// normalizes to the share root would place the zip beside the share, so
		// the exact computed destination must be rejected.
		await expect(umbreld.client.files.archive.mutate({paths: ['/Home/Photos/holiday/rome/..']})).rejects.toThrow(
			'forbidden',
		)
	})

	test('shares allow writes and items can be copied out', async () => {
		await loginAs(memberToken)

		// Renaming the root of a narrow share would move owner data to an
		// unauthorized sibling, so the computed destination is checked too.
		await expect(
			umbreld.client.files.rename.mutate({path: '/Home/Photos/holiday', newName: 'escaped-holiday'}),
		).rejects.toThrow('forbidden')

		// The member can create, rename and permanently delete inside the share
		await expect(
			umbreld.client.files.createDirectory.mutate({path: '/Home/Photos/holiday/from-member'}),
		).resolves.toMatchObject({created: true})
		await expect(
			umbreld.client.files.rename.mutate({path: '/Home/Photos/holiday/from-member', newName: 'member-dir'}),
		).resolves.toBe('/Home/Photos/holiday/member-dir')

		// The owner sees the member's changes
		await loginAs(ownerToken)
		const photos = await umbreld.client.files.list.query({path: '/Home/Photos'})
		expect(photos.files.map((file) => file.name)).toContain('holiday')
		expect(photos.files.map((file) => file.name)).not.toContain('escaped-holiday')
		const ownerListing = await umbreld.client.files.list.query({path: '/Home/Photos/holiday'})
		expect(ownerListing.files.map((file) => file.name)).toContain('member-dir')

		// Trashing is not offered on shared paths (it would strand the owner's
		// files in the member's private trash), hard delete is used instead
		await loginAs(memberToken)
		const listing = await umbreld.client.files.list.query({path: '/Home/Photos/holiday'})
		const memberDir = listing.files.find((file) => file.name === 'member-dir')!
		expect(memberDir.operations).toContain('delete')
		expect(memberDir.operations).toContain('rename')
		expect(memberDir.operations).not.toContain('trash')
		expect(memberDir.operations).not.toContain('share')
		expect(memberDir.operations).toContain('favorite')
		await expect(umbreld.client.files.trash.mutate({path: '/Home/Photos/holiday/member-dir'})).rejects.toThrow(
			'operation-not-allowed',
		)
		await expect(umbreld.client.files.delete.mutate({path: '/Home/Photos/holiday/member-dir'})).resolves.toBe(true)

		// Copying out of the share into their own home works
		await umbreld.client.files.createDirectory.mutate({path: '/Home/Photos/holiday/rome/take-me'})
		const copiedPath = await umbreld.client.files.copy.mutate({
			path: '/Home/Photos/holiday/rome',
			toDirectory: `/Users/${memberUserId}/Documents`,
		})
		expect(copiedPath).toBe(`/Users/${memberUserId}/Documents/rome`)

		// And copying into the share works too
		const copiedInPath = await umbreld.client.files.copy.mutate({
			path: `/Users/${memberUserId}/Documents/rome`,
			toDirectory: '/Home/Photos/holiday',
			collision: 'keep-both',
		})
		expect(copiedInPath).toBe('/Home/Photos/holiday/rome (2)')
		await umbreld.client.files.delete.mutate({path: '/Home/Photos/holiday/rome (2)'})
	})

	test('shares still respect the system rules', async () => {
		// Share the owner's entire home
		await loginAs(ownerToken)
		await umbreld.client.files.addMemberShare.mutate({path: '/Home', sharedWith: 'all'})
		await umbreld.api.post('files/upload?path=/Home/Downloads/protected-marker.txt', {body: 'owner content'})

		// The member can now list all of it
		await loginAs(memberToken)
		const home = await umbreld.client.files.list.query({path: '/Home'})
		expect(home.files.map((file) => file.name)).toContain('Documents')

		// But protected paths stay protected, exactly like they are for the owner
		await expect(umbreld.client.files.rename.mutate({path: '/Home/Downloads', newName: 'Downloads2'})).rejects.toThrow(
			'operation-not-allowed',
		)
		await expect(umbreld.client.files.delete.mutate({path: '/Home/Downloads'})).rejects.toThrow('operation-not-allowed')

		// Alias spellings are canonicalized before applying protected-path rules.
		await expect(umbreld.client.files.delete.mutate({path: '/Home/Downloads/..'})).rejects.toThrow(
			'operation-not-allowed',
		)
		await expect(umbreld.client.files.delete.mutate({path: '/Home//'})).rejects.toThrow('operation-not-allowed')

		// Collision replacement also authorizes the final target. A member-owned
		// directory named Downloads cannot replace the owner's protected Downloads.
		await umbreld.api.post(
			`files/upload?path=${encodeURIComponent(`/Users/${memberUserId}/Downloads/member-marker.txt`)}`,
			{body: 'member content'},
		)
		await expect(
			umbreld.client.files.copy.mutate({
				path: `/Users/${memberUserId}/Downloads`,
				toDirectory: '/Home',
				collision: 'replace',
			}),
		).rejects.toThrow('operation-not-allowed')
		await expect(
			umbreld.client.files.move.mutate({
				path: `/Users/${memberUserId}/Downloads`,
				toDirectory: '/Home',
				collision: 'replace',
			}),
		).rejects.toThrow('operation-not-allowed')

		await loginAs(ownerToken)
		const downloads = await umbreld.client.files.list.query({path: '/Home/Downloads'})
		expect(downloads.files.map((file) => file.name)).toContain('protected-marker.txt')

		// Clean up
		await umbreld.client.files.removeMemberShare.mutate({path: '/Home'})
	})

	test('upload keep-both cannot escape a narrow share', async () => {
		await loginAs(ownerToken)
		await umbreld.client.files.createDirectory.mutate({path: '/Home/narrow-upload'})
		await umbreld.client.files.addMemberShare.mutate({path: '/Home/narrow-upload', sharedWith: [memberUserId]})

		await loginAs(memberToken)
		const error = await umbreld.api
			.post(`files/upload?path=${encodeURIComponent('/Home/narrow-upload')}&collision=keep-both`, {
				body: 'must stay contained',
			})
			.catch((error) => error)
		expect(error.response.statusCode).toBe(400)

		await loginAs(ownerToken)
		const home = await umbreld.client.files.list.query({path: '/Home'})
		expect(home.files.map((file) => file.name)).not.toContain('narrow-upload (2)')
		await umbreld.client.files.removeMemberShare.mutate({path: '/Home/narrow-upload'})
		await umbreld.client.files.trash.mutate({path: '/Home/narrow-upload'})
	})

	test('shares appear in sharedWithMe and can be revoked', async () => {
		await loginAs(memberToken)
		const sharedWithMe = await umbreld.client.files.sharedWithMe.query()
		expect(sharedWithMe.ownerName).toBe(ownerCredentials.name)
		expect(sharedWithMe.shares).toStrictEqual([{path: '/Home/Photos/holiday', name: 'holiday', base: 'home'}])

		// Members can't manage shares
		await expect(umbreld.client.files.memberShares.query()).rejects.toThrow('owner')
		await expect(umbreld.client.files.addMemberShare.mutate({path: '/Home/Photos', sharedWith: 'all'})).rejects.toThrow(
			'owner',
		)

		// Owner revokes the share and the member loses access
		await loginAs(ownerToken)
		await expect(umbreld.client.files.removeMemberShare.mutate({path: '/Home/Photos/holiday'})).resolves.toBe(true)
		await loginAs(memberToken)
		await expect(umbreld.client.files.list.query({path: '/Home/Photos/holiday'})).rejects.toThrow('forbidden')
		// Ancestor traversal closes with it
		await expect(umbreld.client.files.list.query({path: '/Home'})).rejects.toThrow('forbidden')
		await expect(umbreld.client.files.sharedWithMe.query()).resolves.toMatchObject({shares: []})
	})

	test('shares with specific members only apply to them, all-shares apply to future members', async () => {
		// Owner shares one path with a specific other member and one with everyone
		await loginAs(ownerToken)
		const other = await umbreld.client.user.createUser.mutate({name: 'sn0wden', password: 'passwordpassword'})
		await umbreld.client.files.addMemberShare.mutate({path: '/Home/Photos/private', sharedWith: [other.userId]})
		await umbreld.client.files.addMemberShare.mutate({path: '/Home/Photos/holiday', sharedWith: 'all'})

		// The specific share doesn't apply to our member
		await loginAs(memberToken)
		await expect(umbreld.client.files.list.query({path: '/Home/Photos/private'})).rejects.toThrow('forbidden')
		await expect(umbreld.client.files.list.query({path: '/Home/Photos/holiday'})).resolves.toBeDefined()

		// A member created after the 'all' share was created gets access to it
		await loginAs(ownerToken)
		const future = await umbreld.client.user.createUser.mutate({name: 'finney', password: 'passwordpassword'})
		const futureToken = (await createBrowserSession({userId: future.userId, password: 'passwordpassword'}))
			.dashboardToken
		await loginAs(futureToken)
		await expect(umbreld.client.files.list.query({path: '/Home/Photos/holiday'})).resolves.toBeDefined()
		await expect(umbreld.client.files.list.query({path: '/Home/Photos/private'})).rejects.toThrow('forbidden')

		// Deleting a member removes them from explicit share lists entirely
		await loginAs(ownerToken)
		await umbreld.client.user.deleteUser.mutate({userId: other.userId})
		await umbreld.client.user.deleteUser.mutate({userId: future.userId})
		const shares = await umbreld.client.files.memberShares.query()
		expect(shares).toStrictEqual([{path: '/Home/Photos/holiday', sharedWith: 'all'}])

		// Clean up the remaining share
		await umbreld.client.files.removeMemberShare.mutate({path: '/Home/Photos/holiday'})
	})

	test('symlinks inside a share cannot escape the shared subtree', async () => {
		await loginAs(ownerToken)
		await umbreld.client.files.addMemberShare.mutate({path: '/Home/Photos/holiday', sharedWith: 'all'})

		// The owner (or an app) creates a symlink inside the share pointing outside
		// of it, elsewhere in the owner's own files
		const home = `${umbreld.vm.dataDirectory}/home`
		await umbreld.vm.sshAsRoot(`
set -e
ln -s '${home}/Photos/private' '${home}/Photos/holiday/escape'
mkdir -p '${home}/Photos/holiday-private'
ln -s '${home}/Photos/holiday-private' '${home}/Photos/holiday/prefix-escape'
`)

		// The member can't follow it out of the shared subtree, not even to a
		// sibling directory that shares the path prefix
		await loginAs(memberToken)
		await expect(umbreld.client.files.list.query({path: '/Home/Photos/holiday/escape'})).rejects.toThrow('escapes-base')
		await expect(umbreld.client.files.list.query({path: '/Home/Photos/holiday/prefix-escape'})).rejects.toThrow(
			'escapes-base',
		)

		// Clean up
		await loginAs(ownerToken)
		await umbreld.vm.sshAsRoot(`
set -e
rm '${home}/Photos/holiday/escape'
rm '${home}/Photos/holiday/prefix-escape'
rm -rf '${home}/Photos/holiday-private'
`)
		await expect(umbreld.client.files.removeMemberShare.mutate({path: '/Home/Photos/holiday'})).resolves.toBe(true)
	})

	test('share containment is segment-aware', async () => {
		await loginAs(ownerToken)
		await umbreld.client.files.createDirectory.mutate({path: '/Home/share'})
		await umbreld.client.files.createDirectory.mutate({path: '/Home/share/child'})
		await umbreld.client.files.createDirectory.mutate({path: '/Home/share-private'})
		await umbreld.client.files.addMemberShare.mutate({path: '/Home/share', sharedWith: 'all'})

		await loginAs(memberToken)
		// The share itself and paths below it are accessible
		await expect(umbreld.client.files.list.query({path: '/Home/share'})).resolves.toBeDefined()
		await expect(umbreld.client.files.list.query({path: '/Home/share/child'})).resolves.toBeDefined()
		// Missing children inside the share can still be created
		await expect(umbreld.client.files.createDirectory.mutate({path: '/Home/share/new-folder'})).resolves.toMatchObject({
			created: true,
		})
		// A sibling directory that shares the path prefix is not inside the share
		await expect(umbreld.client.files.list.query({path: '/Home/share-private'})).rejects.toThrow('forbidden')
		// Nor is the parent, which only shows the whitelisted path down to the share
		const home = await umbreld.client.files.list.query({path: '/Home'})
		expect(home.files.map((file) => file.name)).toStrictEqual(['share'])

		// Clean up
		await loginAs(ownerToken)
		await umbreld.client.files.removeMemberShare.mutate({path: '/Home/share'})
		await umbreld.client.files.trash.mutate({path: '/Home/share'})
		await umbreld.client.files.trash.mutate({path: '/Home/share-private'})
	})

	test('share records are removed when the shared directory is deleted', async () => {
		await loginAs(ownerToken)
		await umbreld.client.files.createDirectory.mutate({path: '/Home/doomed'})
		await umbreld.client.files.addMemberShare.mutate({path: '/Home/doomed', sharedWith: 'all'})
		await loginAs(memberToken)
		await expect(umbreld.client.files.list.query({path: '/Home/doomed'})).resolves.toBeDefined()

		// The owner trashes the shared directory. The watcher cleans the share
		// record up in realtime, but its event delivery after a fresh boot is not
		// reliable enough to assert on (see the health check in watcher.ts), so
		// give the live path a moment and then assert the invariant across a
		// restart, where the startup sweep deterministically removes it.
		await loginAs(ownerToken)
		await expect(umbreld.client.files.trash.mutate({path: '/Home/doomed'})).resolves.toContain('/Trash/')
		await pWaitFor(async () => (await umbreld.client.files.memberShares.query()).length === 0, {
			interval: 500,
			timeout: 60_000,
		}).catch(() => {})
		await umbreld.vm.sshAsRoot('systemctl restart umbrel')
		await umbreld.waitForStartup()
		await expect(umbreld.client.files.memberShares.query()).resolves.toStrictEqual([])

		// A directory recreated at the same path isn't silently re-shared
		await umbreld.client.files.createDirectory.mutate({path: '/Home/doomed'})
		await loginAs(memberToken)
		await expect(umbreld.client.files.list.query({path: '/Home/doomed'})).rejects.toThrow('forbidden')
		await expect(umbreld.client.files.sharedWithMe.query()).resolves.toMatchObject({shares: []})

		// Clean up
		await loginAs(ownerToken)
		await umbreld.client.files.trash.mutate({path: '/Home/doomed'})
	})

	test('share changes are streamed to affected members in realtime', async () => {
		const port = umbreld.vm.httpPort
		type ShareChange = {sharedWith: 'all' | string[]}
		const memberEvents = subscribeToEventsAs<ShareChange>(port, memberToken, 'files:member-shares:change')
		const ownerEvents = subscribeToEventsAs<ShareChange>(port, ownerToken, 'files:member-shares:change')
		await memberEvents.started
		await ownerEvents.started

		try {
			// A share targeted at another member doesn't notify this member
			await loginAs(ownerToken)
			const other = await umbreld.client.user.createUser.mutate({name: 'gilfoyle', password: 'passwordpassword'})
			await umbreld.client.files.addMemberShare.mutate({path: '/Home/Photos/private', sharedWith: [other.userId]})

			// A share with all members notifies the member, redacted to their own id
			await umbreld.client.files.addMemberShare.mutate({path: '/Home/Photos/holiday', sharedWith: 'all'})
			await pWaitFor(() => memberEvents.collected.length >= 1, {interval: 100, timeout: 10_000})
			expect(memberEvents.collected).toStrictEqual([{sharedWith: [memberUserId]}])

			// The owner sees both events with the full audience
			await pWaitFor(() => ownerEvents.collected.length >= 2, {interval: 100, timeout: 10_000})
			expect(ownerEvents.collected).toStrictEqual([{sharedWith: [other.userId]}, {sharedWith: 'all'}])

			// Revoking notifies the member too
			await umbreld.client.files.removeMemberShare.mutate({path: '/Home/Photos/holiday'})
			await pWaitFor(() => memberEvents.collected.length >= 2, {interval: 100, timeout: 10_000})
			expect(memberEvents.collected[1]).toStrictEqual({sharedWith: [memberUserId]})

			// Clean up
			await umbreld.client.files.removeMemberShare.mutate({path: '/Home/Photos/private'})
			await umbreld.client.user.deleteUser.mutate({userId: other.userId})
		} finally {
			memberEvents.close()
			ownerEvents.close()
		}
	})

	test('favorites reject symlinks that escape the owner home', async () => {
		await loginAs(ownerToken)
		// A symlink in the owner's home escaping to the root filesystem (e.g.
		// extracted from a malicious archive)
		await umbreld.vm.sshAsRoot(`ln -s / '${umbreld.vm.dataDirectory}/home/escape-link'`)

		// A path through it can't be favorited and doesn't poison the store
		await expect(umbreld.client.files.addFavorite.mutate({path: '/Home/escape-link/etc'})).rejects.toThrow(
			'escapes-base',
		)
		await expect(umbreld.client.files.favorites.query()).resolves.toBeInstanceOf(Array)

		// Normal directories still can be favorited
		await umbreld.client.files.createDirectory.mutate({path: '/Home/favorite-me'})
		await expect(umbreld.client.files.addFavorite.mutate({path: '/Home/favorite-me'})).resolves.toBe(true)
		await expect(umbreld.client.files.favorites.query()).resolves.toContain('/Home/favorite-me')

		// Clean up
		await umbreld.client.files.removeFavorite.mutate({path: '/Home/favorite-me'})
		await umbreld.client.files.trash.mutate({path: '/Home/favorite-me'})
		await umbreld.vm.sshAsRoot(`rm '${umbreld.vm.dataDirectory}/home/escape-link'`)
	})

	test('owner can share apps with members', async () => {
		await loginAs(ownerToken)

		// Sharing requires the app to be installed
		await expect(
			umbreld.client.apps.addMemberShare.mutate({appId: 'sparkles-hello-world', sharedWith: 'all'}),
		).rejects.toThrow('app-not-installed')

		// Add the test community app store (the git server runs on the host,
		// reachable from inside the VM at the QEMU user networking gateway)
		const repositoryUrl = gitServer.url.replace('localhost', '10.0.2.2')
		await umbreld.client.appStore.addRepository.mutate({url: repositoryUrl})
		await pWaitFor(
			async () => {
				const registry = await umbreld.client.appStore.registry.query()
				return registry.some((repository) => repository.apps.some((app) => app.id === 'sparkles-hello-world'))
			},
			{interval: 1000, timeout: 60_000},
		)
		await expect(umbreld.client.appStore.repositories.query()).resolves.toContainEqual({
			url: repositoryUrl,
			meta: {id: 'sparkles', name: 'Sparkles'},
		})

		// Members can browse the full app store read-only
		await loginAs(memberToken)
		const memberRegistry = await umbreld.client.appStore.registry.query()
		const memberRegistryAppIds = memberRegistry.flatMap((repository) => repository.apps.map((app) => app.id))
		expect(memberRegistryAppIds).toContain('sparkles-hello-world')
		expect(memberRegistry.every((repository) => !('url' in repository))).toBe(true)
		expect(
			memberRegistry.every((repository) =>
				repository.apps.every((app) => !('defaultPassword' in app) && !('path' in app) && !('privateExtension' in app)),
			),
		).toBe(true)
		await expect(umbreld.client.appStore.repositories.query()).rejects.toThrow('owner')

		// Apps not shared with them always read as not installed
		await expect(umbreld.client.apps.state.query({appId: 'sparkles-hello-world'})).resolves.toMatchObject({
			state: 'not-installed',
		})

		// But installing stays owner-only
		await expect(umbreld.client.apps.install.mutate({appId: 'sparkles-hello-world'})).rejects.toThrow('owner')

		// Install an app and wait for it to be ready
		await loginAs(ownerToken)
		await expect(umbreld.client.apps.install.mutate({appId: 'sparkles-hello-world'})).resolves.toBe(true)
		while (true) {
			const appState = await umbreld.client.apps.state.query({appId: 'sparkles-hello-world'})
			if (appState.state === 'ready') break
			await sleep(1000)
		}

		// The member doesn't see it before it's shared
		await loginAs(memberToken)
		await expect(umbreld.client.apps.list.query()).resolves.toStrictEqual([])
		await expect(umbreld.client.files.list.query({path: '/Apps'})).rejects.toThrow('forbidden')

		// Members can't manage app shares
		await expect(umbreld.client.apps.memberShares.query()).rejects.toThrow('owner')
		await expect(
			umbreld.client.apps.addMemberShare.mutate({appId: 'sparkles-hello-world', sharedWith: 'all'}),
		).rejects.toThrow('owner')

		// The owner shares it with all users
		await loginAs(ownerToken)
		await umbreld.client.apps.addMemberShare.mutate({appId: 'sparkles-hello-world', sharedWith: 'all'})

		// The member now sees the app
		await loginAs(memberToken)
		const memberApps = await umbreld.client.apps.list.query()
		expect(memberApps.map((app) => app.id)).toStrictEqual(['sparkles-hello-world'])

		// Sharing an app only grants app UI/proxy access, not raw app data under /Apps
		await expect(umbreld.client.files.sharedWithMe.query()).resolves.toMatchObject({shares: []})
		await expect(umbreld.client.files.list.query({path: '/Apps'})).rejects.toThrow('forbidden')
		await expect(umbreld.client.files.list.query({path: '/Apps/sparkles-hello-world'})).rejects.toThrow('forbidden')

		// Revoking removes the app again
		await loginAs(ownerToken)
		await expect(umbreld.client.apps.removeMemberShare.mutate({appId: 'sparkles-hello-world'})).resolves.toBe(true)
		await loginAs(memberToken)
		await expect(umbreld.client.apps.list.query()).resolves.toStrictEqual([])
		await expect(umbreld.client.files.list.query({path: '/Apps/sparkles-hello-world'})).rejects.toThrow('forbidden')

		// The owner can explicitly share app data as a separate file share, which
		// does not grant app UI/proxy access
		await loginAs(ownerToken)
		await umbreld.client.files.createDirectory.mutate({path: '/Apps/sparkles-hello-world/explicit-subpath'})
		await expect(
			umbreld.client.files.addMemberShare.mutate({path: '/Apps/sparkles-hello-world', sharedWith: 'all'}),
		).resolves.toMatchObject({path: '/Apps/sparkles-hello-world'})
		await loginAs(memberToken)
		await expect(umbreld.client.apps.list.query()).resolves.toStrictEqual([])
		await expect(umbreld.client.files.sharedWithMe.query()).resolves.toMatchObject({
			shares: [{path: '/Apps/sparkles-hello-world', name: 'sparkles-hello-world', base: 'apps'}],
		})
		const explicitlySharedApps = await umbreld.client.files.list.query({path: '/Apps'})
		expect(explicitlySharedApps.files.map((file) => file.name)).toStrictEqual(['sparkles-hello-world'])
		await expect(umbreld.client.files.list.query({path: '/Apps/sparkles-hello-world'})).resolves.toBeDefined()

		// Subpaths under an app data directory can also be shared directly
		await loginAs(ownerToken)
		await expect(umbreld.client.files.removeMemberShare.mutate({path: '/Apps/sparkles-hello-world'})).resolves.toBe(
			true,
		)
		await expect(
			umbreld.client.files.addMemberShare.mutate({
				path: '/Apps/sparkles-hello-world/explicit-subpath',
				sharedWith: 'all',
			}),
		).resolves.toMatchObject({path: '/Apps/sparkles-hello-world/explicit-subpath'})
		await loginAs(memberToken)
		const appDataAncestor = await umbreld.client.files.list.query({path: '/Apps/sparkles-hello-world'})
		expect(appDataAncestor.files.map((file) => file.name)).toStrictEqual(['explicit-subpath'])
		await expect(
			umbreld.client.files.list.query({path: '/Apps/sparkles-hello-world/explicit-subpath'}),
		).resolves.toBeDefined()

		// Clean up the explicit file share before testing app share wildcards
		await loginAs(ownerToken)
		await expect(
			umbreld.client.files.removeMemberShare.mutate({path: '/Apps/sparkles-hello-world/explicit-subpath'}),
		).resolves.toBe(true)
		await loginAs(memberToken)
		await expect(umbreld.client.files.list.query({path: '/Apps'})).rejects.toThrow('forbidden')

		// Sharing all apps ('*') covers every installed app
		await loginAs(ownerToken)
		await umbreld.client.apps.addMemberShare.mutate({appId: '*', sharedWith: 'all'})
		await loginAs(memberToken)
		const allApps = await umbreld.client.apps.list.query()
		expect(allApps.map((app) => app.id)).toStrictEqual(['sparkles-hello-world'])
		await expect(umbreld.client.files.sharedWithMe.query()).resolves.toMatchObject({shares: []})
		await expect(umbreld.client.files.list.query({path: '/Apps/sparkles-hello-world'})).rejects.toThrow('forbidden')

		// And revoking it removes access again
		await loginAs(ownerToken)
		await expect(umbreld.client.apps.removeMemberShare.mutate({appId: '*'})).resolves.toBe(true)
		await loginAs(memberToken)
		await expect(umbreld.client.apps.list.query()).resolves.toStrictEqual([])
	})

	test('app authentication and proxying run in umbreld without an app-proxy container', async () => {
		const containers = await umbreld.vm.sshAsRoot("docker ps -a --format '{{.Names}}'")
		expect(containers).not.toContain('sparkles-hello-world_app_proxy_1')

		// The owner can reach every installed app through the in-process gateway.
		const ownerResponse = await requestApp(ownerToken)
		expect(ownerResponse.statusCode).toBe(200)

		// An unauthenticated browser is sent to the dedicated app-auth UI.
		const unauthenticatedResponse = await requestApp()
		expect(unauthenticatedResponse.statusCode).toBe(302)
		expect(unauthenticatedResponse.headers.location).toMatch(
			/^http:\/\/umbrel\.local:2000\/app-auth\?origin=host&app=sparkles-hello-world&/,
		)
	})

	test('app share changes are streamed to affected members in realtime', async () => {
		const port = umbreld.vm.httpPort
		type ShareChange = {sharedWith: 'all' | string[]}
		const memberEvents = subscribeToEventsAs<ShareChange>(port, memberToken, 'apps:member-shares:change')
		await memberEvents.started

		try {
			// Sharing an app notifies the member, redacted to their own id
			await loginAs(ownerToken)
			await umbreld.client.apps.addMemberShare.mutate({appId: 'sparkles-hello-world', sharedWith: 'all'})
			await pWaitFor(() => memberEvents.collected.length >= 1, {interval: 100, timeout: 10_000})
			expect(memberEvents.collected[0]).toStrictEqual({sharedWith: [memberUserId]})

			// Revoking notifies them too
			await umbreld.client.apps.removeMemberShare.mutate({appId: 'sparkles-hello-world'})
			await pWaitFor(() => memberEvents.collected.length >= 2, {interval: 100, timeout: 10_000})
			expect(memberEvents.collected[1]).toStrictEqual({sharedWith: [memberUserId]})
		} finally {
			memberEvents.close()
		}
	})

	test('members see usage stats with owner-only apps and machines folded into other', async () => {
		const imagePath = '/Home/member-hidden-machine.img'
		let machineId: string | undefined

		try {
			// Boot a real, minimal VM so every resource breakdown has owner-only
			// machine data that the member-facing response must redact.
			await loginAs(ownerToken)
			const disk = Buffer.alloc(1024 * 1024)
			disk.set([0xfa, 0xf4, 0xeb, 0xfd])
			disk.set([0x55, 0xaa], 510)
			await umbreld.api.post(`files/upload?path=${encodeURIComponent(imagePath)}`, {body: disk})
			const machine = await umbreld.client.machines.create.mutate({
				name: 'Member hidden machine',
				imagePath,
				arch: 'amd64',
				firmware: 'bios',
				diskSizeGb: 1,
				cores: 1,
				memoryGb: 1,
			})
			machineId = machine.id
			await pWaitFor(
				async () =>
					(await umbreld.client.machines.list.query()).some(
						(candidate) => candidate.id === machineId && candidate.state === 'running',
					),
				{interval: 250, timeout: 30_000},
			)

			const ownerUsage = await Promise.all([
				umbreld.client.system.diskUsage.query(),
				umbreld.client.system.memoryUsage.query(),
				umbreld.client.system.cpuUsage.query(),
			])
			for (const usage of ownerUsage) {
				expect(usage.machines).toContainEqual(expect.objectContaining({id: machineId, name: 'Member hidden machine'}))
			}
			const ownerDiskUsage = ownerUsage[0]
			const ownerAppIds = ownerDiskUsage.apps.map((app) => app.id)
			expect(ownerAppIds).toContain('sparkles-hello-world')
			expect(ownerAppIds).not.toContain('other')

			// Members can read overall usage, but neither the machine identity nor
			// its separate resource accounting crosses the account boundary.
			await loginAs(memberToken)
			await expect(umbreld.client.system.systemDiskUsage.query()).resolves.toBeDefined()
			await expect(umbreld.client.system.systemMemoryUsage.query()).resolves.toBeDefined()
			const memberUsage = await Promise.all([
				umbreld.client.system.diskUsage.query(),
				umbreld.client.system.memoryUsage.query(),
				umbreld.client.system.cpuUsage.query(),
			])
			for (const usage of memberUsage) {
				expect(usage.machines).toStrictEqual([])
				expect(JSON.stringify(usage)).not.toContain(machineId)
				expect(JSON.stringify(usage)).not.toContain('Member hidden machine')
			}

			const memberDiskUsage = memberUsage[0]
			const memberAppIds = memberDiskUsage.apps.map((app) => app.id)
			expect(memberAppIds).not.toContain('sparkles-hello-world')
			expect(memberAppIds).toContain('other')
			const ownerMachineDisk = ownerDiskUsage.machines.find(({id}) => id === machineId)!.used
			expect(memberDiskUsage.apps.find(({id}) => id === 'other')!.used).toBeGreaterThanOrEqual(ownerMachineDisk)

			// Sharing the app reveals only that app. The machine remains anonymous
			// inside Other and never appears in the Machines breakdown.
			await loginAs(ownerToken)
			await umbreld.client.apps.addMemberShare.mutate({appId: 'sparkles-hello-world', sharedWith: 'all'})
			await loginAs(memberToken)
			const sharedDiskUsage = await umbreld.client.system.diskUsage.query()
			expect(sharedDiskUsage.apps.map((app) => app.id)).toEqual(
				expect.arrayContaining(['sparkles-hello-world', 'other']),
			)
			expect(sharedDiskUsage.machines).toStrictEqual([])
		} finally {
			await loginAs(ownerToken)
			await umbreld.client.apps.removeMemberShare.mutate({appId: 'sparkles-hello-world'}).catch(() => {})
			if (machineId) await umbreld.client.machines.uninstall.mutate({id: machineId}).catch(() => {})
			await umbreld.client.files.delete.mutate({path: imagePath}).catch(() => {})
		}
	})

	test('the app gateway enforces member app shares in realtime', async () => {
		// Members cannot use either their app cookie or the app-auth login flow
		// before the app has been shared with them.
		await expect(requestApp(memberToken)).resolves.toMatchObject({statusCode: 302})
		const deniedLogin = await got.post(
			`http://127.0.0.1:${umbreld.vm.httpPort}/app-auth/v1/account/login?origin=host&app=sparkles-hello-world&path=%2F`,
			{
				json: {userId: memberUserId, password: memberCredentials.password},
				throwHttpErrors: false,
				retry: {limit: 0},
			},
		)
		expect(deniedLogin.statusCode).toBe(403)

		// Sharing the app grants both flows access immediately.
		await loginAs(ownerToken)
		await umbreld.client.apps.addMemberShare.mutate({appId: 'sparkles-hello-world', sharedWith: 'all'})
		await expect(requestApp(memberToken)).resolves.toMatchObject({statusCode: 200})
		const memberSocket = await openAppWebSocket(memberToken)
		const ownerSocket = await openAppWebSocket(ownerToken)
		const memberSocketClosed = new Promise<void>((resolve) => memberSocket.once('close', () => resolve()))
		try {
			const allowedLogin = await got
				.post(
					`http://127.0.0.1:${umbreld.vm.httpPort}/app-auth/v1/account/login?origin=host&app=sparkles-hello-world&path=%2Fsettings`,
					{
						json: {userId: memberUserId, password: memberCredentials.password},
						responseType: 'json',
						retry: {limit: 0},
					},
				)
				.json<{url: string; params: {r: string; handoff: string}}>()
			expect(allowedLogin.url).toBe('http://127.0.0.1:4000/umbrel_/api/v1/auth/handoff')
			expect(allowedLogin.params.r).toBe('/settings')
			expect(allowedLogin.params.handoff).toMatch(/^[0-9a-f]{64}$/)

			// Revoking the share removes gateway access immediately without
			// revoking the member's overall Umbrel session.
			await umbreld.client.apps.removeMemberShare.mutate({appId: 'sparkles-hello-world'})
			await Promise.race([
				memberSocketClosed,
				sleep(10_000).then(() => {
					throw new Error('Member app WebSocket stayed open after share revocation')
				}),
			])
			expect(memberSocket.readyState).toBe(WebSocket.CLOSED)
			expect(ownerSocket.readyState).toBe(WebSocket.OPEN)
			await expect(requestApp(memberToken)).resolves.toMatchObject({statusCode: 302})
			await loginAs(memberToken)
			await expect(umbreld.client.user.get.query()).resolves.toMatchObject({name: memberCredentials.name})
		} finally {
			if (memberSocket.readyState !== WebSocket.CLOSED) memberSocket.terminate()
			if (ownerSocket.readyState !== WebSocket.CLOSED) ownerSocket.terminate()
		}
	})

	test('sharing validates the path and users', async () => {
		await loginAs(ownerToken)
		// App data must target a specific app. Storage can only be shared as a
		// complete category, never as an individual device or directory.
		await expect(umbreld.client.files.addMemberShare.mutate({path: '/Apps', sharedWith: 'all'})).rejects.toThrow(
			'invalid-base',
		)
		await expect(
			umbreld.client.files.addMemberShare.mutate({path: '/External/specific-usb', sharedWith: 'all'}),
		).rejects.toThrow('invalid-base')
		await expect(
			umbreld.client.files.addMemberShare.mutate({path: '/Network/specific-nas/share', sharedWith: 'all'}),
		).rejects.toThrow('invalid-base')
		await expect(umbreld.client.files.addMemberShare.mutate({path: '/External', sharedWith: 'all'})).rejects.toThrow(
			'invalid-users',
		)
		await expect(umbreld.client.files.addMemberShare.mutate({path: '/Network', sharedWith: 'all'})).rejects.toThrow(
			'invalid-users',
		)

		// Shareable paths must exist
		await expect(
			umbreld.client.files.addMemberShare.mutate({path: '/Home/does-not-exist', sharedWith: 'all'}),
		).rejects.toThrow('does-not-exist')
		await expect(
			umbreld.client.files.addMemberShare.mutate({path: '/Apps/does-not-exist', sharedWith: 'all'}),
		).rejects.toThrow('does-not-exist')
		await expect(
			umbreld.client.files.addMemberShare.mutate({path: '/Home/Photos', sharedWith: ['not-a-user']}),
		).rejects.toThrow('unknown-user')
	})

	test('USB and network storage access can be granted by category', async () => {
		// Both categories are private by default.
		await loginAs(memberToken)
		await expect(umbreld.client.files.list.query({path: '/External'})).rejects.toThrow('forbidden')
		await expect(umbreld.client.files.list.query({path: '/Network'})).rejects.toThrow('forbidden')

		// Each category is granted to this member specifically.
		await loginAs(ownerToken)
		await umbreld.client.files.addMemberShare.mutate({path: '/External', sharedWith: [memberUserId]})
		await umbreld.client.files.addMemberShare.mutate({path: '/Network', sharedWith: [memberUserId]})

		// Model storage mounted after the grants. Hardware and mount lifecycle
		// have dedicated VM suites; this scenario tests the member ACL applied to
		// the resulting filesystem paths.
		await umbreld.vm.sshAsRoot(`
set -e
mkdir -p '${umbreld.vm.dataDirectory}/external/future-usb'
mkdir -p '${umbreld.vm.dataDirectory}/network/future-nas/media'
`)

		await loginAs(memberToken)
		await expect(umbreld.client.files.sharedWithMe.query()).resolves.toMatchObject({
			shares: expect.arrayContaining([
				{path: '/External', name: 'External', base: 'external'},
				{path: '/Network', name: 'Network', base: 'network'},
			]),
		})
		await expect(umbreld.client.files.list.query({path: '/External'})).resolves.toMatchObject({
			files: expect.arrayContaining([expect.objectContaining({name: 'future-usb'})]),
		})
		await expect(umbreld.client.files.list.query({path: '/Network'})).resolves.toMatchObject({
			files: expect.arrayContaining([expect.objectContaining({name: 'future-nas'})]),
		})
		await expect(
			umbreld.client.files.createDirectory.mutate({path: '/External/future-usb/from-member'}),
		).resolves.toMatchObject({created: true})
		await expect(
			umbreld.client.files.createDirectory.mutate({path: '/Network/future-nas/media/from-member'}),
		).resolves.toMatchObject({created: true})

		// Uploads may create nested directories, but only below the nearest
		// existing writable directory. Category and hostname management roots
		// cannot be populated with fake devices or shares.
		for (const path of [
			'/External/category-root-upload.txt',
			'/External/fake-usb/nested-upload.txt',
			'/Network/future-nas/hostname-root-upload.txt',
			'/Network/fake-nas/fake-share/nested-upload.txt',
		]) {
			const error = await umbreld.api
				.post(`files/upload?path=${encodeURIComponent(path)}`, {body: 'member content'})
				.catch((error) => error)
			expect(error.response.statusCode).toBe(400)
			expect(error.response.body).toMatchObject({error: 'invalid path'})
		}

		// Nested uploads remain supported inside real writable mount roots.
		await expect(
			umbreld.api.post(`files/upload?path=${encodeURIComponent('/External/future-usb/nested/from-upload.txt')}`, {
				body: 'external content',
			}),
		).resolves.toMatchObject({statusCode: 200})
		await expect(
			umbreld.api.post(`files/upload?path=${encodeURIComponent('/Network/future-nas/media/nested/from-upload.txt')}`, {
				body: 'network content',
			}),
		).resolves.toMatchObject({statusCode: 200})

		// Archive and unarchive output is allowed within a mounted filesystem,
		// but not beside mount roots in the read-only management namespace.
		await expect(umbreld.client.files.archive.mutate({paths: ['/External/future-usb/from-member']})).resolves.toBe(
			'/External/future-usb/from-member.zip',
		)
		await expect(umbreld.client.files.unarchive.mutate({path: '/External/future-usb/from-member.zip'})).resolves.toBe(
			'/External/future-usb/from-member (2)',
		)
		await expect(umbreld.client.files.archive.mutate({paths: ['/External/future-usb']})).rejects.toThrow(
			'operation-not-allowed',
		)
		await expect(umbreld.client.files.archive.mutate({paths: ['/Network/future-nas/media']})).rejects.toThrow(
			'operation-not-allowed',
		)

		// Alias spellings cannot turn protected mount/category roots into deletable
		// children after operation policy and resolution canonicalize the same path.
		for (const path of [
			'/External/future-usb/',
			'/External/future-usb/child/..',
			'/External/future-usb/..',
			'/Network/future-nas/media/',
			'/Network/future-nas/media/child/..',
			'/Network/future-nas/media/..',
		]) {
			await expect(umbreld.client.files.delete.mutate({path})).rejects.toThrow('operation-not-allowed')
		}

		// Storage management remains owner-only even when file access is granted.
		await expect(umbreld.client.files.externalDevices.query()).rejects.toThrow('owner')
		await expect(umbreld.client.files.listNetworkShares.query()).rejects.toThrow('owner')

		// Revocation closes both category roots immediately.
		await loginAs(ownerToken)
		await umbreld.client.files.removeMemberShare.mutate({path: '/External'})
		await umbreld.client.files.removeMemberShare.mutate({path: '/Network'})
		await loginAs(memberToken)
		await expect(umbreld.client.files.list.query({path: '/External/future-usb'})).rejects.toThrow('forbidden')
		await expect(umbreld.client.files.list.query({path: '/Network/future-nas'})).rejects.toThrow('forbidden')
	})

	test("search is scoped to the account's own home", async () => {
		await loginAs(ownerToken)
		await umbreld.client.files.createDirectory.mutate({path: '/Home/needle-owner'})

		await loginAs(memberToken)
		await umbreld.client.files.createDirectory.mutate({path: `/Users/${memberUserId}/needle-member`})

		// Member search only returns their own files
		let memberResults = await umbreld.client.files.search.query({query: 'needle'})
		await pWaitFor(
			async () => {
				memberResults = await umbreld.client.files.search.query({query: 'needle'})
				return memberResults.some((file) => file.path === `/Users/${memberUserId}/needle-member`)
			},
			{interval: 100, timeout: 30_000},
		)
		const memberPaths = memberResults.map((file) => file.path)
		expect(memberPaths).toContain(`/Users/${memberUserId}/needle-member`)
		expect(memberPaths.every((path) => path.startsWith(`/Users/${memberUserId}`))).toBe(true)

		// Owner search doesn't return member files
		await loginAs(ownerToken)
		let ownerResults = await umbreld.client.files.search.query({query: 'needle'})
		await pWaitFor(
			async () => {
				ownerResults = await umbreld.client.files.search.query({query: 'needle'})
				return ownerResults.some((file) => file.path === '/Home/needle-owner')
			},
			{interval: 100, timeout: 30_000},
		)
		const ownerPaths = ownerResults.map((file) => file.path)
		expect(ownerPaths).toContain('/Home/needle-owner')
		expect(ownerPaths.every((path) => path.startsWith('/Home'))).toBe(true)
	})

	// An authenticated websocket client kept open across the member's deletion, so
	// we can verify deletion cuts access to live sockets immediately
	let closeMemberWsClient: () => void
	let memberWsCloseCount = 0
	let memberWsCloseCountBeforeDeletion = 0

	test('member can query over an authenticated websocket', async () => {
		const port = umbreld.vm.httpPort
		const wsClient = createWSClient({
			url: async () => {
				const ticket = await issueWebSocketTicket(port, memberToken, 'trpc')
				if (!ticket) throw new Error('Unable to mint WebSocket ticket')
				return `ws://localhost:${port}/trpc?ticket=${ticket}`
			},
			retryDelayMs: () => 100,
			onClose: () => memberWsCloseCount++,
		})
		const memberWsClient = createTRPCProxyClient<AppRouter>({links: [wsLink({client: wsClient})]})
		closeMemberWsClient = () => wsClient.close()
		await expect(memberWsClient.user.get.query()).resolves.toMatchObject({name: memberCredentials.name})
	})

	test('deleteUser removes the member and their files', async () => {
		await loginAs(ownerToken)
		// Leave 'all' shares in place so the next test can check they go with the last member
		await umbreld.client.files.createDirectory.mutate({path: '/Home/shared-with-everyone'})
		await umbreld.client.files.addMemberShare.mutate({path: '/Home/shared-with-everyone', sharedWith: 'all'})
		await umbreld.client.apps.addMemberShare.mutate({appId: '*', sharedWith: 'all'})
		memberWsCloseCountBeforeDeletion = memberWsCloseCount
		await expect(umbreld.client.user.deleteUser.mutate({userId: memberUserId})).resolves.toBe(true)
		await expect(umbreld.client.user.listAccounts.query()).resolves.toStrictEqual([
			{userId: '0', name: ownerCredentials.name, wallpaper: expectedDefaultWallpaper, language: 'es'},
		])
	})

	test("deleting the last member also removes 'all' shares so they can't leak to future members", async () => {
		await loginAs(ownerToken)
		await expect(umbreld.client.files.memberShares.query()).resolves.toStrictEqual([])
		await expect(umbreld.client.apps.memberShares.query()).resolves.toStrictEqual([])
	})

	test("a deleted member's token is rejected", async () => {
		await loginAs(memberToken)
		await expect(umbreld.client.user.get.query()).rejects.toThrow('Invalid token')
		await loginAs(ownerToken)
	})

	test("a deleted member's open websocket loses access immediately", async () => {
		// The websocket authenticated while the member existed and is still open,
		// deletion must terminate it immediately rather than waiting for a reconnect.
		await pWaitFor(() => memberWsCloseCount > memberWsCloseCountBeforeDeletion, {interval: 50, timeout: 10_000})
		closeMemberWsClient()
	})

	test("a deleted member's token cannot open new websockets", async () => {
		const port = umbreld.vm.httpPort
		// The upgrade is rejected before any subscription can start
		await expect(trySubscriptionOverWebSocket(port, memberToken, 'files:operation-progress')).resolves.toBe('error')
		await expect(tryRawWebSocketUpgrade(port, '/trpc', memberToken)).resolves.toBe('closed')
	})

	test('a deleted member can no longer log in', async () => {
		await expect(
			umbreld.unauthenticatedClient.user.login.mutate({userId: memberUserId, password: memberCredentials.password}),
		).rejects.toThrow('Incorrect password')
	})

	test('recreating the same display name uses a new identity and does not revive the old token', async () => {
		await loginAs(ownerToken)
		const replacement = await umbreld.client.user.createUser.mutate(memberCredentials)
		expect(replacement.userId).toBe('Hal-4')

		await loginAs(memberToken)
		await expect(umbreld.client.user.get.query()).rejects.toThrow('Invalid token')

		await loginAs(ownerToken)
		await umbreld.client.user.deleteUser.mutate({userId: replacement.userId})
	})

	test('deleting the owner account is refused', async () => {
		await loginAs(ownerToken)
		await expect(umbreld.client.user.deleteUser.mutate({userId: '0'})).rejects.toThrow(
			'owner account cannot be deleted',
		)
	})
})
