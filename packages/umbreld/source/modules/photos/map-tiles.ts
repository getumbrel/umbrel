import nodePath from 'node:path'
import {setTimeout as sleep} from 'node:timers/promises'
import {promisify} from 'node:util'
import {gzip as gzipCallback} from 'node:zlib'

import {FetchSource, type Header, PMTiles, SharedPromiseCache, type Source} from 'pmtiles'

// The Map view's basemap: Protomaps vector tiles, served by the device, so a
// browser only ever talks to it (the letters of its labels the browser draws
// itself, in the UI's own font). None of it ships, and the device keeps none
// of it: it fetches each tile as someone looks at a place, from the build of
// the planet Umbrel keeps on Cloudflare R2, and the browser keeps what it is
// sent, for good, as a build never changes. Where that is comes from
// api.umbrel.com, good for a week, so the device asks there about once a week:
// either the PMTiles archive itself, at an address signed for R2, which the
// device reads by byte range, or a server of its tiles at a z/x/y address,
// such as Protomaps' Cloudflare Worker in front of it, which answers each tile
// in one request and from Cloudflare's cache. Which, api.umbrel.com alone
// decides. Cloudflare sees the device's address and which parts of the planet
// it reads.
//
// With nothing to fetch from, the UI draws the atlas it bundles instead.

// Where the planet is, and until when that address is good:
// {url: "https://….r2.cloudflarestorage.com/v1/planet-20261011.pmtiles?X-Amz-…", expires: "2026-10-21T17:19:42.195Z"}
// or its tiles, the deepest zoom of which their TileJSON beside them says
// (https://maps.umbrel.com/planet-20261011.json here):
// {url: "https://maps.umbrel.com/planet-20261011/{z}/{x}/{y}.mvt", expires: …}
export const UMBREL_MAP_URL = 'https://api.umbrel.com/map-url'

const BUILD_PATTERN = /^[\w-]{1,64}$/
// How long a tile may take to arrive, and each read of a planet archive
const READ_TIMEOUT_MS = 20_000
// How long api.umbrel.com may take to say where the planet is
const ADDRESS_TIMEOUT_MS = 10_000
// The planet's address is asked for again an hour before it runs out, so an
// hour of api.umbrel.com being out goes unnoticed, and no read starts on it in
// its last minute, which one may still be under way in. Asking again waits a
// minute after the last time, whatever that gave.
const ADDRESS_RENEWED_EARLY_MS = 60 * 60_000
const ADDRESS_LAST_READ_MS = 60_000
const ADDRESS_RETRY_MS = 60_000
// How long the map waits to hear whether there is a basemap before drawing
// the atlas, and how long the answer holds
const PROBE_WAIT_MS = 5000
const PROBE_TTL_MS = 60_000
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

// A build served a tile at a time, at a z/x/y address. Not where the device
// reads the planet from (that is umbrelPlanet), but the plainest source there
// is, which what MapTiles does with any source is tried against.
export function remoteMap({build, maxZoom, tiles}: RemoteMap): MapSource {
	return {
		open: async () => ({build, maxZoom}),
		tile: (z, x, y, signal) => fetchFile(fill(tiles, {z, x, y}), signal),
	}
}

const withoutQuery = (address: string) => address.split(/[?#]/)[0]!

const fill = (template: string, values: Record<string, string | number>) =>
	template.replace(/\{(\w+)\}/g, (_, name: string) => encodeURIComponent(values[name]!))

// One of a source's files: 204 is a file it doesn't have, and anything but
// that or a 200 a failure. fetch undoes whatever Content-Encoding it came in.
// The failure names the file but not its query, which may be a credential.
async function fetchFile(url: string, signal: AbortSignal) {
	const response = await fetch(url, {signal})
	if (response.status === 204) return undefined
	// A captive portal's page, or a host's own error page, is no tile, and
	// would be kept for good
	if (response.status !== 200 || /^text\/|html|xml|json/.test(response.headers.get('content-type') ?? '')) {
		await response.body?.cancel()
		throw new Error(`${response.status} for ${withoutQuery(url)}`)
	}
	const data = new Uint8Array(await response.arrayBuffer())
	return data.length > 0 ? data : undefined
}

export type MapTile = {
	// The build it is of, which a browser may keep it under for good
	build: string
	// Gzipped, or undefined where the build has none
	data?: Buffer
}

export default class MapTiles {
	#source: MapSource
	#readTimeout: number
	#probeWait: number
	#pending = new Map<string, Promise<MapTile>>()
	#status?: {at: number; answer: Promise<{available: boolean; maxZoom: number; build?: string}>}
	// Whether the source has given a tile since it last failed to
	#answering = false

	constructor(source: MapSource, {readTimeout = READ_TIMEOUT_MS, probeWait = PROBE_WAIT_MS} = {}) {
		this.#source = source
		this.#readTimeout = readTimeout
		this.#probeWait = probeWait
	}

	// Whether there is a basemap to draw, which build, and how far in the map
	// can ask for tiles; it magnifies past that. There is when the world's one
	// tile at zoom 0 can be had in time, and from then on for as long as the
	// source goes on giving the tiles asked of it: asked again, only the build
	// is looked up, which reads nothing of the planet (see umbrelPlanet), and
	// once a tile fails, the world's tile is asked for again. Every page with
	// a map asks, so the answer is kept a while.
	status() {
		if (this.#status && Date.now() - this.#status.at < PROBE_TTL_MS) return this.#status.answer
		const opened = this.#source.open()
		const probe = this.#answering ? opened : Promise.all([opened, this.tile(0, 0, 0)]).then(([opened]) => opened)
		const answer = Promise.race([probe, sleep(this.#probeWait, undefined, {ref: false})])
			.catch(() => undefined)
			.then((opened) => (opened ? {available: true, ...opened} : {available: false, maxZoom: 0}))
		this.#status = {at: Date.now(), answer}
		return answer
	}

	// The first look, taken before anyone asks (as umbreld starts), so the
	// first map opened finds the answer in. One that found no basemap isn't
	// kept: whoever asks next looks again.
	async warm() {
		const answer = this.status()
		const kept = this.#status
		if (!(await answer).available && this.#status === kept) this.#status = undefined
	}

	// A tile, fetched once however many ask for it at the same time
	async tile(z: number, x: number, y: number): Promise<MapTile> {
		const {build} = await this.#source.open()
		const key = `${build}/${z}/${x}/${y}`
		let pending = this.#pending.get(key)
		if (!pending) {
			pending = (async () => {
				const data = await this.#source.tile(z, x, y, AbortSignal.timeout(this.#readTimeout)).then(
					(data) => {
						this.#answering = true
						return data
					},
					(error) => {
						// Whether there is a basemap is for the next to ask to find out afresh
						if (this.#answering) this.#status = undefined
						this.#answering = false
						throw error
					},
				)
				// A new build may have come while it was fetched, and the tile be of
				// that one: sent as the last, a browser would keep it under the last
				// for good, so it is none of either, and asked for again
				if ((await this.#source.open()).build !== build) throw new Error('The map has a new planet')
				// Sent gzipped: a tile is a third the size. Some sources store them
				// that way already
				return {build, data: data && (data[0] === 0x1f && data[1] === 0x8b ? Buffer.from(data) : await gzip(data))}
			})().finally(() => this.#pending.delete(key))
			this.#pending.set(key, pending)
		}
		return pending
	}
}

// The planet Umbrel hosts, at the address api.umbrel.com gives for it
// (`api`): a tile at a time from a server of its tiles, or out of its PMTiles
// archive. The archive is opened once, and what is read of its directories
// kept, under the address without its signature, so a new signature for the
// same archive reads on from what is kept. A failed attempt to open it isn't
// kept, so a planet that comes back is found. `readTimeout` is how long each
// read of it may take, and `addressTimeout` how long api.umbrel.com, and a
// tile server's TileJSON, may take to answer.
export function umbrelPlanet({
	api = UMBREL_MAP_URL,
	readTimeout = READ_TIMEOUT_MS,
	addressTimeout = ADDRESS_TIMEOUT_MS,
} = {}): MapSource {
	const address = new PlanetAddress(api, addressTimeout)
	type Archive = {key: string; opened: Promise<{tiles: PMTiles; build: string; maxZoom: number}>}
	let archive: Archive | undefined
	const forget = (opened: Archive) => {
		if (archive === opened) archive = undefined
	}
	// A new build comes at an address of its own, and is opened in the last
	// one's place. A planet now served by tile has no archive to keep open.
	const at = async () => {
		const current = await address.get()
		if (current.kind === 'tiles') archive = undefined
		return current
	}
	const open = ({key, build}: ArchiveAddress) => {
		if (archive?.key === key) return archive
		const opening: Archive = {
			key,
			opened: (async () => {
				// Only the archive's directories are decompressed here: tiles come out as stored
				const tiles = new PMTiles(new PlanetSource(address, key, readTimeout), new PlanetCache(), async (data) => data)
				const header = await tiles.getHeader()
				return {tiles, build, maxZoom: header.maxZoom}
			})(),
		}
		opening.opened.catch(() => forget(opening))
		return (archive = opening)
	}
	return {
		async open() {
			const current = await at()
			if (current.kind === 'tiles') return {build: current.build, maxZoom: current.maxZoom}
			const {build, maxZoom} = await open(current).opened
			return {build, maxZoom}
		},
		async tile(z, x, y, signal) {
			const current = await at()
			if (current.kind === 'tiles') return fetchFile(fill(current.tiles, {z, x, y}), signal)
			const opened = open(current)
			const {tiles} = await opened.opened
			try {
				const tile = await tiles.getZxy(z, x, y, signal)
				return tile && new Uint8Array(tile.data)
			} catch (error) {
				// What was read of the planet may be what failed: the next tile starts
				// afresh. A tile that only ran out of time, was given up on with the
				// directory it waited for, or lost its connection says nothing about
				// the rest, and starting afresh would read the header and directories
				// again for every tile after it.
				if (!unreached(error)) forget(opened)
				throw error
			}
		},
	}
}

// Where the planet is, as api.umbrel.com last said: its archive or its tiles,
// what it is known by, and, by this device's clock, when to ask again and when
// it may be read no more.
type Address = {
	// The address without its query, which may be a signature
	key: string
	// The archive's file name, or the tiles' directory, which what is fetched
	// of it is kept under: the same build either way, served either way
	build: string
	// When it was given, and when to ask again and when it may be read no more
	askedAt: number
	renewAt: number
	lastReadAt: number
} & ({kind: 'archive'; source: FetchSource} | {kind: 'tiles'; tiles: string; maxZoom: number})

type ArchiveAddress = Extract<Address, {kind: 'archive'}>

// A server of a build's tiles: …/<build>/{z}/{x}/{y}.<extension>, maybe with a query
const TILES_PATTERN = /^[a-z]+:\/\/[^/?#]+\/(?:[^?#]*\/)?([\w-]{1,64})\/\{z\}\/\{x\}\/\{y\}\.\w+(?:\?[^#]*)?$/

// The planet's address, signed for a week, which is a credential for that
// long: it is never logged, and no error says more of it than its path. It
// is asked for once however many reads want it at the same time. Shortly
// before it runs out it is asked for again while reads go on at the one
// there is, which they keep doing if asking fails, so a read only waits on
// api.umbrel.com when there is no address that is still good.
class PlanetAddress {
	#api: string
	#timeout: number
	#current?: Address
	#asking?: Promise<Address>
	#quietUntil = 0
	// Why asking last failed, which a read with no address to go on is told
	// until it is time to ask again, rather than every device asking each tile
	#failure?: unknown

	constructor(api: string, timeout: number) {
		this.#api = api
		this.#timeout = timeout
	}

	async get() {
		const now = Date.now()
		const current = this.#current
		if (!current || now >= current.lastReadAt) {
			if (this.#failure && now < this.#quietUntil) throw this.#failure
			return this.#ask()
		}
		if (now >= current.renewAt && now >= this.#quietUntil) this.#ask().catch(() => {})
		return current
	}

	// R2 refused it: its signature has run out, or isn't good yet, by
	// Cloudflare's clock. The next read that wants it asks for it again, unless
	// one already has, or it was only just given: asking again so soon would
	// get the same, so it is kept, refused, until a minute is up. Whether it
	// was let go.
	refused(address: Address) {
		if (this.#current !== address) return true
		if (Date.now() - address.askedAt < ADDRESS_RETRY_MS) return false
		this.#current = undefined
		return true
	}

	#ask() {
		return (this.#asking ??= this.#fetch()
			.then(
				(address) => {
					this.#failure = undefined
					return (this.#current = address)
				},
				(error) => {
					this.#failure = error
					throw error
				},
			)
			.finally(() => {
				this.#asking = undefined
				this.#quietUntil = Date.now() + ADDRESS_RETRY_MS
			}))
	}

	async #fetch(): Promise<Address> {
		const response = await fetch(this.#api, {signal: AbortSignal.timeout(this.#timeout)})
		if (response.status !== 200) {
			await response.body?.cancel()
			throw new Error(`${response.status} for the map's address`)
		}
		const answer = (await response.json().catch(() => undefined)) as {url?: unknown; expires?: unknown} | undefined
		// The tiles' address as it was given: a URL would escape its braces
		const tiles = typeof answer?.url === 'string' ? TILES_PATTERN.exec(answer.url) : null
		const url = parseUrl(answer?.url)
		const secure = url?.protocol === 'https:' || (url?.protocol === 'http:' && LOOPBACK.includes(url.hostname))
		const build = tiles
			? tiles[1]
			: url?.pathname.endsWith('.pmtiles') && nodePath.posix.basename(url.pathname, '.pmtiles')
		// A URL with a user in it fetch refuses, in an error that has all of it
		const plain = url && !url.username && !url.password
		if (!url || !secure || !plain || !build || !BUILD_PATTERN.test(build)) {
			throw new Error('No map address in the answer')
		}
		const expires = typeof answer?.expires === 'string' ? Date.parse(answer.expires) : NaN
		// How long it is good for, by the clock of the server that signed it,
		// which is Cloudflare's to within a little, rather than by this
		// device's, which may be far out: a device that has been off a while,
		// with no clock of its own, starts in the past. An answer kept by
		// Vercel's cache says how long it has been.
		const said = Date.parse(response.headers.get('date') ?? '')
		const age = Number(response.headers.get('age')) * 1000 || 0
		const lifetime = expires - (Number.isNaN(said) ? Date.now() : said + age)
		if (!(lifetime > ADDRESS_LAST_READ_MS)) throw new Error('The map address in the answer has run out')
		const served = tiles
			? {kind: 'tiles' as const, tiles: answer!.url as string, maxZoom: await this.#deepestZoom(answer!.url as string)}
			: {kind: 'archive' as const, source: new FetchSource(url.href)}
		const now = Date.now()
		return {
			key: withoutQuery(served.kind === 'tiles' ? served.tiles : url.href),
			build,
			askedAt: now,
			renewAt: now + lifetime - ADDRESS_RENEWED_EARLY_MS,
			lastReadAt: now + lifetime - ADDRESS_LAST_READ_MS,
			...served,
		}
	}

	// How far in a server of tiles goes, as the TileJSON beside them says:
	// …/<build>.json for …/<build>/{z}/{x}/{y}.mvt, with the same query
	async #deepestZoom(tiles: string) {
		const response = await fetch(tiles.replace(/\/\{z\}\/\{x\}\/\{y\}\.\w+/, '.json'), {
			signal: AbortSignal.timeout(this.#timeout),
		})
		const tileJson = response.status === 200 ? await response.json().catch(() => undefined) : undefined
		if (response.status !== 200) await response.body?.cancel()
		const maxZoom = (tileJson as {maxzoom?: unknown} | undefined)?.maxzoom
		if (!Number.isInteger(maxZoom) || (maxZoom as number) < 0 || (maxZoom as number) > 30) {
			throw new Error(`No deepest zoom in the map's TileJSON (${response.status})`)
		}
		return maxZoom as number
	}
}

// A read that never got an answer: out of time, given up on, or one whose
// connection failed — which fetch reports as a TypeError of its own, the
// cause (a reset, a refused or timed-out connect) beneath it
function unreached(error: unknown) {
	const {name, message} = error as Error
	return name === 'TimeoutError' || name === 'AbortError' || (error instanceof TypeError && message === 'fetch failed')
}

// Only a test's server is at one of these, without TLS
const LOOPBACK = ['127.0.0.1', '[::1]', 'localhost']

// No URL, rather than a TypeError that would carry all of it
function parseUrl(address: unknown) {
	try {
		return typeof address === 'string' ? new URL(address) : undefined
	} catch {
		return undefined
	}
}

// How pmtiles' FetchSource fails a read R2 refuses the signature of. The
// package is pinned, and the tests of a refused signature would see it change.
const REFUSED = 'Bad response code: 403'

// The planet, read at its address of the moment, with no read of it left
// waiting on a connection that has stalled. pmtiles reads the header with no
// signal, and a directory with one that aborts only once every tile waiting
// on it has, which a stream of tiles may never let happen, so each read has a
// time limit of its own too. pmtiles keeps what it reads under getKey(), the
// address without its signature, and checks it against the archive's ETag,
// which R2 gives the object whatever the signature: a new signature reads on
// from what is kept.
class PlanetSource implements Source {
	#address: PlanetAddress
	#key: string
	#timeout: number
	constructor(address: PlanetAddress, key: string, timeout: number) {
		this.#address = address
		this.#key = key
		this.#timeout = timeout
	}
	getKey() {
		return this.#key
	}
	async getBytes(offset: number, length: number, signal?: AbortSignal, etag?: string) {
		const address = await this.#signed()
		try {
			return await this.#read(address, offset, length, signal, etag)
		} catch (error) {
			// Once more, at an address signed since: twice refused is a failure
			if ((error as Error).message !== REFUSED || !this.#address.refused(address)) throw error
			return this.#read(await this.#signed(), offset, length, signal, etag)
		}
	}
	async #signed() {
		const address = await this.#address.get()
		// A new build, which another archive reads, or none to read at all
		if (address.kind !== 'archive' || address.key !== this.#key) throw new Error('The map has a new planet')
		return address
	}
	#read(address: ArchiveAddress, offset: number, length: number, signal: AbortSignal | undefined, etag?: string) {
		const timeout = AbortSignal.timeout(this.#timeout)
		if (!signal) return address.source.getBytes(offset, length, timeout, etag)
		// Either signal, as AbortSignal.any would, which Node 18 doesn't have
		const either = new AbortController()
		for (const abort of [signal, timeout]) {
			if (abort.aborted) either.abort(abort.reason)
			abort.addEventListener('abort', () => either.abort(abort.reason), {once: true})
		}
		return address.source.getBytes(offset, length, either.signal, etag)
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
