import PQueue from 'p-queue'

import type Umbreld from '../../index.ts'
import {embedQuery, embeddingsAvailable, romanise} from '../files/embeddings.ts'
import {modelsDirectory, modelsInstalled} from '../files/models.ts'
import {videoStill} from '../files/file-index-enrichment.ts'
import type {File} from '../files/files.ts'
import {readableKind} from '../files/readable.ts'
import type {PhotoFilter} from '../photos/types.ts'
import {photoKind} from '../photos/types.ts'

import {OWNER_USER_ID} from '../user/constants.ts'
import {NEAR, nameMatches, nameStrength} from './names.ts'
import {asTyped, leftOf, readWords, typedWords, type Read} from './query.ts'
import type {
	SearchFound,
	SearchInsights,
	SearchResponse,
	SearchResult,
	SearchResultKind,
	SearchScope,
	SearchStatus,
	SearchIndexing,
} from './types.ts'

// A still of a video at a moment a search found in it is this many pixels
// along its longer side
const MOMENT_SIZE = 384

// Search finds the user's own things by what is in them, not only by what
// they are called: a photo or video by what it shows, a document or a
// picture by the words in it, a video or recording by what is said in it.
// Every result is a file the one asking can already open.
//
// The models read the library as part of the file index's enrichment (see
// ../files/embeddings.ts). This asks the index what they found (see hits.ts)
// and shows each file as Files itself reports it. On a device the models
// don't run on, a search still finds things by name.
const WAITING_FOR_MEMORY_NOTIFICATION = 'search-indexing-waiting-for-memory'
const NO_ROOM_FOR_MODELS_NOTIFICATION = 'search-models-no-room'
const MEMORY_WATCH_MS = 30 * 60_000
const MEMORY_WAIT_TO_TELL_MS = 24 * 60 * 60_000
// How sure it is that what fits the filters read out of what was typed is
// what was meant, where files are looked for by name too: a place's name and
// nothing else ("paris") may as well be what a file is called. See hits.ts
// for what stands beside it.
const READ_SO = 0.6
// The most a search finds, and the most of it by name alone: what is further
// down a list than this is not what anyone was looking for
const MOST_RESULTS = 1000
const MOST_NAMES = 200
// What a search found is kept this long, for the pages after its first to be
// of the same answer and not to be worked out again: for this many searches
const ANSWER_KEPT_MS = 60_000
const ANSWERS_KEPT = 8

// Everything a search found, surest first, before any of it is shown
type Answer = {
	understood: SearchResponse['understood']
	// `file` where Files has just named it, which is all that is asked of it
	found: Array<{path: string; strength: number; file?: File; result: SearchFound}>
}

export default class Search {
	#umbreld: Umbreld
	logger: Umbreld['logger']
	// Stills are each a run of FFmpeg: two at a time, whoever is asking
	#stills = new PQueue({concurrency: 2})

	constructor(umbreld: Umbreld) {
		this.#umbreld = umbreld
		this.logger = umbreld.logger.createChildLogger('search')
	}

	#modelsInstalled() {
		return embeddingsAvailable() && modelsInstalled(modelsDirectory(this.#umbreld.dataDirectory))
	}

	// The models that read the library wait while the device has no memory to
	// spare. On one that never has any, that is for ever, and to whoever
	// expects their files to be found it looks like nothing: after a day of it
	// the owner is told, and told no longer once it is over.
	#memoryWatch?: ReturnType<typeof setInterval>
	#toldOfMemory = false

	async start() {
		this.#memoryWatch = setInterval(() => void this.#watchMemory().catch(() => {}), MEMORY_WATCH_MS)
		this.#memoryWatch.unref()
	}

	async stop() {
		clearInterval(this.#memoryWatch)
	}

	// Whether the models read the library so that it is found by what is in
	// it, and how far along each kind of work on it is. Off, they leave it
	// alone: what they have read stays and is still searched.
	async indexing(accountId: string): Promise<SearchIndexing> {
		return {
			enabled: (await this.#umbreld.store.get('settings.searchIndexing')) !== false,
			progress: await this.#umbreld.files.fileIndex.photosSearch(accountId, {type: 'progress'}),
		}
	}

	async setIndexing(enabled: boolean) {
		await this.#umbreld.store.set('settings.searchIndexing', enabled)
		this.#umbreld.files.fileIndex.setModelWork(enabled)
		// Nothing is waiting for memory that is not to read at all
		if (!enabled) await this.#watchMemory().catch(() => {})
		return enabled
	}

	async #watchMemory() {
		const {waitingForMemorySince, noRoomForModels} = await this.#umbreld.files.fileIndex.photosSearch(OWNER_USER_ID, {
			type: 'status',
		})
		await this.#tellOfRoom(noRoomForModels === true)
		if (!this.#modelsInstalled()) return
		const waited = waitingForMemorySince !== undefined && Date.now() - waitingForMemorySince >= MEMORY_WAIT_TO_TELL_MS
		if (waited && !this.#toldOfMemory) await this.#umbreld.notifications.add(WAITING_FOR_MEMORY_NOTIFICATION)
		// Cleared once the models are no longer kept from their work, whether or
		// not this umbreld raised it: one before it may have. Not for as long
		// as they are, which a restart of umbreld does not change.
		const kept = waitingForMemorySince !== undefined
		if (!kept && (await this.#umbreld.notifications.get()).includes(WAITING_FOR_MEMORY_NOTIFICATION)) {
			await this.#umbreld.notifications.clear(WAITING_FOR_MEMORY_NOTIFICATION)
		}
		this.#toldOfMemory = waited
	}

	// The models are not fetched onto a device that has no room for them (see
	// ../files/models.ts), and to its owner that looks like a search that
	// finds things by their names only. They are told why, once: whether they
	// have been is kept until the models are there.
	#roomUnsettled = true
	async #tellOfRoom(short: boolean) {
		const {store, notifications} = this.#umbreld
		// For as long as there is no room, and until that has been looked at once
		this.#roomUnsettled = short
		const told = (await store.get('searchToldOfNoRoomForModels')) === true
		if (short && !told) {
			await notifications.add(NO_ROOM_FOR_MODELS_NOTIFICATION)
			await store.set('searchToldOfNoRoomForModels', true)
		}
		if (!short && (await notifications.get()).includes(NO_ROOM_FOR_MODELS_NOTIFICATION)) {
			await notifications.clear(NO_ROOM_FOR_MODELS_NOTIFICATION)
		}
		if (told && this.#modelsInstalled()) await store.delete('searchToldOfNoRoomForModels')
	}

	async status(accountId: string): Promise<SearchStatus> {
		const nothing = {completed: 0, total: 0}
		if (!embeddingsAvailable()) return {available: false, reason: 'unsupported-device', indexing: nothing}
		// Someone searching is when it matters whether there is room for the
		// models, and when it is over that there was none
		if (!this.#modelsInstalled() || this.#roomUnsettled) void this.#watchMemory().catch(() => {})
		// Until the models have been fetched (see ../files/models.ts) there is nothing to ask
		if (!this.#modelsInstalled()) return {available: false, reason: 'starting', indexing: nothing}
		try {
			const {waitingForMemorySince, noRoomForModels, ...indexing} = await this.#umbreld.files.fileIndex.photosSearch(
				accountId,
				{type: 'status'},
			)
			const off = (await this.#umbreld.store.get('settings.searchIndexing')) === false
			return {available: true, indexing: {...indexing, ...(off ? {off} : {})}}
		} catch {
			return {available: false, reason: 'starting', indexing: nothing}
		}
	}

	#answers = new Map<string, {at: number; answer: Promise<Answer>}>()

	// A page of what a search finds, surest first: `limit` results from the
	// `cursor`th. The first page is always asked afresh. The pages after it
	// are of the answer the first was of, while that is kept.
	async query(
		accountId: string,
		query: string,
		{
			scope,
			limit,
			cursor = 0,
			filter,
			placeIds = [],
		}: {scope: SearchScope; limit: number; cursor?: number; filter?: PhotoFilter; placeIds?: string[]},
	): Promise<SearchResponse> {
		const {files} = this.#umbreld
		const key = JSON.stringify([accountId, query, scope, filter ?? null, placeIds])
		let kept = this.#answers.get(key)
		if (cursor === 0 || !kept || Date.now() - kept.at > ANSWER_KEPT_MS) {
			kept = {at: Date.now(), answer: this.#answer(accountId, query, {scope, filter, placeIds})}
			this.#answers.delete(key)
			this.#answers.set(key, kept)
			for (const old of [...this.#answers.keys()].slice(0, -ANSWERS_KEPT)) this.#answers.delete(old)
			// One that could not be worked out is not kept
			kept.answer.catch(() => this.#answers.get(key) === kept && this.#answers.delete(key))
		}
		const {understood, found} = await kept.answer
		// The index is derived state, never an authorization oracle: every file
		// it names is asked of Files as the one searching, unless Files itself
		// has just named it
		const page = await Promise.allSettled(
			found.slice(cursor, cursor + limit).map(async ({path, file, result}, index) => ({
				...this.#result({
					...result,
					file: file ?? (await files.status(await files.virtualToSystemPath(path, accountId), accountId)),
				}),
				// How far down the list a result is stands for how well it matched
				score: Number((1 - (cursor + index) / found.length).toFixed(4)),
			})),
		)
		return {
			understood,
			results: page.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
			total: found.length,
			...(cursor + limit < found.length ? {nextCursor: cursor + limit} : {}),
		}
	}

	// Everything a search finds, surest first.
	//
	// What was typed is read for filters first (see query.ts): what is left
	// is looked for among what fits them, and nowhere else, which is what
	// picking the same filters and typing the rest finds. A word may have been
	// read as a filter and meant as a word ("turkey dinner"): where nothing
	// fits, what was typed is looked for as it is.
	async #answer(
		accountId: string,
		query: string,
		{scope, filter, placeIds = []}: {scope: SearchScope; filter?: PhotoFilter; placeIds?: string[]},
	): Promise<Answer> {
		const words = typedWords(query)
		const typed = words.map(({text}) => text).join(' ')
		const view = {scope, filter, placeIds}
		const asTyped = async () => ({
			understood: {chips: [], text: typed},
			found: await this.#find(accountId, typed, view),
		})
		const read = await this.#read(accountId, words, view)
		if (!read) return asTyped()
		const understood = {chips: read.chips, text: read.text}
		const fitting = await this.#find(accountId, read.text, read.view)
		if (scope === 'photos') return fitting.length > 0 || !read.text ? {understood, found: fitting} : asTyped()
		// Anywhere else, what fits is found as well as what has the words (see
		// #read): the surer of the two for whatever is found both ways
		const pool = new Map<string, Answer['found'][number]>()
		for (const found of fitting) {
			// What fits is looked for in Photos: asked from Files, it is a file like any other
			const result = scope === 'files' ? {...found.result, photo: undefined} : found.result
			pool.set(found.path, {...found, result, strength: READ_SO})
		}
		for (const found of (await asTyped()).found) {
			const fits = pool.get(found.path)
			pool.set(found.path, fits ? {...found, strength: 1 - (1 - fits.strength) * (1 - found.strength)} : found)
		}
		return {
			understood,
			found: [...pool.values()].sort((first, second) => second.strength - first.strength).slice(0, MOST_RESULTS),
		}
	}

	// The filters what was typed says, with what is left to look for and the
	// view to look for it in: someone named, when, what kind of thing, and
	// where. Nothing where it says none.
	//
	// In Photos, where everything is a photo or a video, they are read from
	// among other words: "beach in thailand" is a beach, in Thailand. Anywhere
	// else what was typed may as well be what a file is called or says ("paris
	// itinerary", "invoice 2024"), so they are only read when they are all that
	// was typed, and then what fits them is found as well as what has the
	// words, not in its place.
	async #read(
		accountId: string,
		words: ReturnType<typeof typedWords>,
		{scope, filter, placeIds}: {scope: SearchScope; filter?: PhotoFilter; placeIds: string[]},
	) {
		const {fileIndex} = this.#umbreld.files
		const inPhotos = scope === 'photos'
		const people = await fileIndex.photosSearch(accountId, {type: 'people'}).catch(() => [])
		// What the view is narrowed by already is not read out of the words again
		const narrowed = {
			person: Boolean(filter?.personIds?.length),
			date: Boolean(filter?.dates?.length),
			kind: Boolean(filter?.kind || filter?.subKind),
		}
		const reads: Read[] = readWords(words, {now: Date.now(), people, narrowed})
		// Where, from the words nothing else was read from
		const open = words.flatMap(({quoted}, index) =>
			quoted || reads.some(({from, to}) => index >= from && index < to) ? [] : [index],
		)
		const place =
			placeIds.length > 0 || open.length === 0
				? undefined
				: await fileIndex
						.photosSearch(accountId, {type: 'place', text: open.map((index) => words[index]!.text).join(' ')})
						.catch(() => undefined)
		if (place) {
			const {led, rest} = place.words
			const [from, to] = [open[place.words.from]!, open[place.words.to - 1]! + 1]
			// Only where its words were typed together
			if (to - from === place.words.to - place.words.from) {
				const chip = {type: 'place' as const, label: place.label, placeId: place.id}
				reads.push({chip, from, to, named: led ? from + 1 : from, ...(rest ? {rest} : {})})
			}
		}
		if (reads.length === 0) return
		reads.sort((one, other) => one.from - other.from)
		const left = leftOf(words, reads)
		if (!inPhotos && left.length > 0) return
		const chips = reads.map((read) => ({...read.chip, asTyped: asTyped(words, reads, read)}))
		const fits: PhotoFilter = {}
		const places = [...placeIds]
		for (const {chip} of reads) {
			if (chip.type === 'person') fits.personIds = [...(fits.personIds ?? []), chip.personId]
			if (chip.type === 'date') fits.dates = [{from: chip.from, to: chip.to}]
			if (chip.type === 'kind' && (chip.kind === 'photo' || chip.kind === 'video')) fits.kind = chip.kind
			if (chip.type === 'subKind') fits.subKind = chip.subKind
			if (chip.type === 'place') places.push(chip.placeId)
		}
		return {
			chips,
			text: left.map(({text}) => text).join(' '),
			// What fits them is in Photos, wherever it is being looked for from
			view: {scope: 'photos' as const, filter: {...(inPhotos ? filter : {}), ...fits}, placeIds: places},
		}
	}

	// What is found for some text in a view, surest first: by what a file is
	// called, by what is in it, or with no text by what the view holds
	async #find(
		accountId: string,
		text: string,
		{scope, filter, placeIds = []}: {scope: SearchScope; filter?: PhotoFilter; placeIds?: string[]},
	): Promise<Answer['found']> {
		const {files} = this.#umbreld
		const limit = MOST_RESULTS
		const narrowed = placeIds.length > 0 || Object.values(filter ?? {}).some((value) => value !== undefined)
		if (!text && !narrowed) return []
		// What was typed as the model reads it. Without the model, or while it
		// cannot be asked, the words are still looked for as words.
		const embedding =
			text && this.#modelsInstalled()
				? await embedQuery(text).catch((error) => {
						this.logger.error('Failed to embed a search; looking for its words alone', error)
						return undefined
					})
				: undefined
		// What is said in Hindi is kept in the Latin letters its speakers type
		// it in, so what was typed in Devanagari is spelt the same way to find it
		const sounded =
			/\p{Script=Devanagari}/u.test(text) && this.#modelsInstalled()
				? await romanise(text).catch((error) => {
						this.logger.error('Failed to spell a search in Latin letters', error)
						return undefined
					})
				: undefined
		const [called, found] = await Promise.all([
			// Names are Files' own search to find. Photos finds its own by name.
			// What Files finds was not taken anywhere that it knows of.
			scope === 'photos' || placeIds.length > 0 || !text
				? []
				: files.search.search(text, MOST_NAMES, accountId).catch(() => [] as File[]),
			files.fileIndex.photosSearch(accountId, {
				type: 'query',
				text,
				embedding,
				sounded,
				scope,
				limit,
				filter,
				placeIds,
			}),
		])
		// What Files finds by name is kept when the name has what was typed, or
		// has it but for a slip of the fingers (see names.ts)
		const names = nameMatches(text, called)
		const byName = new Map<string, {file: File; name: number}>([
			...names.exact.map((file) => [file.path, {file, name: nameStrength(text, file.name) || NEAR}] as const),
			...names.near.map((file) => [file.path, {file, name: nameStrength(text, file.name, true)}] as const),
		])
		// One list, by how sure each is that it is what was meant (see hits.ts):
		// what a file is called and what is in it are reasons that add up. Each
		// is shown by the stronger of them.
		const pool = new Map<string, Answer['found'][number]>()
		for (const result of found) {
			if (pool.has(result.path)) continue
			const called = byName.get(result.path)
			const content = result.strength ?? result.hit?.strength ?? 0
			pool.set(result.path, {
				path: result.path,
				strength: 1 - (1 - (called?.name ?? 0)) * (1 - content),
				...(called ? {file: called.file} : {}),
				result: (called?.name ?? 0) > content ? {...result, hit: undefined} : result,
			})
		}
		for (const [path, {file, name}] of byName) {
			if (!pool.has(path)) pool.set(path, {path, strength: name, file, result: {path}})
		}
		return [...pool.values()].sort((first, second) => second.strength - first.strength).slice(0, MOST_RESULTS)
	}

	#result({file, hit, photo}: SearchFound & {file: File}): Omit<SearchResult, 'score'> {
		const what = kind(file.name)
		return {
			id: file.path,
			kind: what,
			match: hit?.match ?? 'name',
			file,
			...(photo ? {photo} : {}),
			...(hit?.snippet ? {snippet: hit.snippet} : {}),
			...(hit?.page === undefined ? {} : {page: hit.page}),
			...(hit?.atMs === undefined
				? {}
				: {
						moment: {
							startMs: hit.atMs,
							...(hit.endMs === undefined ? {} : {endMs: hit.endMs}),
							...(photo?.durationMs === undefined ? {} : {durationMs: photo.durationMs}),
							// Named by when the file last changed, so a changed file's still is another URL
							...(what === 'video'
								? {
										thumbnail: `/api/search/moment/${file.modified}.jpg?path=${encodeURIComponent(file.path)}&t=${hit.atMs}`,
									}
								: {}),
						},
					}),
		}
	}

	// What the models found in one file: by its path in Files, or by its id in Photos
	async insights(accountId: string, target: {path: string} | {photoId: string}): Promise<SearchInsights> {
		if (!embeddingsAvailable()) return {}
		// Asking Files where the path is also asks whether it is theirs to see
		if ('path' in target) await this.#umbreld.files.virtualToSystemPath(target.path, accountId)
		return this.#umbreld.files.fileIndex.photosSearch(accountId, {type: 'insights', ...target})
	}

	// A still of a video the one asking can open, at about `atMs` in, as a JPEG
	async moment(accountId: string, path: string, atMs: number) {
		if (!Number.isFinite(atMs) || atMs < 0 || photoKind(path) !== 'video') throw new Error('[moment-not-found]')
		// A page of results asks for a still of every video on it at once, so
		// each waits its turn. Files opens the video when that comes, and only
		// for one who may open it: what is read is the file that was opened,
		// whatever is put in its place meanwhile.
		return (await this.#stills.add(async () => {
			const video = await this.#umbreld.files.openFileForRead(path, accountId)
			try {
				return await videoStill(video.handle.fd, atMs, MOMENT_SIZE)
			} finally {
				await video.handle.close()
			}
		})) as Buffer
	}
}

function kind(name: string): SearchResultKind {
	return photoKind(name) ?? readableKind(name) ?? 'file'
}
