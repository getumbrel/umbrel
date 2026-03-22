import {createServer, type Server} from 'node:http'
import type {AddressInfo} from 'node:net'

import {afterAll, beforeAll, expect, test} from 'vitest'

import createTestUmbreld from '../test-utilities/create-test-umbreld.js'

let umbreld: Awaited<ReturnType<typeof createTestUmbreld>>
let webServer: Server
const WEB_SERVER_PORT = 6969

const webServerShortcut = {
	url: `http://localhost:${WEB_SERVER_PORT}`,
	title: 'Fake Website',
	icon: `http://localhost:${WEB_SERVER_PORT}/icon.png`,
}
const umbrelPortShortcut = {
	url: `umbrel:${WEB_SERVER_PORT}`,
	title: 'Fake Website',
	icon: `http://localhost:${WEB_SERVER_PORT}/icon.png`,
}

beforeAll(async () => {
	webServer = await createWebServer()
	umbreld = await createTestUmbreld()
})

afterAll(async () => {
	await Promise.all([closeServer(webServer), umbreld.cleanup()])
})

async function createWebServer() {
	const server = createServer((request, response) => {
		if (request.url === '/') {
			response.writeHead(200, {'content-type': 'text/html'})
			response.end(`
				<html>
					<head>
						<title>Fake Website</title>
						<link rel="icon" href="/icon.png">
					</head>
				</html>
				`)
			return
		}

		response.writeHead(404)
		response.end()
	})

	await new Promise<void>((resolve, reject) => {
		server.once('error', reject)
		server.listen(WEB_SERVER_PORT, () => {
			server.off('error', reject)
			resolve()
		})
	})

	return server
}

async function closeServer(server: Server | undefined) {
	if (!server) return

	await new Promise<void>((resolve, reject) => {
		server.close((error) => {
			if (error) reject(error)
			else resolve()
		})
	})
}

// The following tests are stateful and must be run in order

test.sequential('shortcuts.fetchPageMetadata() throws invalid error without auth token', async () => {
	await expect(
		umbreld.unauthenticatedClient.shortcuts.fetchPageMetadata.query({url: webServerShortcut.url}),
	).rejects.toThrow('Invalid token')
})

test.sequential('shortcuts.list() throws invalid error without auth token', async () => {
	await expect(umbreld.unauthenticatedClient.shortcuts.list.query()).rejects.toThrow('Invalid token')
})

test.sequential('shortcuts.add() throws invalid error without auth token', async () => {
	await expect(umbreld.unauthenticatedClient.shortcuts.add.mutate(webServerShortcut)).rejects.toThrow('Invalid token')
})

test.sequential('shortcuts.remove() throws invalid error without auth token', async () => {
	await expect(umbreld.unauthenticatedClient.shortcuts.remove.mutate({url: webServerShortcut.url})).rejects.toThrow(
		'Invalid token',
	)
})

test.sequential('login', async () => {
	await expect(umbreld.registerAndLogin()).resolves.toBe(true)
})

test.sequential('shortcuts.fetchPageMetadata() returns metadata for an external URL', async () => {
	await expect(umbreld.client.shortcuts.fetchPageMetadata.query({url: webServerShortcut.url})).resolves.toStrictEqual({
		title: webServerShortcut.title,
		icon: webServerShortcut.icon,
	})
})

test.sequential('shortcuts.fetchPageMetadata() works for an internal port', async () => {
	await expect(umbreld.client.shortcuts.fetchPageMetadata.query({url: umbrelPortShortcut.url})).resolves.toStrictEqual({
		title: umbrelPortShortcut.title,
		icon: umbrelPortShortcut.icon,
	})
})

test.sequential('shortcuts.add() adds the provided shortcut', async () => {
	await expect(umbreld.client.shortcuts.add.mutate(webServerShortcut)).resolves.toBe(true)
	await expect(umbreld.client.shortcuts.list.query()).resolves.toStrictEqual([webServerShortcut])
})

test.sequential('shortcuts.add() does not add a duplicate shortcut', async () => {
	await expect(umbreld.client.shortcuts.add.mutate(webServerShortcut)).rejects.toThrow('[shortcut-already-exists]')
	await expect(umbreld.client.shortcuts.list.query()).resolves.toStrictEqual([webServerShortcut])
})

test.sequential('shortcuts.list() shows the added shortcuts', async () => {
	// add another shortcut
	await expect(umbreld.client.shortcuts.add.mutate(umbrelPortShortcut)).resolves.toBe(true)
	// list the shortcuts
	await expect(umbreld.client.shortcuts.list.query()).resolves.toStrictEqual([webServerShortcut, umbrelPortShortcut])
})

test.sequential('shortcuts.remove() removes the shortcut', async () => {
	await expect(umbreld.client.shortcuts.remove.mutate({url: webServerShortcut.url})).resolves.toBe(true)
	await expect(umbreld.client.shortcuts.list.query()).not.toContain([umbrelPortShortcut])
})
