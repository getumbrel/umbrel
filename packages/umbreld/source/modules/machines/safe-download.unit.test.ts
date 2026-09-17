import {createHash} from 'node:crypto'
import type {LookupAddress} from 'node:dns'
import {once} from 'node:events'
import fsp from 'node:fs/promises'
import http from 'node:http'
import type {AddressInfo} from 'node:net'
import os from 'node:os'
import nodePath from 'node:path'

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {createPinnedLookup, isPrivateAddress, safeDownload} from './safe-download.js'

const {lookup} = vi.hoisted(() => ({lookup: vi.fn<(hostname: string) => Promise<LookupAddress[]>>()}))
vi.mock('node:dns/promises', () => ({lookup}))

describe('machine image download SSRF protection', () => {
	test.each([
		'127.0.0.1',
		'10.0.0.1',
		'172.16.0.1',
		'192.168.1.1',
		'169.254.169.254',
		'100.64.0.1',
		'::1',
		'fd00::1',
		'fe80::1',
		'::ffff:127.0.0.1',
	])('blocks %s', (address) => expect(isPrivateAddress(address)).toBe(true))

	test.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111'])('allows %s', (address) =>
		expect(isPrivateAddress(address)).toBe(false),
	)

	test('returns all pinned addresses when Node requests multiple addresses', async () => {
		const pinned = [
			{address: '2606:4700:4700::1111', family: 6},
			{address: '1.1.1.1', family: 4},
		]
		const result = await new Promise((resolve, reject) => {
			createPinnedLookup(pinned)('cloud-images.ubuntu.com', {all: true}, (error, addresses) => {
				if (error) return reject(error)
				resolve(addresses)
			})
		})

		expect(result).toEqual(pinned)
	})

	test('preserves the scalar callback shape when Node requests one address', () => {
		const pinned = [
			{address: '1.1.1.1', family: 4},
			{address: '2606:4700:4700::1111', family: 6},
		]
		const callback = vi.fn()
		createPinnedLookup(pinned)('cloud-images.ubuntu.com', {}, callback)
		expect(callback).toHaveBeenCalledWith(null, pinned[0].address, pinned[0].family)
	})
})

describe('machine image download address fallback', () => {
	const ipv6 = {address: '2606:4700:4700::1111', family: 6}
	const ipv4 = {address: '1.1.1.1', family: 4}
	const unavailableIpv4 = {address: '1.0.0.1', family: 4}
	const image = Buffer.from('machine image fixture')
	const sha256 = createHash('sha256').update(image).digest('hex')
	let directory: string
	let server: http.Server
	let port: number
	let requests: string[]

	beforeEach(async () => {
		directory = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'machine-download-'))
		requests = []
		server = http.createServer((request, response) => {
			requests.push(request.url!)
			if (request.url === '/redirect') {
				response.writeHead(302, {location: `http://mirror.test:${port}/image`})
				response.end()
			} else {
				response.writeHead(200, {'content-length': image.length})
				response.end(image)
			}
		})
		server.listen(0, '127.0.0.1')
		await once(server, 'listening')
		port = (server.address() as AddressInfo).port

		// Resolve public fixture addresses so safeDownload runs its real security
		// checks. At the HTTP boundary, route those addresses to local equivalents:
		// only 127.0.0.1 serves the image. Node still makes real TCP connections and
		// must fall back itself; neither the downloader nor its lookup is mocked.
		const routes: Record<string, string> = {
			[ipv6.address]: '::1',
			[ipv4.address]: '127.0.0.1',
			[unavailableIpv4.address]: '127.0.0.2',
		}
		const get = http.get
		vi.spyOn(http, 'get').mockImplementation(((
			url: URL,
			options: http.RequestOptions,
			callback: (response: http.IncomingMessage) => void,
		) =>
			get(
				url,
				{
					...options,
					agent: false,
					lookup: (hostname, lookupOptions, done) => {
						options.lookup!(hostname, lookupOptions, (error, addresses, family) => {
							if (error) return done(error, '', 0)
							if (Array.isArray(addresses)) {
								return done(
									null,
									addresses.map(({address, family}) => ({address: routes[address], family})),
								)
							}
							done(null, routes[addresses], family)
						})
					},
				},
				callback,
			)) as typeof http.get)
	})

	afterEach(async () => {
		vi.restoreAllMocks()
		lookup.mockReset()
		server.closeAllConnections()
		await new Promise<void>((resolve) => server.close(() => resolve()))
		await fsp.rm(directory, {recursive: true, force: true})
	})

	test.each([
		{path: '/image', first: ipv6, description: 'IPv6 on the initial URL'},
		{path: '/redirect', first: ipv6, description: 'IPv6 on a redirect destination'},
		{path: '/image', first: unavailableIpv4, description: 'IPv4 on the initial URL'},
		{path: '/redirect', first: unavailableIpv4, description: 'IPv4 on a redirect destination'},
	])('downloads when the first address is unreachable over $description', async ({path, first}) => {
		if (path === '/redirect') lookup.mockResolvedValueOnce([ipv4])
		lookup.mockResolvedValueOnce([first, ipv4])
		const destination = nodePath.join(directory, 'image.qcow2')

		await expect(
			safeDownload({
				url: `http://download.test:${port}${path}`,
				destination,
				expectedSha256: sha256,
				signal: AbortSignal.timeout(3_000),
			}),
		).resolves.toEqual({sha256, size: image.length})

		expect(await fsp.readFile(destination)).toEqual(image)
		expect(await fsp.readdir(directory)).toEqual(['image.qcow2'])
		expect(requests).toEqual(path === '/redirect' ? ['/redirect', '/image'] : ['/image'])
		// Each hostname is resolved once; connections use only the validated list.
		expect(lookup.mock.calls.map(([hostname]) => hostname)).toEqual(
			path === '/redirect' ? ['download.test', 'mirror.test'] : ['download.test'],
		)
	})

	test.each(['/image', '/redirect'])('rejects mixed public/private DNS answers at %s', async (path) => {
		if (path === '/redirect') lookup.mockResolvedValueOnce([ipv4])
		lookup.mockResolvedValueOnce([ipv4, {address: '127.0.0.1', family: 4}])

		await expect(
			safeDownload({
				url: `http://download.test:${port}${path}`,
				destination: nodePath.join(directory, 'image.qcow2'),
				signal: AbortSignal.timeout(3_000),
			}),
		).rejects.toThrow('[machine-image-url-private-address]')
		expect(requests).toEqual(path === '/redirect' ? ['/redirect'] : [])
		expect(await fsp.readdir(directory)).toEqual([])
	})
})
