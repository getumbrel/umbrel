import {existsSync, readFileSync} from 'node:fs'
import http from 'node:http'

// EmbeddingGemma 2 puts a picture and the words that describe it close
// together in one space, so a photo is found by embedding what was typed and
// looking for the pictures nearest to it.
//
// The model runs on the device in LiteRT-LM, as two services (the
// umbrel-embeddings units and server in packages/os): one with only the text
// half of the model that is always loaded, so a search is answered at once,
// and one that reads pictures, on the GPU where there is one. The second only
// runs while there are pictures to read: systemd starts it for the first one
// sent to its socket, and it exits once none have come for a while. Where
// LiteRT-LM isn't installed (a Raspberry Pi, a development environment)
// nothing is embedded and search goes by name alone.
const QUERY_SOCKET = '/run/umbrel-embeddings-query/embeddings.sock'
const INDEX_SOCKET = '/run/umbrel-embeddings-index/embeddings.sock'
// ... and a third, with the text half again, reads the passages of documents
// and of what is said in recordings, so that those are read without the
// model that reads pictures being loaded
const PASSAGES_SOCKET = '/run/umbrel-embeddings-passages/embeddings.sock'
// A third service, run the same way as the one that reads pictures, finds the
// faces in them for Photos' People (see findFaces)
const FACES_SOCKET = '/run/umbrel-embeddings-faces/faces.sock'
// ... a fourth reads the text in them (see readText)
const TEXT_SOCKET = '/run/umbrel-embeddings-text/text.sock'
// ... and a fifth writes down what is said in videos and recordings, on the
// CPU or on a GPU (see transcribe)
const SPEECH_SOCKET = '/run/umbrel-embeddings-speech/speech.sock'

// Embeddings are only comparable with others made the same way: a change of
// model, or of how many tokens it reads a picture as, needs a migration that
// queues every picture again.
const EMBEDDING_DIMENSIONS = 768
const FACE_EMBEDDING_DIMENSIONS = 512

// A picture is read in a second or two, and the first also waits for the
// model to load. But the models read beneath everything else on the device
// (see umbrelbackground.slice in packages/os), and on one whose apps keep
// every core busy they get the CPU a hundredth of the time: a read then takes
// minutes, and is not to be taken for one the model cannot do.
const INDEX_TIMEOUT_MS = 900_000
// Five minutes of sound takes a few-core CPU a minute or two in most
// languages, and a GPU seconds. This is for a slow CPU with everything else
// to do as well.
const SPEECH_TIMEOUT_MS = 900_000
// Someone is waiting for a search
const QUERY_TIMEOUT_MS = 10_000

// The model could not be asked. This says nothing about what it was asked.
export class EmbeddingsUnavailableError extends Error {}

// The model went away while it had the question, or gave no answer in time.
// Once says nothing: it is stopped when the device shuts down or is updated,
// and it reads beneath everything else on the device, which can keep it from
// the CPU. Every time for the same question, the question is what does it.
export class ModelWentAwayError extends EmbeddingsUnavailableError {}

export function embeddingsAvailable() {
	return existsSync('/opt/litert-lm') && cpuRunsModels()
}

// The runtimes stop as they load on a CPU without what they were built for:
// our LiteRT-LM needs AES-NI on x86 (see its build stage in packages/os), and
// Debian's ONNX Runtime stops on the Raspberry Pi 4, which lacks the Armv8
// cryptography extensions. The query service is kept from starting on these
// by the same test (see umbrel-embeddings-query.service in packages/os).
const NEEDED_CPU_FEATURES = ['aes']
let cpuFeaturesPresent: boolean | undefined
function cpuRunsModels() {
	if (cpuFeaturesPresent === undefined) {
		// Listed as "flags" on x86 and as "Features" on Arm
		const listed =
			readFileSync('/proc/cpuinfo', 'utf8')
				.match(/^(?:flags|Features)\s*:(.*)$/m)?.[1]!
				.split(/\s+/) ?? []
		cpuFeaturesPresent = NEEDED_CPU_FEATURES.every((feature) => listed.includes(feature))
	}
	return cpuFeaturesPresent
}

// What a picture shows, a byte per dimension: a quarter of the size of the
// floats the model returns. Each embedding is scaled so that its largest
// value fills the byte, which a few of its dimensions are far larger than the
// rest for. Measured on real photos, that moves a score by 0.0005 on average
// and never by more than 0.003.
export async function embedImage(image: Buffer, signal?: AbortSignal) {
	return stored(await embed(INDEX_SOCKET, '/embed/image', image, INDEX_TIMEOUT_MS, signal))
}

// Where the model that reads pictures reads: on a GPU, or on the CPU where
// the device has no GPU it can use or umbreld has it read there for want of
// memory (see server.py in packages/os)
export async function searchModelOn(signal?: AbortSignal) {
	const on = await ask(INDEX_SOCKET, '/on', '', INDEX_TIMEOUT_MS, signal)
	if (on !== 'gpu' && on !== 'cpu') throw new Error('Embedding model returned something other than where it reads')
	return on
}

function stored(embedding: Float32Array) {
	const scale = 127 / embedding.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0)
	return Int8Array.from(embedding, (value) => Math.round(value * scale))
}

// What a passage of a document, or a stretch of what is said in a recording,
// is about, stored the same way: in the form the model was trained to take
// what is searched, under the name of what it is from
//
// By the text half of the model alone, on the CPU, which gives the same
// embedding as the whole of it does. The model that reads pictures holds
// seven times the memory on a GPU that shares the device's (1.3 GB to 0.2 GB
// on an Intel N300), and is only loaded while there are pictures to read. A
// passage of 200 words took the N300 0.47 s this way and 0.14 s on its GPU.
export async function embedPassage(text: string, title: string, signal?: AbortSignal) {
	const prompt = `title: ${title || 'none'} | text: ${text}`
	return stored(await embed(PASSAGES_SOCKET, '/embed/text', prompt, INDEX_TIMEOUT_MS, signal))
}

// What is said in a stretch of sound (16 kHz, mono, 16-bit samples): each
// sentence with when it starts and ends, in milliseconds from the start of
// the sound. Written down on the CPU, on as many cores as background work
// has, or on a GPU, which takes a few seconds and one core. Asked for a GPU,
// the models answer with nothing where there is none they trust to write
// what the CPU would (see speech.py in packages/os).
//
// What is said in Hindi comes in the Latin letters its speakers type it in,
// with what the model wrote, in Devanagari, as `original` (see romanise).
export type SpokenSentence = {startMs: number; endMs: number; text: string; original?: string}

export async function transcribe(sound: Buffer, on: 'cpu', signal?: AbortSignal): Promise<SpokenSentence[]>
export async function transcribe(sound: Buffer, on: 'gpu', signal?: AbortSignal): Promise<SpokenSentence[] | undefined>
export async function transcribe(sound: Buffer, on: 'cpu' | 'gpu', signal?: AbortSignal) {
	const said = await ask(
		SPEECH_SOCKET,
		on === 'gpu' ? '/transcribe/gpu' : '/transcribe',
		sound,
		SPEECH_TIMEOUT_MS,
		signal,
	)
	if (said === null && on === 'gpu') return undefined
	if (!Array.isArray(said)) throw new Error('Speech models returned something other than speech')
	return said.map(({startMs, endMs, text, original}: Record<string, unknown>) => {
		if (typeof startMs !== 'number' || typeof endMs !== 'number' || typeof text !== 'string') {
			throw new Error('Speech models returned an invalid sentence')
		}
		return {startMs, endMs, text, ...(typeof original === 'string' ? {original} : {})}
	})
}

// What was typed in Devanagari, spelt in Latin letters the way speech in it
// is kept, so that it finds what was said. Asked of the service that reads
// queries, which is never busy with anything else.
export async function romanise(text: string, signal?: AbortSignal) {
	const spelt = await ask(QUERY_SOCKET, '/romanise', text, QUERY_TIMEOUT_MS, signal)
	if (typeof spelt !== 'string') throw new Error('Speech models returned something other than a spelling')
	return spelt
}

// The moments of a video the model looks at: one for every four seconds of
// its first four minutes, which is all there is of most videos, and one for
// every eight seconds after that, never more than 480, spread evenly over its
// whole length. Measured on labelled videos for an earlier version of search:
// a long video is found nearly as often with its frames that far apart as
// with twice as many, and far less often with them any further.
//
// Each moment is a stretch of the video. The frame read for it is the first
// that can be decoded on its own from a quarter of the way into the stretch,
// since the very start of a video is seldom what it shows, or the one in the
// middle of the stretch when it has none.
const VIDEO_FRAME_INTERVAL_MS = 4000
const VIDEO_CLOSE_FRAMES = 60
const VIDEO_LONG_FRAME_INTERVAL_MS = 8000
const VIDEO_MAX_FRAMES = 480

export type VideoMoment = {fromMs: number; middleMs: number; toMs: number}

export function videoMoments(durationMs: number): VideoMoment[] {
	const close = durationMs / VIDEO_FRAME_INTERVAL_MS
	const frames =
		close <= VIDEO_CLOSE_FRAMES
			? close
			: VIDEO_CLOSE_FRAMES + (durationMs - VIDEO_CLOSE_FRAMES * VIDEO_FRAME_INTERVAL_MS) / VIDEO_LONG_FRAME_INTERVAL_MS
	const count = Math.max(1, Math.min(VIDEO_MAX_FRAMES, Math.round(frames)))
	const stretch = durationMs / count
	return Array.from({length: count}, (_, index) => ({
		fromMs: Math.round((index + 0.25) * stretch),
		middleMs: Math.round((index + 0.5) * stretch),
		toMs: Math.round((index + 1) * stretch),
	}))
}

// The faces in a picture: where each is, as fractions of the picture from its
// top left, how sure the detector is that it is one, and an embedding that is
// close to those of the same person's other faces and far from everyone
// else's.
export type FoundFace = {
	box: {x: number; y: number; width: number; height: number}
	score: number
	embedding: Float32Array
}

export async function findFaces(image: Buffer, signal?: AbortSignal): Promise<FoundFace[]> {
	const faces = await ask(FACES_SOCKET, '/faces', image, INDEX_TIMEOUT_MS, signal)
	if (!Array.isArray(faces)) throw new Error('Face models returned something other than faces')
	return faces.map(({box, score, embedding}: {box: unknown; score: unknown; embedding: unknown}) => {
		if (!isEmbedding(box, 4) || typeof score !== 'number' || !isEmbedding(embedding, FACE_EMBEDDING_DIMENSIONS)) {
			throw new Error('Face models returned an invalid face')
		}
		const [x, y, width, height] = box
		return {box: {x, y, width, height}, score, embedding: Float32Array.from(embedding)}
	})
}

// The lines of text in a picture, each with where it is, as fractions of the
// picture from its top left
export type WrittenLine = {text: string; box: {x: number; y: number; width: number; height: number}}

export async function readText(image: Buffer, signal?: AbortSignal): Promise<WrittenLine[]> {
	const lines = await ask(TEXT_SOCKET, '/text', image, INDEX_TIMEOUT_MS, signal)
	if (!Array.isArray(lines)) throw new Error('Text models returned something other than lines')
	return lines.map(({text, box}: {text: unknown; box: unknown}) => {
		if (typeof text !== 'string' || !isEmbedding(box, 4)) throw new Error('Text models returned an invalid line')
		const [x, y, width, height] = box
		return {text, box: {x, y, width, height}}
	})
}

// What a search is looking for, in the form the model was trained to take queries
export function embedQuery(query: string, signal?: AbortSignal) {
	return embed(QUERY_SOCKET, '/embed/text', `task: search result | query: ${query}`, QUERY_TIMEOUT_MS, signal)
}

// Cosine similarity of a query and a stored embedding, whatever scale either is at
export function embeddingSimilarity(query: Float32Array, embedding: Int8Array) {
	if (embedding.length !== query.length) return 0
	let dot = 0
	let queryLength = 0
	let embeddingLength = 0
	for (let index = 0; index < query.length; index++) {
		dot += query[index] * embedding[index]
		queryLength += query[index] * query[index]
		embeddingLength += embedding[index] * embedding[index]
	}
	return dot / Math.sqrt(queryLength * embeddingLength) || 0
}

async function embed(socketPath: string, path: string, body: string | Buffer, timeoutMs: number, signal?: AbortSignal) {
	const embedding = await ask(socketPath, path, body, timeoutMs, signal)
	if (!isEmbedding(embedding, EMBEDDING_DIMENSIONS)) throw new Error('Embedding model returned an invalid embedding')
	return Float32Array.from(embedding)
}

const isEmbedding = (value: unknown, dimensions: number): value is number[] =>
	Array.isArray(value) && value.length === dimensions && value.every(Number.isFinite)

// What a model's server makes of what it is sent
async function ask(socketPath: string, path: string, body: string | Buffer, timeoutMs: number, signal?: AbortSignal) {
	const timeout = AbortSignal.timeout(timeoutMs)
	const response = await new Promise<{status: number; body: string}>((resolve, reject) => {
		const request = http.request(
			{
				socketPath,
				path,
				method: 'POST',
				headers: {'content-length': Buffer.byteLength(body)},
				signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
			},
			(response) => {
				const chunks: Buffer[] = []
				response.on('data', (chunk: Buffer) => chunks.push(chunk))
				response.on('error', reject)
				response.on('end', () => resolve({status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString()}))
			},
		)
		request.on('error', reject)
		request.end(body)
	}).catch((error) => {
		// Nobody is listening (not installed, failed, being restarted), or
		// whoever asked has stopped waiting: nothing to hold against what was sent
		const {code} = error as {code?: string}
		if (code === 'ENOENT' || code === 'ECONNREFUSED' || code === 'EACCES' || signal?.aborted) {
			throw new EmbeddingsUnavailableError(`Model is unavailable: ${(error as Error).message}`, {cause: error})
		}
		// It went away with the question in hand (stopped, or brought down by
		// what it was sent), or it is there and this took it too long
		const what = timeout.aborted
			? `gave no answer in ${timeoutMs / 1000} seconds`
			: `went away: ${(error as Error).message}`
		throw new ModelWentAwayError(`Model ${what}`, {cause: error})
	})
	// The model answered, so it is there: what it could not do is read this input
	if (response.status !== 200) {
		throw new Error(`Model could not read its input (${response.status}): ${response.body.slice(0, 200)}`)
	}
	return JSON.parse(response.body) as unknown
}
