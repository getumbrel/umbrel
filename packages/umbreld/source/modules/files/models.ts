import {createHash} from 'node:crypto'
import {createReadStream, createWriteStream, readFileSync} from 'node:fs'
import {chmod, mkdir, readdir, rename, rm, stat, statfs, writeFile} from 'node:fs/promises'
import nodePath from 'node:path'
import {Readable} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import type {ReadableStream} from 'node:stream/web'

import {$} from 'execa'

import models from './models.json' with {type: 'json'}

// The models that read the library (see embeddings.ts) are not part of the OS
// image: together they are over two gigabytes, more than there is room
// for. A device fetches them from the download server the
// first time it has something for them to read, and keeps them with its data,
// through every update.
//
// models.json lists each file with the hash and size it must have and where
// its authors publish it, on its own or as a member of an archive:
//
//   embeddinggemma-2-*   EmbeddingGemma 2 as Google publishes it for
//                        LiteRT-LM: the text half alone, which reads search
//                        queries, and the text half with the half that reads
//                        images
//   faces-*              InsightFace's buffalo_l face detector and
//                        recogniser, out of the archive InsightFace releases
//                        them in. We use them under a commercial licence
//                        from InsightFace.
//   text-*               PP-OCRv6's tiny detector and small recogniser of
//                        text in pictures, as RapidOCR publishes them
//                        converted for ONNX Runtime
//   speech-*             What writes down speech: Silero VAD, which finds
//                        where someone is speaking, as its authors publish
//                        it; and Whisper tiny, which tells the language,
//                        Parakeet TDT 0.6b v3, which writes down 25 European
//                        languages, and Qwen3-ASR 0.6B, which writes the
//                        rest, as the transcribe.cpp project publishes them
//                        for its runtime
//   speech-romaniser*    AI4Bharat's IndicXlit, which spells what is said in
//                        Hindi in Latin letters: the checkpoint and the two
//                        dictionaries its authors publish
//
// The download server has each file at /models/<sha256>/<name>,
// which is the layout scripts/download-models makes. A file is asked for by its hash, so a
// model that is replaced never changes what a device on an older version is
// given, and what arrives is only kept when it has that hash.
export const MODELS: Array<{file: string; sha256: string; size: number}> = models

const DOWNLOAD_URL = 'https://download.umbrel.com/models'
// A VM under test is told to fetch from the machine running the test instead,
// as a system credential (see `vm.sh boot --credential`). Whatever it is told,
// only files with the hashes listed here are kept.
const DOWNLOAD_URL_CREDENTIAL = '/run/credentials/@system/umbrel.models-url'

// The services that load the models. The units name the directory below.
const SERVICES = ['index', 'passages', 'faces', 'text', 'speech'].map((name) => `umbrel-embeddings-${name}.service`)
const QUERY_SERVICE = 'umbrel-embeddings-query.service'

// Left in the directory once every file listed is there and is what it should
// be: which list that was. The units wait for it, and so does umbreld.
const INSTALLED_FILE = 'installed'
const INSTALLED = createHash('sha256')
	.update(MODELS.map(({file, sha256}) => `${sha256}  ${file}\n`).join(''))
	.digest('hex')

const FIRST_RETRY_MS = 60_000
const LONGEST_RETRY_MS = 60 * 60_000
// What a device is left with free, at the least, once the models are on it.
// One with less than that to spare has more need of the room than of what
// the models would find, and is left as it is.
const ROOM_TO_LEAVE_BYTES = 5 * 1024 ** 3

export function modelsDirectory(dataDirectory: string) {
	return nodePath.join(dataDirectory, 'models')
}

// Whether the models this version of umbrelOS uses are all there to be loaded
export function modelsInstalled(directory: string) {
	try {
		return readFileSync(nodePath.join(directory, INSTALLED_FILE), 'utf8').trim() === INSTALLED
	} catch {
		return false
	}
}

async function sha256(path: string, signal: AbortSignal) {
	const hash = createHash('sha256')
	await pipeline(createReadStream(path), hash, {signal})
	return hash.digest('hex')
}

type Logger = {log: (message: string) => void; error: (message: string, error?: unknown) => void}

// How much room is free where a directory is
async function freeBytes(directory: string) {
	const {bavail, bsize} = await statfs(directory)
	return bavail * bsize
}

export default class ModelDownloads {
	#directory: string
	#logger: Logger
	#onInstalled: () => void
	#free: typeof freeBytes
	#installing?: Promise<void>
	#failures = 0
	#retry?: ReturnType<typeof setTimeout>
	#abort = new AbortController()
	#shortOfRoom = false

	constructor({
		directory,
		logger,
		onInstalled,
		free = freeBytes,
	}: {
		directory: string
		logger: Logger
		onInstalled: () => void
		free?: typeof freeBytes
	}) {
		this.#directory = directory
		this.#logger = logger
		this.#onInstalled = onInstalled
		this.#free = free
	}

	installed() {
		return modelsInstalled(this.#directory)
	}

	// Whether the models were last left unfetched for want of room for them
	get shortOfRoom() {
		return this.#shortOfRoom
	}

	// Fetches whatever is missing, unless that is already under way or was
	// tried a moment ago. A device that cannot reach the download server tries
	// again after a minute, then twice as long each time, up to an hour.
	ensure() {
		if (this.#installing || this.#retry || this.#abort.signal.aborted || this.installed()) return
		this.#installing = this.#install()
			.then(() => {
				this.#failures = 0
				this.#logger.log('Models installed')
				this.#onInstalled()
			})
			.catch((error) => {
				if (this.#abort.signal.aborted) return
				const delay = Math.min(LONGEST_RETRY_MS, FIRST_RETRY_MS * 2 ** this.#failures++)
				this.#logger.error(`Failed to install models, trying again in ${Math.round(delay / 60_000)} minutes`, error)
				this.#retry = setTimeout(() => {
					this.#retry = undefined
					this.ensure()
				}, delay)
				this.#retry.unref()
			})
			.finally(() => (this.#installing = undefined))
	}

	async stop() {
		this.#abort.abort()
		clearTimeout(this.#retry)
		this.#retry = undefined
		await this.#installing
		// To be asked again after a restart
		this.#abort = new AbortController()
	}

	async #install() {
		await mkdir(this.#directory, {recursive: true, mode: 0o755})
		// Nothing is fetched that would leave the device short of room: what
		// is not here yet has to fit with room to spare
		let missing = 0
		for (const {file, size} of MODELS) {
			const path = nodePath.join(this.#directory, file)
			if ((await stat(path).catch(() => undefined))?.size === size) continue
			const partial = (await stat(`${path}.partial`).catch(() => undefined))?.size ?? 0
			missing += partial > size ? size : size - partial
		}
		const free = await this.#free(this.#directory)
		this.#shortOfRoom = free < missing + ROOM_TO_LEAVE_BYTES
		if (this.#shortOfRoom) {
			const megabytes = (bytes: number) => Math.round(bytes / 1024 ** 2)
			throw new Error(`No room for the models: ${megabytes(missing)} MB to fetch and ${megabytes(free)} MB free`)
		}
		await rm(nodePath.join(this.#directory, INSTALLED_FILE), {force: true})
		let url = DOWNLOAD_URL
		try {
			url = readFileSync(DOWNLOAD_URL_CREDENTIAL, 'utf8').trim() || url
		} catch {}
		this.#logger.log(`Installing models from ${url}`)
		for (const model of MODELS) await this.#fetch(url, model)
		// What an earlier version used and this one doesn't
		for (const name of await readdir(this.#directory)) {
			if (!MODELS.some(({file}) => file.split('/')[0] === name)) {
				await rm(nodePath.join(this.#directory, name), {recursive: true})
			}
		}
		await writeFile(nodePath.join(this.#directory, `${INSTALLED_FILE}.partial`), `${INSTALLED}\n`)
		await rename(
			nodePath.join(this.#directory, `${INSTALLED_FILE}.partial`),
			nodePath.join(this.#directory, INSTALLED_FILE),
		)
		// A service that loaded a model this replaced still has the old one. The
		// one that reads queries is kept loaded, so it is started now.
		await $`systemctl try-restart ${SERVICES}`.catch(() => {})
		await $`systemctl restart ${QUERY_SERVICE}`.catch((error) => {
			this.#logger.error('Failed to start the model that reads search queries', error)
		})
	}

	// One model: left alone when it is already what it should be, and carried
	// on with from where it stopped when part of it is here
	async #fetch(url: string, {file, sha256: expected, size}: (typeof MODELS)[number]) {
		const path = nodePath.join(this.#directory, file)
		const {signal} = this.#abort
		if ((await stat(path).catch(() => undefined))?.size === size && (await sha256(path, signal)) === expected) return
		const partial = `${path}.partial`
		await mkdir(nodePath.dirname(path), {recursive: true, mode: 0o755})
		let have = (await stat(partial).catch(() => undefined))?.size ?? 0
		if (have > size) have = 0
		if (have < size) {
			const response = await fetch(`${url}/${expected}/${nodePath.basename(file)}`, {
				headers: have > 0 ? {range: `bytes=${have}-`} : {},
				signal,
			})
			// The whole file, whatever part of it was asked for
			if (response.status === 200) have = 0
			else if (response.status !== 206) throw new Error(`The download server answered ${response.status} for ${file}`)
			let arrived = have
			await pipeline(
				Readable.fromWeb(response.body as ReadableStream),
				// No more of it than the file is, whatever is sent
				async function* (chunks: AsyncIterable<Buffer>) {
					for await (const chunk of chunks) {
						arrived += chunk.length
						if (arrived > size) throw new Error(`${file} is larger than it should be`)
						yield chunk
					}
				},
				createWriteStream(partial, {flags: have > 0 ? 'a' : 'w'}),
				{signal},
			)
		}
		if ((await sha256(partial, signal)) !== expected) {
			await rm(partial)
			throw new Error(`${file} is not the file it should be`)
		}
		// Whoever umbreld runs as, the services that load it can read it
		await chmod(partial, 0o644)
		await rename(partial, path)
	}
}
