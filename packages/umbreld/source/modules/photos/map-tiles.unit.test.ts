import {once} from 'node:events'
import {createServer, type Server} from 'node:http'
import type {AddressInfo} from 'node:net'
import nodePath from 'node:path'
import {inspect} from 'node:util'
import {gunzipSync, gzipSync} from 'node:zlib'

import {zxyToTileId} from 'pmtiles'
import {afterEach, expect, test, vi} from 'vitest'

import MapTiles, {type MapTile, remoteMap, umbrelPlanet} from './map-tiles.ts'

let servers: Server[] = []

const signal = () => AbortSignal.timeout(20_000)
const plain = (tile: MapTile) => tile.data && gunzipSync(tile.data).toString()
const isGzip = (data: Buffer) => data[0] === 0x1f && data[1] === 0x8b
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function listen(server: Server) {
	servers.push(server.listen(0, '127.0.0.1'))
	await once(server, 'listening')
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

// An address nothing answers at
const NOWHERE = 'http://127.0.0.1:9'

type Answer = {
	status?: number
	body?: string | Buffer
	encoding?: 'gzip'
	type?: string
	stall?: boolean
	delay?: number
}

// A source the way the planet is served: a file per tile at its z/x/y.
// `answer` says what each path gets.
async function serve() {
	const served = {
		answer: ((path: string) => ({body: `file ${path}`})) as (path: string) => Answer,
		requests: [] as string[],
		address: '',
		map: (build = 'planet-1', maxZoom = 15) =>
			remoteMap({build, maxZoom, tiles: `${served.address}/${build}/{z}/{x}/{y}.mvt`}),
	}
	served.address = await listen(
		createServer((request, response) => {
			const path = decodeURIComponent(request.url!)
			served.requests.push(path)
			const {status = 200, body = '', encoding, type = 'application/x-protobuf', stall, delay = 0} = served.answer(path)
			if (stall) return
			const data = encoding === 'gzip' ? gzipSync(body) : Buffer.from(body)
			setTimeout(() => {
				response.writeHead(status, {
					'Content-Type': type,
					'Content-Length': data.length,
					...(encoding ? {'Content-Encoding': encoding} : {}),
				})
				response.end(data)
			}, delay)
		}),
	)
	return served
}

afterEach(() => {
	for (const server of servers) {
		server.closeAllConnections()
		server.close()
	}
	servers = []
	vi.restoreAllMocks()
})

test('a tile is fetched gzipped, as the build it is of, and fetched again when asked for again', async () => {
	const source = await serve()
	const map = new MapTiles(source.map())
	const tile = await map.tile(3, 4, 5)
	expect(tile.build).toBe('planet-1')
	expect(isGzip(tile.data!)).toBe(true)
	expect(plain(tile)).toBe('file /planet-1/3/4/5.mvt')
	expect(plain(await map.tile(3, 4, 5))).toBe('file /planet-1/3/4/5.mvt')
	expect(source.requests).toEqual(['/planet-1/3/4/5.mvt', '/planet-1/3/4/5.mvt'])
	expect((await new MapTiles(source.map('planet-2')).tile(3, 4, 5)).build).toBe('planet-2')
})

test('a gzipped tile is sent as it came, whether the response or the tile itself is gzipped', async () => {
	const source = await serve()
	const map = new MapTiles(source.map())

	source.answer = () => ({body: 'encoded', encoding: 'gzip'})
	expect(plain(await map.tile(1, 0, 0))).toBe('encoded')

	// The way a PMTiles archive stores them, sent with no Content-Encoding: not gzipped again
	const stored = gzipSync('stored')
	source.answer = () => ({body: stored})
	expect((await map.tile(1, 1, 0)).data).toEqual(stored)

	// … nor when it is both
	source.answer = () => ({body: stored, encoding: 'gzip'})
	expect((await map.tile(1, 0, 1)).data).toEqual(stored)
})

test('a tile the build has none of is none', async () => {
	const source = await serve()
	source.answer = () => ({status: 204})
	const map = new MapTiles(source.map())
	expect(await map.tile(9, 0, 0)).toEqual({build: 'planet-1', data: undefined})
	source.answer = () => ({body: ''})
	expect(await map.tile(9, 1, 0)).toEqual({build: 'planet-1', data: undefined})
})

test.each<[string, Answer]>([
	['an error', {status: 500}],
	['a tile out of its zooms', {status: 404}],
	['a captive portal', {body: '<html>Sign in to the Wi-Fi</html>', type: 'text/html'}],
	['an error as JSON', {body: '{}', type: 'application/json'}],
	['no answer in time', {stall: true}],
])('a fetch that fails with %s fails, and is fetched again', async (_, answer) => {
	const source = await serve()
	source.answer = () => answer
	const map = new MapTiles(source.map(), {readTimeout: 300})
	await expect(map.tile(2, 1, 1)).rejects.toThrow()

	source.answer = () => ({body: 'back'})
	expect(plain(await map.tile(2, 1, 1))).toBe('back')
	expect(source.requests).toHaveLength(2)
})

test('requests for the same tile at once share one fetch', async () => {
	const source = await serve()
	source.answer = (path) => ({body: `file ${path}`, delay: 100})
	const map = new MapTiles(source.map())
	const first = map.tile(5, 6, 7)
	await wait(50)
	// Joining the fetch still under way, not starting another
	const tiles = await Promise.all([first, ...Array.from({length: 7}, () => map.tile(5, 6, 7))])
	expect(new Set(tiles)).toEqual(new Set([tiles[0]]))
	expect(plain(tiles[0]!)).toBe('file /planet-1/5/6/7.mvt')
	expect(source.requests).toEqual(['/planet-1/5/6/7.mvt'])

	// … and failing, all fail
	source.answer = () => ({status: 500, delay: 100})
	const failed = await Promise.all(Array.from({length: 4}, () => map.tile(5, 6, 8).catch((error: Error) => error)))
	expect(new Set(failed).size).toBe(1)
	expect(failed[0]).toBeInstanceOf(Error)
	expect(source.requests).toHaveLength(2)
})

test('there is a basemap when the source has the world, and how far in it goes', async () => {
	const source = await serve()
	expect(await new MapTiles(source.map('planet-1', 15)).status()).toEqual({
		available: true,
		maxZoom: 15,
		build: 'planet-1',
	})
	// A source that has no tile there has still answered
	source.answer = () => ({status: 204})
	expect(await new MapTiles(source.map('planet-2', 14)).status()).toEqual({
		available: true,
		maxZoom: 14,
		build: 'planet-2',
	})
})

test('there is none with the source out of reach or failing, or too slow to answer', async () => {
	const unreachable = remoteMap({build: 'planet-1', maxZoom: 15, tiles: NOWHERE})
	expect(await new MapTiles(unreachable).status()).toEqual({available: false, maxZoom: 0})

	const source = await serve()
	source.answer = () => ({status: 503})
	expect(await new MapTiles(source.map()).status()).toEqual({available: false, maxZoom: 0})

	source.answer = () => ({stall: true})
	const start = Date.now()
	expect(await new MapTiles(source.map(), {probeWait: 200}).status()).toEqual({
		available: false,
		maxZoom: 0,
	})
	expect(Date.now() - start).toBeLessThan(1000)
})

test('the answer holds for a minute', async () => {
	const source = await serve()
	source.answer = () => ({status: 503})
	let now = Date.now()
	vi.spyOn(Date, 'now').mockImplementation(() => now)
	const map = new MapTiles(source.map())
	expect((await map.status()).available).toBe(false)

	source.answer = () => ({body: 'the world'})
	now += 30_000
	expect((await map.status()).available).toBe(false)
	expect(source.requests).toHaveLength(1)
	now += 31_000
	expect((await map.status()).available).toBe(true)
	expect(source.requests).toHaveLength(2)
})

test('a basemap once had is asked about again without a read of it, until a tile of it fails', async () => {
	const source = await serve()
	let now = Date.now()
	vi.spyOn(Date, 'now').mockImplementation(() => now)
	const map = new MapTiles(source.map())
	expect((await map.status()).available).toBe(true)
	expect(source.requests).toEqual(['/planet-1/0/0/0.mvt'])

	now += 61_000
	expect(await map.status()).toEqual({available: true, maxZoom: 15, build: 'planet-1'})
	expect(source.requests).toHaveLength(1)

	// A tile that fails has the next to ask look at the world's tile again, at once
	source.answer = () => ({status: 503})
	await expect(map.tile(3, 4, 5)).rejects.toThrow('503')
	expect((await map.status()).available).toBe(false)
	expect(source.requests).toEqual(['/planet-1/0/0/0.mvt', '/planet-1/3/4/5.mvt', '/planet-1/0/0/0.mvt'])
})

test('a first look that finds no basemap is not kept for the next to ask', async () => {
	const source = await serve()
	source.answer = () => ({status: 503})
	const map = new MapTiles(source.map())
	await map.warm()
	source.answer = () => ({body: 'the world'})
	expect((await map.status()).available).toBe(true)
	// One that does is
	await map.warm()
	expect(source.requests).toHaveLength(2)
})

// The planet Umbrel hosts, read out of its archive at the address api.umbrel.com signs

type Entry = {id: number; runLength: number; length: number; offset: number}

const varints = (values: number[]) =>
	Buffer.from(
		values.flatMap((value) => {
			const bytes = []
			for (; value >= 0x80; value = Math.floor(value / 0x80)) bytes.push(value % 0x80 | 0x80)
			return [...bytes, value]
		}),
	)

// Entries sorted by tile id: the ids as deltas, then run lengths, lengths, and offsets (stored + 1)
const directoryOf = (entries: Entry[]) =>
	varints([
		entries.length,
		...entries.map(({id}, index) => id - (entries[index - 1]?.id ?? 0)),
		...entries.map(({runLength}) => runLength),
		...entries.map(({length}) => length),
		...entries.map(({offset}) => offset + 1),
	])

// Laid end to end, each where the last one ends
function packed(parts: Buffer[]) {
	let offset = 0
	return parts.map((part) => ({length: part.length, offset: (offset += part.length) - part.length}))
}

// The smallest PMTiles archives there are: a header, a root directory, and
// tiles at one zoom, stored gzipped. With `leafSize`, the root points at leaf
// directories of that many tiles each, the way a planet's does.
function archive(tiles: Array<{x?: number; y?: number; tile?: string}> = [{}], {z = 0, leafSize = 0} = {}) {
	const HEADER_BYTES = 127
	const sorted = tiles
		.map(({x = 0, y = 0, tile = 'a tile'}) => ({id: zxyToTileId(z, x, y), data: gzipSync(tile)}))
		.sort((a, b) => a.id - b.id)
	const entries = packed(sorted.map(({data}) => data)).map((place, index) => ({
		id: sorted[index]!.id,
		runLength: 1,
		...place,
	}))
	const leaves: Buffer[] = []
	for (let index = 0; leafSize && index < entries.length; index += leafSize) {
		leaves.push(directoryOf(entries.slice(index, index + leafSize)))
	}
	const root = leafSize
		? directoryOf(packed(leaves).map((place, index) => ({id: entries[index * leafSize]!.id, runLength: 0, ...place})))
		: directoryOf(entries)
	const leafDirectories = Buffer.concat(leaves)
	const header = Buffer.alloc(HEADER_BYTES)
	header.write('PMTiles')
	header.writeUInt8(3, 7)
	header.writeBigUInt64LE(BigInt(HEADER_BYTES), 8)
	header.writeBigUInt64LE(BigInt(root.length), 16)
	header.writeBigUInt64LE(BigInt(HEADER_BYTES + root.length), 40)
	header.writeBigUInt64LE(BigInt(leafDirectories.length), 48)
	header.writeBigUInt64LE(BigInt(HEADER_BYTES + root.length + leafDirectories.length), 56)
	header.writeBigUInt64LE(BigInt(sorted.reduce((total, {data}) => total + data.length, 0)), 64)
	for (const offset of [72, 80, 88]) header.writeBigUInt64LE(BigInt(tiles.length), offset)
	header.writeUInt8(1, 96)
	// Directories uncompressed, tiles gzipped, tiles are MVT, and the one zoom it has
	header.set([1, 2, 1, z, z], 97)
	;[-180, -85, 180, 85].forEach((degrees, index) => header.writeInt32LE(degrees * 1e7, 102 + index * 4))
	return Buffer.concat([header, root, leafDirectories, ...sorted.map(({data}) => data)])
}

const stored = (tile: string) => new Uint8Array(gzipSync(tile))

// A server with one archive on it, read the way the planet is on R2: by byte
// range, at any path, with a signature in the query that it can refuse the
// way R2 refuses one that has run out. What it serves can change, and
// `answer` can hold a read up or refuse it.
async function host(planet: Buffer) {
	const hosted = {
		planet,
		etag: undefined as string | undefined,
		answer: (() => undefined) as (from: number) => 'stall' | 'drop' | number | undefined,
		refuses: (() => false) as (signature: string) => boolean,
		ranges: [] as string[],
		// What each read was signed with, and where it went
		signatures: [] as string[],
		paths: [] as string[],
		address: '',
	}
	hosted.address = await listen(
		createServer((request, response) => {
			const url = new URL(request.url!, 'http://planet')
			const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? '') ?? []
			if (from === undefined) return response.writeHead(400).end()
			const signature = url.searchParams.get('X-Amz-Signature') ?? ''
			hosted.ranges.push(`${from}-${to}`)
			hosted.signatures.push(signature)
			hosted.paths.push(url.pathname)
			if (hosted.refuses(signature)) {
				return response
					.writeHead(403, {'Content-Type': 'application/xml'})
					.end('<Error><Code>AccessDenied</Code><Message>Request has expired</Message></Error>')
			}
			const answer = hosted.answer(Number(from))
			if (answer === 'stall') return
			if (answer === 'drop') return request.socket.destroy()
			if (answer) return response.writeHead(answer).end()
			const body = hosted.planet.subarray(Number(from), Number(to) + 1)
			response.writeHead(206, {
				'Content-Range': `bytes ${from}-${Number(from) + body.length - 1}/${hosted.planet.length}`,
				'Content-Length': body.length,
				...(hosted.etag ? {ETag: hosted.etag} : {}),
			})
			response.end(body)
		}),
	)
	return hosted
}

const DAY = 86_400_000
const WEEK = 7 * DAY

type Said = {status?: number; body?: unknown; stall?: boolean}

// api.umbrel.com, signing the planet's address anew each time it is asked,
// good for a week by its own clock. `answer`, given the address it would
// have said, can say something else, or nothing in time.
async function signer(planet: {address: string}) {
	const signing = {
		asked: 0,
		path: '/v1/planet-20261011.pmtiles',
		// The server's clock, which a device's may be out from, and how long
		// Vercel's cache has kept the answer, which keeps the Date it was made at
		clock: () => Date.now(),
		age: 0,
		delay: 0,
		answer: undefined as undefined | ((url: string) => Said),
		address: '',
	}
	signing.address = await listen(
		createServer((request, response) => {
			const n = ++signing.asked
			const url = `${planet.address}${signing.path}?X-Amz-Expires=604800&X-Amz-Signature=secret${n}`
			const made = signing.clock() - signing.age
			const expires = new Date(made + WEEK).toISOString()
			const {status = 200, body = {url, expires}, stall} = signing.answer?.(url) ?? {}
			if (stall) return
			setTimeout(() => {
				response.writeHead(status, {
					'Content-Type': 'application/json',
					Date: new Date(made).toUTCString(),
					...(signing.age ? {Age: String(signing.age / 1000)} : {}),
				})
				response.end(typeof body === 'string' ? body : JSON.stringify(body))
			}, signing.delay)
		}),
	)
	return signing
}

// A planet, and api.umbrel.com saying where it is
async function hosting(planet: Buffer) {
	const hosted = await host(planet)
	return {hosted, signing: await signer(hosted)}
}

// The reads of a header, and with it the root directory
const headerReads = (ranges: string[]) => ranges.filter((range) => range.startsWith('0-')).length

// A clock that moves only when it is moved
function clock() {
	let now = Date.now()
	vi.spyOn(Date, 'now').mockImplementation(() => now)
	return (by: number) => (now += by)
}

const inAWeek = () => new Date(Date.now() + WEEK).toISOString()
const streets = () => archive([{x: 2, y: 1, tile: 'streets'}], {z: 2})
const neighbours = Array.from({length: 4}, (_, x) => ({x, y: 3, tile: `place ${x}`}))

test('the planet is read a tile at a time, as stored, at the address it was given once, and kept like any other source', async () => {
	const {hosted, signing} = await hosting(streets())
	const source = umbrelPlanet({api: signing.address})
	expect(await source.open()).toEqual({build: 'planet-20261011', maxZoom: 2})
	expect(await source.tile(2, 2, 1, signal())).toEqual(stored('streets'))
	expect(await source.tile(2, 0, 0, signal())).toBeUndefined()
	// The planet's header and directory were read once, then only the tile asked for
	expect(hosted.ranges).toHaveLength(2)

	const map = new MapTiles(source)
	expect(await map.tile(2, 2, 1)).toEqual({build: 'planet-20261011', data: Buffer.from(stored('streets'))})
	expect(hosted.ranges).toHaveLength(3)
	expect(await map.status()).toEqual({available: true, maxZoom: 2, build: 'planet-20261011'})
	expect(signing.asked).toBe(1)
	expect(new Set(hosted.signatures)).toEqual(new Set(['secret1']))
	expect(new Set(hosted.paths)).toEqual(new Set(['/v1/planet-20261011.pmtiles']))
})

test('tiles that want the address at once wait on one asking for it', async () => {
	const {hosted, signing} = await hosting(archive(neighbours, {z: 4, leafSize: 1}))
	signing.delay = 200
	const source = umbrelPlanet({api: signing.address})
	const tiles = await Promise.all(neighbours.map(({x, y}) => source.tile(4, x, y, signal())))
	expect(tiles).toEqual(neighbours.map(({tile}) => stored(tile)))
	expect(signing.asked).toBe(1)
	expect(headerReads(hosted.ranges)).toBe(1)
})

test('shortly before the address runs out it is asked for again, once, reads going on at it meanwhile', async () => {
	const move = clock()
	const {hosted, signing} = await hosting(archive(neighbours, {z: 4, leafSize: 2}))
	const source = umbrelPlanet({api: signing.address})
	expect(await source.tile(4, 0, 3, signal())).toEqual(stored('place 0'))
	move(WEEK - 2 * DAY)
	await source.tile(4, 0, 3, signal())
	expect(signing.asked).toBe(1)

	// Half an hour left: however many reads there are, none waits for the new
	// address, and it is asked for once
	move(2 * DAY - 30 * 60_000)
	signing.delay = 200
	await Promise.all(Array.from({length: 6}, () => source.tile(4, 0, 3, signal())))
	expect(hosted.signatures.at(-1)).toBe('secret1')
	await vi.waitFor(async () => {
		await source.tile(4, 1, 3, signal())
		expect(hosted.signatures.at(-1)).toBe('secret2')
	})
	expect(signing.asked).toBe(2)
	// What was read of the planet at the first signature is read on from at
	// the second: its header, and the leaf directory both tiles are in
	expect(headerReads(hosted.ranges)).toBe(1)
	expect(hosted.ranges.filter((range) => range === hosted.ranges[1])).toHaveLength(1)
})

test('an address in its last minute is asked for again before the next read', async () => {
	const move = clock()
	const {hosted, signing} = await hosting(streets())
	const source = umbrelPlanet({api: signing.address})
	await source.tile(2, 2, 1, signal())
	move(WEEK - 30_000)
	expect(await source.tile(2, 2, 1, signal())).toEqual(stored('streets'))
	expect(signing.asked).toBe(2)
	expect(hosted.signatures.at(-1)).toBe('secret2')
	expect(headerReads(hosted.ranges)).toBe(1)
})

test('when asking again fails, the address there is goes on being read until it runs out, asked for again a minute apart', async () => {
	const move = clock()
	const {hosted, signing} = await hosting(streets())
	const source = umbrelPlanet({api: signing.address})
	await source.tile(2, 2, 1, signal())

	signing.answer = () => ({status: 500})
	move(WEEK - 30 * 60_000)
	for (let read = 0; read < 5; read++) {
		expect(await source.tile(2, 2, 1, signal())).toEqual(stored('streets'))
		await wait(20)
	}
	expect(signing.asked).toBe(2)
	move(61_000)
	await source.tile(2, 2, 1, signal())
	await vi.waitFor(() => expect(signing.asked).toBe(3))
	await wait(50)
	expect(new Set(hosted.signatures)).toEqual(new Set(['secret1']))

	// Run out, it isn't read again
	move(30 * 60_000)
	const reads = hosted.ranges.length
	await expect(source.tile(2, 2, 1, signal())).rejects.toThrow('500')
	expect(hosted.ranges).toHaveLength(reads)

	// Nor is api.umbrel.com asked again inside the minute, back or not
	signing.answer = undefined
	await expect(source.tile(2, 2, 1, signal())).rejects.toThrow('500')
	expect(signing.asked).toBe(4)
	move(61_000)
	expect(await source.tile(2, 2, 1, signal())).toEqual(stored('streets'))
	expect(hosted.signatures.at(-1)).toBe('secret5')
})

test('a signature R2 refuses is asked for again, once however many reads it refused, and not again when that is refused too', async () => {
	const move = clock()
	const {hosted, signing} = await hosting(archive(neighbours, {z: 4, leafSize: 1}))
	const source = umbrelPlanet({api: signing.address})
	await source.tile(4, 0, 3, signal())
	move(DAY)

	// Run out early, or not good yet by Cloudflare's clock
	hosted.refuses = (signature) => signature === 'secret1'
	const tiles = await Promise.all(neighbours.map(({x, y}) => source.tile(4, x, y, signal())))
	expect(tiles).toEqual(neighbours.map(({tile}) => stored(tile)))
	expect(signing.asked).toBe(2)
	expect(hosted.signatures.at(-1)).toBe('secret2')

	// One just given that is refused too is kept, refused, until a minute is up
	hosted.refuses = () => true
	let reads = hosted.ranges.length
	await expect(source.tile(4, 1, 3, signal())).rejects.toThrow('403')
	await expect(source.tile(4, 1, 3, signal())).rejects.toThrow('403')
	expect(signing.asked).toBe(2)
	expect(hosted.ranges).toHaveLength(reads + 2)

	move(61_000)
	reads = hosted.ranges.length
	await expect(source.tile(4, 1, 3, signal())).rejects.toThrow('403')
	expect(signing.asked).toBe(3)
	expect(hosted.ranges).toHaveLength(reads + 2)

	hosted.refuses = () => false
	expect(await source.tile(4, 1, 3, signal())).toEqual(stored('place 1'))
})

test("the build is the archive's name, without its signature, and a new planet a new build", async () => {
	const move = clock()
	const {hosted, signing} = await hosting(streets())
	const map = new MapTiles(umbrelPlanet({api: signing.address}))
	expect(await map.tile(2, 2, 1)).toEqual({build: 'planet-20261011', data: Buffer.from(stored('streets'))})

	signing.path = '/v1/planet-20261108.pmtiles'
	hosted.planet = archive([{x: 2, y: 1, tile: 'new streets'}], {z: 2})
	move(WEEK)
	expect(await map.tile(2, 2, 1)).toEqual({build: 'planet-20261108', data: Buffer.from(stored('new streets'))})
	expect(signing.asked).toBe(2)
})

test("a tile of a build that came while it was fetched is sent as neither, and is the new build's when asked for again", async () => {
	const answers: Record<string, string> = {'planet-1': 'old', 'planet-2': 'new'}
	let build = 'planet-1'
	let fetched: (() => void) | undefined
	const source = {
		open: async () => ({build, maxZoom: 15}),
		tile: () =>
			new Promise<Uint8Array>((resolve) => {
				fetched = () => resolve(new Uint8Array(gzipSync(answers[build]!)))
			}),
	}
	const map = new MapTiles(source)
	const tile = map.tile(3, 4, 5)
	await vi.waitFor(() => expect(fetched).toBeDefined())
	// The new build comes, and the tile read is the new build's
	build = 'planet-2'
	fetched!()
	await expect(tile).rejects.toThrow('new planet')

	fetched = undefined
	const again = map.tile(3, 4, 5)
	await vi.waitFor(() => expect(fetched).toBeDefined())
	fetched!()
	const sent = await again
	expect(sent.build).toBe('planet-2')
	expect(plain(sent)).toBe('new')
})

// A server of the planet's tiles, as Protomaps' Worker serves them: a file
// per tile, and the TileJSON beside them saying how deep they go
async function tileServer(maxZoom: unknown = 15) {
	const served = await serve()
	served.answer = (path) =>
		path.startsWith('/planet-20261011.json')
			? {body: JSON.stringify({tilejson: '3.0.0', maxzoom: maxZoom}), type: 'application/json'}
			: path.startsWith('/planet-20261011/15/')
				? {status: 204}
				: {body: `file ${path}`}
	return served
}

test('a planet served by tile is fetched a tile at a time at its z/x/y, as deep as its TileJSON says', async () => {
	const served = await tileServer()
	const signing = await signer(served)
	const tiles = `${served.address}/planet-20261011/{z}/{x}/{y}.mvt?key=secret`
	signing.answer = () => ({body: {url: tiles, expires: inAWeek()}})
	const map = new MapTiles(umbrelPlanet({api: signing.address}))
	expect(await map.status()).toEqual({available: true, maxZoom: 15, build: 'planet-20261011'})
	const tile = await map.tile(14, 8374, 5574)
	expect(tile.build).toBe('planet-20261011')
	expect(plain(tile)).toBe('file /planet-20261011/14/8374/5574.mvt?key=secret')
	expect(await map.tile(15, 1, 1)).toEqual({build: 'planet-20261011', data: undefined})
	expect(signing.asked).toBe(1)
	expect(served.requests).toEqual([
		'/planet-20261011.json?key=secret',
		'/planet-20261011/0/0/0.mvt?key=secret',
		'/planet-20261011/14/8374/5574.mvt?key=secret',
		'/planet-20261011/15/1/1.mvt?key=secret',
	])
})

test('a planet moved from its archive to a server of its tiles is the same build, and back again', async () => {
	const move = clock()
	const {hosted, signing} = await hosting(streets())
	const map = new MapTiles(umbrelPlanet({api: signing.address}))
	expect(await map.tile(2, 2, 1)).toEqual({build: 'planet-20261011', data: Buffer.from(stored('streets'))})

	const served = await tileServer(2)
	signing.answer = () => ({body: {url: `${served.address}/planet-20261011/{z}/{x}/{y}.mvt`, expires: inAWeek()}})
	move(WEEK)
	const reads = hosted.ranges.length
	const tile = await map.tile(2, 2, 1)
	expect(tile.build).toBe('planet-20261011')
	expect(plain(tile)).toBe('file /planet-20261011/2/2/1.mvt')
	expect(signing.asked).toBe(2)
	expect(await map.status()).toEqual({available: true, maxZoom: 2, build: 'planet-20261011'})
	expect(hosted.ranges).toHaveLength(reads)

	signing.answer = undefined
	move(WEEK)
	expect(await map.tile(2, 2, 1)).toEqual({build: 'planet-20261011', data: Buffer.from(stored('streets'))})
	expect(signing.asked).toBe(3)
	expect(hosted.ranges.length).toBeGreaterThan(reads)
})

test("a server of tiles whose TileJSON doesn't say how deep they go is no address", async () => {
	const served = await serve()
	const signing = await signer(served)
	signing.answer = () => ({body: {url: `${served.address}/planet-20261011/{z}/{x}/{y}.mvt`, expires: inAWeek()}})
	const answers: Answer[] = [
		{status: 404},
		{body: 'not json', type: 'application/json'},
		{body: '{"maxzoom": "15"}'},
		{body: '{"maxzoom": 99}'},
		{stall: true},
	]
	for (const answer of answers) {
		served.answer = () => answer
		await expect(umbrelPlanet({api: signing.address, addressTimeout: 300}).open()).rejects.toThrow()
	}
	expect(signing.asked).toBe(answers.length)
})

test('a device whose clock is out keeps the address its week all the same, by the clock that signed it', async () => {
	const move = clock()
	const {signing} = await hosting(streets())
	// A device a year ahead, by which every address ran out long ago
	signing.clock = () => Date.now() - 365 * DAY
	const source = umbrelPlanet({api: signing.address})
	await source.tile(2, 2, 1, signal())
	move(WEEK - 2 * DAY)
	await source.tile(2, 2, 1, signal())
	expect(signing.asked).toBe(1)

	// An answer Vercel's cache kept for six days has a day left
	signing.age = 6 * DAY
	move(2 * DAY)
	await source.tile(2, 2, 1, signal())
	expect(signing.asked).toBe(2)
	move(DAY - 30_000)
	await source.tile(2, 2, 1, signal())
	expect(signing.asked).toBe(3)
})

test.each<[string, (url: string) => Said]>([
	['an error', () => ({status: 503})],
	['no answer in time', () => ({stall: true})],
	['no JSON', () => ({body: '<html>Sign in to the Wi-Fi</html>'})],
	['no URL', (url) => ({body: {address: url, expires: inAWeek()}})],
	['a URL that is none', () => ({body: {url: 'planet', expires: inAWeek()}})],
	[
		'no TLS',
		() => ({body: {url: 'http://maps.example.com/v1/planet.pmtiles?X-Amz-Signature=secret', expires: inAWeek()}}),
	],
	['no archive', (url) => ({body: {url: url.replace('.pmtiles', ''), expires: inAWeek()}})],
	[
		'tiles with no build to keep them under',
		(url) => ({body: {url: url.replace('/v1/planet-20261011.pmtiles', '/{z}/{x}/{y}.mvt'), expires: inAWeek()}}),
	],
	['a user in the URL', (url) => ({body: {url: url.replace('http://', 'http://user:password@'), expires: inAWeek()}})],
	[
		'tiles without TLS',
		() => ({body: {url: 'http://maps.example.com/planet-20261011/{z}/{x}/{y}.mvt', expires: inAWeek()}}),
	],
	[
		'no name a build can have',
		(url) => ({body: {url: url.replace('planet-20261011', 'planet%2E1'), expires: inAWeek()}}),
	],
	['no time it runs out', (url) => ({body: {url}})],
	['a time that is none', (url) => ({body: {url, expires: 'next week'}})],
	['an address that has run out', (url) => ({body: {url, expires: new Date(Date.now() - DAY).toISOString()}})],
])('an answer from api.umbrel.com with %s is no address, and it is asked again a minute later', async (_, answer) => {
	const move = clock()
	const {signing} = await hosting(streets())
	signing.answer = answer
	const source = umbrelPlanet({api: signing.address, addressTimeout: 300})
	await expect(source.open()).rejects.toThrow()
	signing.answer = undefined
	await expect(source.tile(2, 2, 1, signal())).rejects.toThrow()
	expect(signing.asked).toBe(1)
	move(61_000)
	expect(await source.tile(2, 2, 1, signal())).toEqual(stored('streets'))
	expect(signing.asked).toBe(2)
})

test("the planet's signed address is in no error", async () => {
	const {hosted, signing} = await hosting(streets())
	const failures: unknown[] = []
	const fails = async (read: Promise<unknown>) =>
		failures.push(
			await read.then(
				() => undefined,
				(error) => error,
			),
		)

	// R2 refusing it, failing, out of time and out of reach
	hosted.refuses = () => true
	await fails(umbrelPlanet({api: signing.address}).tile(2, 2, 1, signal()))
	hosted.refuses = () => false
	hosted.answer = () => 503
	await fails(umbrelPlanet({api: signing.address}).tile(2, 2, 1, signal()))
	hosted.answer = () => 'stall'
	await fails(umbrelPlanet({api: signing.address, readTimeout: 300}).tile(2, 2, 1, signal()))
	hosted.answer = () => undefined
	signing.answer = (url) => ({body: {url: url.replace(hosted.address, NOWHERE), expires: inAWeek()}})
	await fails(umbrelPlanet({api: signing.address}).tile(2, 2, 1, signal()))
	// api.umbrel.com saying it in a way that is no use
	signing.answer = (url) => ({body: {url, expires: 'next week'}})
	await fails(umbrelPlanet({api: signing.address}).tile(2, 2, 1, signal()))
	signing.answer = (url) => ({body: {url: `not ${url}`, expires: inAWeek()}})
	await fails(umbrelPlanet({api: signing.address}).tile(2, 2, 1, signal()))
	// … and through MapTiles
	signing.answer = undefined
	hosted.answer = () => 503
	const map = new MapTiles(umbrelPlanet({api: signing.address}))
	await fails(map.tile(2, 2, 1))

	expect(failures).toHaveLength(7)
	for (const error of failures) {
		expect(error).toBeInstanceOf(Error)
		expect(inspect(error, {depth: 10, showHidden: true})).not.toMatch(/secret|X-Amz/)
	}
	expect(await map.status()).toEqual({available: false, maxZoom: 0})
})

test('a planet out of reach is opened again once it is back', async () => {
	const {hosted, signing} = await hosting(streets())
	hosted.answer = () => 503
	const source = umbrelPlanet({api: signing.address})
	await expect(source.open()).rejects.toThrow('503')
	await expect(source.tile(2, 2, 1, signal())).rejects.toThrow('503')
	hosted.answer = () => undefined
	expect(await source.tile(2, 2, 1, signal())).toEqual(stored('streets'))
	expect(signing.asked).toBe(1)
})

test('the planet keeps only a few of its directories', async () => {
	const places = Array.from({length: 12}, (_, x) => ({x, y: 3, tile: `place ${x}`}))
	const {hosted, signing} = await hosting(archive(places, {z: 4, leafSize: 1}))
	const source = umbrelPlanet({api: signing.address})
	for (const {x, y, tile} of places) expect(await source.tile(4, x, y, signal())).toEqual(stored(tile))
	// A leaf directory and the tile in it for each place
	expect(hosted.ranges).toHaveLength(1 + places.length * 2)
	expect(await source.tile(4, 0, 3, signal())).toEqual(stored('place 0'))
	expect(hosted.ranges).toHaveLength(1 + places.length * 2 + 2)
})

test('a planet replaced where it is read is opened again, though its header fails to be read at first', async () => {
	const {hosted, signing} = await hosting(streets())
	hosted.etag = '"first"'
	const source = umbrelPlanet({api: signing.address})
	expect(await source.tile(2, 2, 1, signal())).toEqual(stored('streets'))

	hosted.planet = archive([{x: 2, y: 1, tile: 'new streets'}], {z: 2})
	hosted.etag = '"second"'
	hosted.answer = (from) => (from === 0 ? 503 : undefined)
	await expect(source.tile(2, 2, 1, signal())).rejects.toThrow('503')
	// pmtiles' own reread of the header would fail unheard here, and end umbreld
	await wait(100)

	hosted.answer = () => undefined
	expect(await source.tile(2, 2, 1, signal())).toEqual(stored('new streets'))
})

test('a read of the planet that stalls is given up in time, keeping the planet, and read again', async () => {
	const places = [
		{x: 0, y: 3, tile: 'here'},
		{x: 1, y: 3, tile: 'next door'},
	]
	const {hosted, signing} = await hosting(archive(places, {z: 4, leafSize: 2}))
	const source = umbrelPlanet({api: signing.address, readTimeout: 1000})
	expect(await source.open()).toEqual({build: 'planet-20261011', maxZoom: 4})
	hosted.answer = (from) => (from === 0 ? undefined : 'stall')

	// A tile that joins the wait for the leaf directory doesn't hold it open
	const start = Date.now()
	const here = source.tile(4, 0, 3, AbortSignal.timeout(1000)).catch((error: Error) => error)
	await wait(800)
	const nextDoor = source.tile(4, 1, 3, AbortSignal.timeout(1000)).catch((error: Error) => error)
	for (const error of await Promise.all([here, nextDoor])) {
		expect(['TimeoutError', 'AbortError']).toContain((error as Error).name)
	}
	expect(Date.now() - start).toBeLessThan(1500)

	hosted.answer = () => undefined
	expect(await source.tile(4, 1, 3, signal())).toEqual(stored('next door'))
	expect(headerReads(hosted.ranges)).toBe(1)
})

test('a read of the planet whose connection drops fails that tile alone, keeping what is read of the planet', async () => {
	const places = [
		{x: 0, y: 3, tile: 'here'},
		{x: 1, y: 3, tile: 'next door'},
	]
	const {hosted, signing} = await hosting(archive(places, {z: 4, leafSize: 2}))
	const source = umbrelPlanet({api: signing.address})
	expect(await source.tile(4, 0, 3, signal())).toEqual(stored('here'))
	const read = hosted.ranges.length

	// The header, the leaf directory and the first tile are read; the next tile's connection drops
	hosted.answer = () => 'drop'
	await expect(source.tile(4, 1, 3, signal())).rejects.toThrow('fetch failed')

	hosted.answer = () => undefined
	expect(await source.tile(4, 1, 3, signal())).toEqual(stored('next door'))
	// Only the dropped tile, and that tile again: no header or directory read anew
	expect(hosted.ranges).toHaveLength(read + 2)
	expect(headerReads(hosted.ranges)).toBe(1)
})
