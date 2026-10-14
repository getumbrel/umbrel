import {once} from 'node:events'
import {readdir, readFile, utimes} from 'node:fs/promises'
import {createServer, type Server} from 'node:http'
import type {AddressInfo} from 'node:net'
import nodePath from 'node:path'
import {gunzipSync, gzipSync} from 'node:zlib'

import {zxyToTileId} from 'pmtiles'
import {afterAll, afterEach, beforeEach, expect, test, vi} from 'vitest'

import temporaryDirectory from '../utilities/temporary-directory.js'
import MapTiles, {protomapsPlanet, remoteMap} from './map-tiles.js'

const temporary = temporaryDirectory()
let directory: string
let servers: Server[] = []

const ONE_BLOCK = 4096
const signal = () => AbortSignal.timeout(20_000)
const plain = (data: Buffer | undefined) => data && gunzipSync(data).toString()
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

// Every file kept under the map's directory, by path
async function kept(under = ''): Promise<string[]> {
	const entries = await readdir(nodePath.join(directory, under), {withFileTypes: true})
	const files = await Promise.all(
		entries.map((entry) => {
			const path = nodePath.join(under, entry.name)
			return entry.isDirectory() ? kept(path) : [path]
		}),
	)
	return files.flat().sort()
}

beforeEach(async () => {
	directory = await temporary.create()
})

afterEach(() => {
	for (const server of servers) {
		server.closeAllConnections()
		server.close()
	}
	servers = []
	vi.restoreAllMocks()
})

afterAll(() => temporary.destroyRoot())

test('a tile is fetched once, kept gzipped under its build, and served from disk after that', async () => {
	const source = await serve()
	const map = new MapTiles(directory, source.map())
	const tile = await map.tile(3, 4, 5)
	expect(isGzip(tile!)).toBe(true)
	expect(plain(tile)).toBe('file /planet-1/3/4/5.mvt')
	expect(await kept()).toEqual(['planet-1/tiles/3/4/5.mvt'])
	expect(await readFile(nodePath.join(directory, 'planet-1/tiles/3/4/5.mvt'))).toEqual(tile)

	expect(plain(await map.tile(3, 4, 5))).toBe('file /planet-1/3/4/5.mvt')
	// … and by the next run of umbreld, without asking the source
	expect(plain(await new MapTiles(directory, source.map()).tile(3, 4, 5))).toBe('file /planet-1/3/4/5.mvt')
	expect(source.requests).toEqual(['/planet-1/3/4/5.mvt'])
})

test('a gzipped tile is kept as it came, whether the response or the tile itself is gzipped', async () => {
	const source = await serve()
	const map = new MapTiles(directory, source.map())

	source.answer = () => ({body: 'encoded', encoding: 'gzip'})
	const encoded = await map.tile(1, 0, 0)
	expect(plain(encoded)).toBe('encoded')

	// The way a PMTiles archive stores them, sent with no Content-Encoding: not gzipped again
	const stored = gzipSync('stored')
	source.answer = () => ({body: stored})
	const tile = await map.tile(1, 1, 0)
	expect(tile).toEqual(stored)
	expect(plain(tile)).toBe('stored')

	// … nor when it is both
	source.answer = () => ({body: stored, encoding: 'gzip'})
	expect(await map.tile(1, 0, 1)).toEqual(stored)
})

test('a tile the build has none of is kept as none, and not asked for again', async () => {
	const source = await serve()
	source.answer = () => ({status: 204})
	const map = new MapTiles(directory, source.map())
	expect(await map.tile(9, 0, 0)).toBeUndefined()
	expect(await map.tile(9, 0, 0)).toBeUndefined()
	source.answer = () => ({body: ''})
	expect(await map.tile(9, 1, 0)).toBeUndefined()
	expect(await map.tile(9, 1, 0)).toBeUndefined()
	expect(source.requests).toEqual(['/planet-1/9/0/0.mvt', '/planet-1/9/1/0.mvt'])
	expect(await kept()).toEqual(['planet-1/tiles/9/0/0.mvt', 'planet-1/tiles/9/1/0.mvt'])
	expect((await readFile(nodePath.join(directory, 'planet-1/tiles/9/0/0.mvt'))).length).toBe(0)
})

test.each<[string, Answer]>([
	['an error', {status: 500}],
	['a tile out of its zooms', {status: 404}],
	['a captive portal', {body: '<html>Sign in to the Wi-Fi</html>', type: 'text/html'}],
	['an error as JSON', {body: '{}', type: 'application/json'}],
	['no answer in time', {stall: true}],
])('a fetch that fails with %s is not kept, and is fetched again', async (_, answer) => {
	const source = await serve()
	source.answer = () => answer
	const map = new MapTiles(directory, source.map(), {readTimeout: 300})
	await expect(map.tile(2, 1, 1)).rejects.toThrow()
	expect(await kept()).toEqual([])

	source.answer = () => ({body: 'back'})
	expect(plain(await map.tile(2, 1, 1))).toBe('back')
	expect(source.requests).toHaveLength(2)
})

test('a source out of reach keeps nothing', async () => {
	const map = new MapTiles(directory, remoteMap({build: 'planet-1', maxZoom: 15, tiles: NOWHERE}))
	await expect(map.tile(0, 0, 0)).rejects.toThrow()
	expect(await kept()).toEqual([])
})

test('requests for the same file at once share one fetch', async () => {
	const source = await serve()
	source.answer = (path) => ({body: `file ${path}`, delay: 100})
	const map = new MapTiles(directory, source.map())
	const first = map.tile(5, 6, 7)
	await wait(50)
	// Joining the fetch still under way, not starting another
	const tiles = await Promise.all([first, ...Array.from({length: 7}, () => map.tile(5, 6, 7))])
	expect(new Set(tiles)).toEqual(new Set([tiles[0]]))
	expect(plain(tiles[0])).toBe('file /planet-1/5/6/7.mvt')
	expect(source.requests).toEqual(['/planet-1/5/6/7.mvt'])

	// … and failing, all fail, and none is kept
	source.answer = () => ({status: 500, delay: 100})
	const failed = await Promise.all(Array.from({length: 4}, () => map.tile(5, 6, 8).catch((error: Error) => error)))
	expect(new Set(failed).size).toBe(1)
	expect(failed[0]).toBeInstanceOf(Error)
	expect(source.requests).toHaveLength(2)
})

test('past its size, the least recently used tiles go first', async () => {
	const source = await serve()
	// Five blocks: one tile each
	const map = new MapTiles(directory, source.map(), {cacheBytes: 5 * ONE_BLOCK})
	for (let x = 0; x < 5; x++) await map.tile(4, x, 0)
	// The first, used again, is now the most recent
	await map.tile(4, 0, 0)
	expect(source.requests).toHaveLength(5)
	await map.tile(4, 5, 0)
	// Down to under nine tenths of it: the two least recently used are gone
	await vi.waitFor(async () =>
		expect(await kept()).toEqual(['0', '3', '4', '5'].map((x) => `planet-1/tiles/4/${x}/0.mvt`)),
	)
	await map.tile(4, 1, 0)
	await map.tile(4, 0, 0)
	expect(source.requests).toHaveLength(7)
})

test('what an earlier run kept counts towards the size, the oldest first out', async () => {
	const source = await serve()
	const first = new MapTiles(directory, source.map())
	for (let x = 0; x < 5; x++) await first.tile(4, x, 0)
	// Written in the order 4, 3, 2, 1, 0
	for (let x = 0; x < 5; x++) {
		const at = new Date(Date.now() - x * 60_000)
		await utimes(nodePath.join(directory, `planet-1/tiles/4/${x}/0.mvt`), at, at)
	}

	const next = new MapTiles(directory, source.map(), {cacheBytes: 5 * ONE_BLOCK})
	await next.tile(4, 5, 0)
	await vi.waitFor(async () =>
		expect(await kept()).toEqual(['0', '1', '2', '5'].map((x) => `planet-1/tiles/4/${x}/0.mvt`)),
	)
})

test('a new build is kept apart from the last, which is cleared away', async () => {
	const source = await serve()
	expect(plain(await new MapTiles(directory, source.map('planet-1')).tile(0, 0, 0))).toBe('file /planet-1/0/0/0.mvt')
	expect(await kept()).toEqual(['planet-1/tiles/0/0/0.mvt'])

	const map = new MapTiles(directory, source.map('planet-2'))
	expect(plain(await map.tile(0, 0, 0))).toBe('file /planet-2/0/0/0.mvt')
	expect(await kept()).toEqual(['planet-2/tiles/0/0/0.mvt'])
	expect(source.requests).toEqual(['/planet-1/0/0/0.mvt', '/planet-2/0/0/0.mvt'])
})

test('there is a basemap when the source has the world, and how far in it goes', async () => {
	const source = await serve()
	expect(await new MapTiles(directory, source.map('planet-1', 15)).status()).toEqual({available: true, maxZoom: 15})
	// A source that has no tile there has still answered
	source.answer = () => ({status: 204})
	expect(await new MapTiles(directory, source.map('planet-2', 14)).status()).toEqual({available: true, maxZoom: 14})
})

test('there is none with the source out of reach or failing, or too slow to answer', async () => {
	const unreachable = remoteMap({build: 'planet-1', maxZoom: 15, tiles: NOWHERE})
	expect(await new MapTiles(directory, unreachable).status()).toEqual({available: false, maxZoom: 0})

	const source = await serve()
	source.answer = () => ({status: 503})
	expect(await new MapTiles(directory, source.map()).status()).toEqual({available: false, maxZoom: 0})

	source.answer = () => ({stall: true})
	const start = Date.now()
	expect(await new MapTiles(directory, source.map(), {probeWait: 200}).status()).toEqual({
		available: false,
		maxZoom: 0,
	})
	expect(Date.now() - start).toBeLessThan(1000)
})

test('a world already kept is a basemap, with or without the source', async () => {
	const source = await serve()
	await new MapTiles(directory, source.map()).tile(0, 0, 0)
	const offline = remoteMap({build: 'planet-1', maxZoom: 15, tiles: NOWHERE})
	expect(await new MapTiles(directory, offline).status()).toEqual({available: true, maxZoom: 15})
	expect(source.requests).toHaveLength(1)
})

test('the answer holds for a minute', async () => {
	const source = await serve()
	source.answer = () => ({status: 503})
	let now = Date.now()
	vi.spyOn(Date, 'now').mockImplementation(() => now)
	const map = new MapTiles(directory, source.map())
	expect((await map.status()).available).toBe(false)

	source.answer = () => ({body: 'the world'})
	now += 30_000
	expect((await map.status()).available).toBe(false)
	expect(source.requests).toHaveLength(1)
	now += 31_000
	expect((await map.status()).available).toBe(true)
	expect(source.requests).toHaveLength(2)
})

// The development stopgap: Protomaps' planet, read out of its archive

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

// A server with one archive on it, read the way a planet is: by byte range.
// What it serves can change, and `answer` can hold a read up or refuse it.
async function host(planet: Buffer) {
	const hosted = {
		planet,
		etag: undefined as string | undefined,
		answer: (() => undefined) as (from: number) => 'stall' | number | undefined,
		ranges: [] as string[],
		address: '',
	}
	const address = await listen(
		createServer((request, response) => {
			const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? '') ?? []
			if (from === undefined) return response.writeHead(400).end()
			hosted.ranges.push(`${from}-${to}`)
			const answer = hosted.answer(Number(from))
			if (answer === 'stall') return
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
	hosted.address = `${address}/planet.pmtiles`
	return hosted
}

// The reads of a header, and with it the root directory
const headerReads = (ranges: string[]) => ranges.filter((range) => range.startsWith('0-')).length

test('the planet is read a tile at a time, as stored, and kept like any other source', async () => {
	const planet = await host(archive([{x: 2, y: 1, tile: 'streets'}], {z: 2}))
	const source = protomapsPlanet(async () => planet.address)
	expect(await source.open()).toEqual({build: 'protomaps-planet', maxZoom: 2})
	expect(await source.tile(2, 2, 1, signal())).toEqual(stored('streets'))
	expect(await source.tile(2, 0, 0, signal())).toBeUndefined()
	// The planet's header and directory were read once, then only the tile asked for
	expect(planet.ranges).toHaveLength(2)

	const map = new MapTiles(directory, source)
	expect(plain(await map.tile(2, 2, 1))).toBe('streets')
	expect(plain(await map.tile(2, 2, 1))).toBe('streets')
	expect(planet.ranges).toHaveLength(3)
	expect(await kept()).toEqual(['protomaps-planet/tiles/2/2/1.mvt'])
	expect(await map.status()).toEqual({available: true, maxZoom: 2})
})

test('a planet out of reach is opened again once it is back', async () => {
	const planet = await host(archive([{x: 2, y: 1, tile: 'streets'}], {z: 2}))
	let address = `${NOWHERE}/planet.pmtiles`
	const source = protomapsPlanet(async () => address)
	await expect(source.open()).rejects.toThrow()
	await expect(source.tile(2, 2, 1, signal())).rejects.toThrow()
	address = planet.address
	expect(await source.tile(2, 2, 1, signal())).toEqual(stored('streets'))
})

test('the planet keeps only a few of its directories', async () => {
	const places = Array.from({length: 12}, (_, x) => ({x, y: 3, tile: `place ${x}`}))
	const planet = await host(archive(places, {z: 4, leafSize: 1}))
	const source = protomapsPlanet(async () => planet.address)
	for (const {x, y, tile} of places) expect(await source.tile(4, x, y, signal())).toEqual(stored(tile))
	// A leaf directory and the tile in it for each place
	expect(planet.ranges).toHaveLength(1 + places.length * 2)
	expect(await source.tile(4, 0, 3, signal())).toEqual(stored('place 0'))
	expect(planet.ranges).toHaveLength(1 + places.length * 2 + 2)
})

test('a planet replaced where it is read is opened again, though its header fails to be read at first', async () => {
	const planet = await host(archive([{x: 2, y: 1, tile: 'streets'}], {z: 2}))
	planet.etag = '"first"'
	const source = protomapsPlanet(async () => planet.address)
	expect(await source.tile(2, 2, 1, signal())).toEqual(stored('streets'))

	planet.planet = archive([{x: 2, y: 1, tile: 'new streets'}], {z: 2})
	planet.etag = '"second"'
	planet.answer = (from) => (from === 0 ? 503 : undefined)
	await expect(source.tile(2, 2, 1, signal())).rejects.toThrow('503')
	// pmtiles' own reread of the header would fail unheard here, and end umbreld
	await wait(100)

	planet.answer = () => undefined
	expect(await source.tile(2, 2, 1, signal())).toEqual(stored('new streets'))
})

test('a read of the planet that stalls is given up in time, keeping the planet, and read again', async () => {
	const places = [
		{x: 0, y: 3, tile: 'here'},
		{x: 1, y: 3, tile: 'next door'},
	]
	const planet = await host(archive(places, {z: 4, leafSize: 2}))
	const source = protomapsPlanet(async () => planet.address, 1000)
	expect(await source.open()).toEqual({build: 'protomaps-planet', maxZoom: 4})
	planet.answer = (from) => (from === 0 ? undefined : 'stall')

	// A tile that joins the wait for the leaf directory doesn't hold it open
	const start = Date.now()
	const here = source.tile(4, 0, 3, AbortSignal.timeout(1000)).catch((error: Error) => error)
	await wait(800)
	const nextDoor = source.tile(4, 1, 3, AbortSignal.timeout(1000)).catch((error: Error) => error)
	for (const error of await Promise.all([here, nextDoor])) {
		expect(['TimeoutError', 'AbortError']).toContain((error as Error).name)
	}
	expect(Date.now() - start).toBeLessThan(1500)

	planet.answer = () => undefined
	expect(await source.tile(4, 1, 3, signal())).toEqual(stored('next door'))
	expect(headerReads(planet.ranges)).toBe(1)
})
