import {randomBytes} from 'node:crypto'
import {mkdir, readdir, readFile, rename, rm, stat, writeFile} from 'node:fs/promises'
import nodePath from 'node:path'
import {setTimeout as sleep} from 'node:timers/promises'
import {promisify} from 'node:util'
import {gzip as gzipCallback} from 'node:zlib'

import {FetchSource, type Header, PMTiles, SharedPromiseCache, type Source} from 'pmtiles'

// The Map view's basemap: Protomaps vector tiles, served by the device, so a
// browser only ever talks to it (the letters of its labels the browser draws
// itself, in the UI's own font). None of it ships: the device fetches each
// tile as someone looks at a place, from one build of the planet on a server
// — which sees the device's address and which tiles it asks for — and keeps
// it on disk. A build never changes, so what is kept is good until the next
// build replaces all of it.
//
// With nothing to fetch from and nothing kept, the UI draws the atlas it
// bundles instead.

// TODO(#1675): not live yet, so photos.ts reads Protomaps' own build for now.
// Protomaps' Cloudflare Worker in front of the build on R2 (its TileJSON is at
// https://maps.umbrel.com/planet-20261011.json).
export const UMBREL_MAPS: RemoteMap = {
	build: 'planet-20261011',
	maxZoom: 15,
	tiles: 'https://maps.umbrel.com/planet-20261011/{z}/{x}/{y}.mvt',
}

const BUILD_PATTERN = /^[\w-]{1,64}$/
// How long a tile may take to arrive, and each read of a planet archive
const READ_TIMEOUT_MS = 20_000
// How long the map waits to hear whether there is a basemap before drawing
// the atlas, and how long the answer holds
const PROBE_WAIT_MS = 5000
const PROBE_TTL_MS = 60_000
// What is kept on disk, at most: the world down to a few cities' streets.
// Past it, the least recently used go, down to a little under it, so a sweep
// makes room for many tiles rather than one
const CACHE_BYTES = 300 * 1024 * 1024
const CACHE_SWEPT = 0.9
// What a file takes on disk: whole blocks, and one for an empty one
const BLOCK_BYTES = 4096
// A leaf directory of the planet decodes to ~60k entries, some 5 MB of heap:
// pmtiles' default of 100 of them would be half a gigabyte
const PLANET_DIRECTORIES = 8

const gzip = promisify(gzipCallback)

// Where the basemap comes from: a build of the planet, by tile. A tile is its
// bytes, gzipped or not, or undefined where the build has none; a failure
// throws.
export type MapSource = {
	// The build's name, which what is fetched of it is kept under, and its deepest zoom
	open(): Promise<{build: string; maxZoom: number}>
	tile(z: number, x: number, y: number, signal: AbortSignal): Promise<Uint8Array | undefined>
}

export type RemoteMap = {build: string; maxZoom: number; tiles: string}

// A build served a tile at a time, at a z/x/y address
export function remoteMap({build, maxZoom, tiles}: RemoteMap): MapSource {
	return {
		open: async () => ({build, maxZoom}),
		tile: (z, x, y, signal) => fetchFile(fill(tiles, {z, x, y}), signal),
	}
}

const fill = (template: string, values: Record<string, string | number>) =>
	template.replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(values[name]!))

// One of a source's files: 204 is a file it doesn't have, and anything but
// that or a 200 a failure. fetch undoes whatever Content-Encoding it came in.
async function fetchFile(url: string, signal: AbortSignal) {
	const response = await fetch(url, {signal})
	if (response.status === 204) return undefined
	// A captive portal's page, or a host's own error page, is no tile, and
	// would be kept for good
	if (response.status !== 200 || /^text\/|html|xml|json/.test(response.headers.get('content-type') ?? '')) {
		await response.body?.cancel()
		throw new Error(`${response.status} for ${url}`)
	}
	const data = new Uint8Array(await response.arrayBuffer())
	return data.length > 0 ? data : undefined
}

export default class MapTiles {
	#directory: string
	#source: MapSource
	#readTimeout: number
	#probeWait: number
	#cacheBytes: number
	#cache?: {build: string; cache: DiskCache}
	#status?: {at: number; answer: Promise<{available: boolean; maxZoom: number}>}

	// `directory` is where the tiles fetched are kept, a directory
	// per build
	constructor(
		directory: string,
		source: MapSource,
		{readTimeout = READ_TIMEOUT_MS, probeWait = PROBE_WAIT_MS, cacheBytes = CACHE_BYTES} = {},
	) {
		this.#directory = directory
		this.#source = source
		this.#readTimeout = readTimeout
		this.#probeWait = probeWait
		this.#cacheBytes = cacheBytes
	}

	// Whether there is a basemap to draw, and how far in the map can ask for
	// tiles; it magnifies past that. There is when the world's one tile at
	// zoom 0 can be had, fetched or kept, in time. Every page with a map asks,
	// so the answer is kept a while.
	status() {
		if (this.#status && Date.now() - this.#status.at < PROBE_TTL_MS) return this.#status.answer
		const probe = Promise.all([this.#source.open(), this.tile(0, 0, 0)]).then(([{maxZoom}]) => maxZoom)
		const answer = Promise.race([probe, sleep(this.#probeWait, undefined, {ref: false})])
			.catch(() => undefined)
			.then((maxZoom) => ({available: maxZoom !== undefined, maxZoom: maxZoom ?? 0}))
		this.#status = {at: Date.now(), answer}
		return answer
	}

	// A tile, gzipped, or undefined where the planet has none
	tile(z: number, x: number, y: number) {
		return this.#get(`tiles/${z}/${x}/${y}.mvt`, (signal) => this.#source.tile(z, x, y, signal))
	}

	async #get(key: string, fetch: (signal: AbortSignal) => Promise<Uint8Array | undefined>) {
		const {build} = await this.#source.open()
		if (!BUILD_PATTERN.test(build)) throw new Error(`Invalid map build ${build}`)
		if (this.#cache?.build !== build) {
			this.#cache = {build, cache: new DiskCache(this.#directory, build, this.#cacheBytes)}
		}
		return this.#cache.cache.get(key, async () => {
			const data = await fetch(AbortSignal.timeout(this.#readTimeout))
			// Kept, and sent, gzipped: a tile is a third the size. Some
			// sources store them that way already
			return data && (data[0] === 0x1f && data[1] === 0x8b ? Buffer.from(data) : gzip(data))
		})
	}
}

// What is kept of one build, in a directory of its own, the least recently
// used going first once it is past its size. What the build has none of is
// kept too, as an empty file, so it isn't asked for again and again; a
// failure isn't, as the source may only have been out of reach. Each file is
// fetched once however many ask for it at the same time.
class DiskCache {
	#directory: string
	#limit: number
	// Each file's size on disk, least recently used first
	#files = new Map<string, number>()
	#size = 0
	#pending = new Map<string, Promise<Buffer | undefined>>()
	#loaded: Promise<void>

	constructor(root: string, build: string, limit: number) {
		this.#directory = nodePath.join(root, build)
		this.#limit = limit
		this.#loaded = this.#load(root, build).catch(() => {})
	}

	get(key: string, fetch: () => Promise<Buffer | undefined>) {
		let pending = this.#pending.get(key)
		if (!pending) {
			pending = this.#read(key, fetch).finally(() => this.#pending.delete(key))
			this.#pending.set(key, pending)
		}
		return pending
	}

	async #read(key: string, fetch: () => Promise<Buffer | undefined>) {
		const kept = await readFile(nodePath.join(this.#directory, key)).catch(() => undefined)
		if (kept) {
			void this.#loaded.then(() => this.#used(key))
			return kept.length > 0 ? kept : undefined
		}
		const data = await fetch()
		// Not kept is only fetched again
		await this.#write(key, data ?? Buffer.alloc(0)).catch(() => {})
		return data
	}

	async #write(key: string, data: Buffer) {
		// Not while what is kept is being counted: it clears away the
		// temporary files of writes cut short
		await this.#loaded
		const path = nodePath.join(this.#directory, key)
		await mkdir(nodePath.dirname(path), {recursive: true})
		const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`
		try {
			await writeFile(temporary, data)
			await rename(temporary, path)
		} catch (error) {
			await rm(temporary, {force: true})
			throw error
		}
		this.#keep(key, data.length)
	}

	#keep(key: string, length: number) {
		const size = Math.max(1, Math.ceil(length / BLOCK_BYTES)) * BLOCK_BYTES
		this.#size += size - (this.#files.get(key) ?? 0)
		this.#files.delete(key)
		this.#files.set(key, size)
		if (this.#size <= this.#limit) return
		for (const [evicted, evictedSize] of this.#files) {
			if (this.#size <= this.#limit * CACHE_SWEPT) break
			this.#files.delete(evicted)
			this.#size -= evictedSize
			void rm(nodePath.join(this.#directory, evicted), {force: true}).catch(() => {})
		}
	}

	#used(key: string) {
		const size = this.#files.get(key)
		if (size === undefined) return
		this.#files.delete(key)
		this.#files.set(key, size)
	}

	// Counted once, when the build is first asked for, rather than as each
	// file is: oldest first, as when each was last used went with the last run
	async #load(root: string, build: string) {
		// Other builds', which nothing asks for again
		for (const name of await readdir(root).catch(() => [])) {
			if (name !== build) await rm(nodePath.join(root, name), {recursive: true, force: true})
		}
		const files: Array<{key: string; length: number; at: number}> = []
		const walk = async (directory: string): Promise<void> => {
			const entries = await readdir(nodePath.join(this.#directory, directory), {withFileTypes: true}).catch(() => [])
			await Promise.all(
				entries.map(async (entry) => {
					const key = nodePath.join(directory, entry.name)
					const path = nodePath.join(this.#directory, key)
					if (entry.isDirectory()) return walk(key)
					if (entry.name.endsWith('.tmp')) return rm(path, {force: true})
					const kept = await stat(path).catch(() => undefined)
					if (kept) files.push({key, length: kept.size, at: kept.mtimeMs})
				}),
			)
		}
		await walk('')
		for (const {key, length} of files.sort((a, b) => a.at - b.at)) this.#keep(key, length)
	}
}

// STOPGAP until UMBREL_MAPS is live (#1675); then delete from here to the
// end of the file, and point photos.ts at remoteMap(UMBREL_MAPS). Protomaps'
// own daily build of the planet, a free community resource that keeps each
// build a week, read a tile at a time out of its PMTiles archive.

export async function latestProtomapsBuild() {
	for (let daysAgo = 0; daysAgo < 8; daysAgo++) {
		const day = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10).replaceAll('-', '')
		const planet = `https://build.protomaps.com/${day}.pmtiles`
		if ((await fetch(planet, {method: 'HEAD', signal: AbortSignal.timeout(PROBE_WAIT_MS)})).ok) return planet
	}
	throw new Error('No planet build to read the map from')
}

// The planet `planet` gives the address of, opened once, and what is read of
// its directories kept. A failed attempt isn't, so a planet that comes back
// is found. `readTimeout` is how long each read of it may take.
export function protomapsPlanet(planet = latestProtomapsBuild, readTimeout = READ_TIMEOUT_MS): MapSource {
	let archive: Promise<{tiles: PMTiles; build: string; maxZoom: number}> | undefined
	const open = () =>
		(archive ??= (async () => {
			const address = await planet()
			// Only the archive's directories are decompressed here: tiles come out as stored
			const tiles = new PMTiles(new PlanetSource(address, readTimeout), new PlanetCache(), async (data) => data)
			const header = await tiles.getHeader()
			return {tiles, build: `protomaps-${nodePath.basename(address, '.pmtiles')}`, maxZoom: header.maxZoom}
		})().catch((error) => {
			archive = undefined
			throw error
		}))
	return {
		async open() {
			const {build, maxZoom} = await open()
			return {build, maxZoom}
		},
		async tile(z, x, y, signal) {
			const {tiles} = await open()
			try {
				const tile = await tiles.getZxy(z, x, y, signal)
				return tile && new Uint8Array(tile.data)
			} catch (error) {
				// What was read of the planet may be what failed: the next tile starts
				// afresh. A tile that only ran out of time, or was given up on with
				// the directory it waited for, says nothing about the rest.
				if (!['TimeoutError', 'AbortError'].includes((error as Error).name)) archive = undefined
				throw error
			}
		},
	}
}

// The planet, with no read of it left waiting on a connection that has
// stalled. pmtiles reads the header with no signal, and a directory with one
// that aborts only once every tile waiting on it has, which a stream of
// tiles may never let happen, so each read has a time limit of its own too.
class PlanetSource extends FetchSource {
	#timeout: number
	constructor(url: string, timeout: number) {
		super(url)
		this.#timeout = timeout
	}
	getBytes(offset: number, length: number, signal?: AbortSignal, etag?: string) {
		const timeout = AbortSignal.timeout(this.#timeout)
		if (!signal) return super.getBytes(offset, length, timeout, etag)
		// Either signal, as AbortSignal.any would, which Node 18 doesn't have
		const either = new AbortController()
		for (const abort of [signal, timeout]) {
			if (abort.aborted) either.abort(abort.reason)
			abort.addEventListener('abort', () => either.abort(abort.reason), {once: true})
		}
		return super.getBytes(offset, length, either.signal, etag)
	}
}

// What is kept of the planet: a few directories, and nothing that failed to
// be read, so the next tile that needs it reads it again.
class PlanetCache extends SharedPromiseCache {
	constructor() {
		super(PLANET_DIRECTORIES)
	}
	async getHeader(source: Source) {
		try {
			return await super.getHeader(source)
		} catch (error) {
			this.cache.delete(source.getKey())
			throw error
		}
	}
	async getDirectory(source: Source, offset: number, length: number, header: Header, signal?: AbortSignal) {
		try {
			return await super.getDirectory(source, offset, length, header, signal)
		} catch (error) {
			// The key pmtiles keeps a directory under
			const key = `${source.getKey()}|${header.etag || ''}|${offset}|${length}`
			this.cache.delete(key)
			this.pendingFetches.delete(key)
			throw error
		}
	}
	// When the planet has changed under it, pmtiles reads the header again here
	// with nothing to hear that read fail, and the rejection would end umbreld.
	// Forgetting the header is enough: getZxy's retry reads it, and hears.
	async invalidate(source: Source) {
		this.cache.delete(source.getKey())
	}
}
