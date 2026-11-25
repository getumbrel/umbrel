import {readFileSync} from 'node:fs'
import nodePath from 'node:path'

import {isAppleDouble} from '../photos/types.ts'
import {UNSPACED} from './unspaced.ts'

// The files, beside photos and videos, that the models read so that they can
// be found by what is in them (see embeddings.ts): documents by what they
// say, and recordings by what is said in them.
//
// Documents are what someone wrote to be read: laid-out ones, and prose in
// plain text and markup. Not data, code, logs or subtitles: a single export
// or project holds more of those than a lifetime of documents, and they are
// looked for by name.
const DOCUMENT_EXTENSIONS = new Set([
	...['.pdf', '.rtf'],
	// Office Open XML and OpenDocument: both are a ZIP of XML
	...['.docx', '.pptx', '.xlsx', '.odt', '.odp', '.ods'],
	...['.txt', '.md', '.markdown', '.html', '.htm', '.tex', '.rst', '.org'],
])
const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.oga', '.opus', '.wma', '.aiff'])

export type ReadableKind = 'document' | 'audio'

export function readableKind(name: string): ReadableKind | undefined {
	if (isAppleDouble(nodePath.basename(name))) return
	const extension = nodePath.extname(name).toLowerCase()
	if (DOCUMENT_EXTENSIONS.has(extension)) return 'document'
	if (AUDIO_EXTENSIONS.has(extension)) return 'audio'
}

// A document's text is embedded and shown a passage at a time: about this
// many words, ended early at a paragraph where there is one in its second
// half, and no more than this many passages of one document.
const PASSAGE_WORDS = 200
const MAX_PASSAGES = 200
// Text in a script written without spaces (see ./unspaced.ts) is not in words
// to count: a line of it is one, however long, and a passage of 200 of those
// was most of a document. It is counted by its characters, this many to a
// word, so a passage of it is 400 characters, about what 200 words say.
//
// On ten long articles in Chinese, Japanese and Thai, asked for by 300 of
// their own sentences, the article was found first 97% of the time and the
// passage with the sentence 75% (in the first three, 90%), where passages of
// 200 "words" found them 90% and 53% (86%). Passages of 150 characters found
// the sentence first more often still (86%), and the 200 kept of a document
// then hold less than half as much of a long one.
const UNSPACED_CHARACTERS_A_WORD = 2
// Where such text ends a sentence, with whatever closes a quotation after it
const UNSPACED_SENTENCE = /[^。？！!?]*[。？！!?]+[」』”’)）\]]*|[^。？！!?]+/gu
// A passage ends where its words run out or its page does, which can be in
// the middle of a sentence, and a sentence cut in two is found by what
// neither half means. So what is embedded of a passage that starts or ends
// inside a sentence has the rest of that sentence with it, from the passage
// before or after: up to this many words, and this many characters where
// words are not set apart by spaces.
//
// Not the usual overlap, where every passage is embedded with the end of the
// one before it. On 295 passages of six long documents, asked for by 236 of
// their own sentences, that found the sentences a passage cut in two first
// 94% of the time (84% with no overlap) and the ones it left whole 59% (71%):
// a passage's embedding is of all that is in it, and a seventh of every one
// was about something else. This found them 97% and 67%.
const SENTENCE_WORDS = 30
const SENTENCE_CHARACTERS = 300
// What ends a sentence in Latin, Greek and Cyrillic script, in Chinese and
// Japanese, Hindi, Arabic and Urdu. Thai marks the end of a sentence with a
// space, where it marks it at all: text that ends in Thai ends one.
const SENTENCE_END = /(?:[.?!。？！।؟۔]["'”’)\]]*|\p{Script=Thai})$/u

// The start of the sentence that a passage's end cuts short
function sentenceStart(text: string) {
	const words = text.split(' ')
	const before = words.findLastIndex((word, index) => index < words.length - 1 && SENTENCE_END.test(word))
	return words
		.slice(before + 1)
		.slice(-SENTENCE_WORDS)
		.join(' ')
		.slice(-SENTENCE_CHARACTERS)
}

// ... and the rest of it, at the start of the passage after
function sentenceRest(text: string) {
	const words = text.split(' ')
	const end = words.findIndex((word) => SENTENCE_END.test(word))
	return words
		.slice(0, end === -1 ? SENTENCE_WORDS : Math.min(end + 1, SENTENCE_WORDS))
		.join(' ')
		.slice(0, SENTENCE_CHARACTERS)
}

// The text of one page (or of a whole document that has none), as passages:
// `text` is what is kept and shown, `context` what is embedded
export function passages(pages: string[]) {
	const found: Array<{page: number; text: string}> = []
	// A page is gone through a word at a time, and no further than fills the
	// passages kept of a document: one can be a single paragraph as long as
	// whatever read it would write
	read: for (const [index, page] of pages.entries()) {
		let text = ''
		let words = 0
		// Whether that was the last passage there is room for
		const end = () => {
			if (text) found.push({page: index + 1, text})
			text = ''
			words = 0
			return found.length >= MAX_PASSAGES
		}
		for (const paragraph of paragraphs(page)) {
			for (const [word] of paragraph.matchAll(/\S+/g)) {
				let first = true
				for (const piece of pieces(word)) {
					// What would take a passage past its length starts the next
					if (words > 0 && words + piece.words > PASSAGE_WORDS && end()) break read
					// Words have a space between them, and the pieces of one have none
					text += (text && first ? ' ' : '') + piece.text
					words += piece.words
					first = false
					if (words >= PASSAGE_WORDS && end()) break read
				}
			}
			if (words >= PASSAGE_WORDS / 2 && end()) break read
		}
		if (end()) break
	}
	return found.map(({page, text}, index, all) => {
		const before = all[index - 1]?.text
		const after = all[index + 1]?.text
		const start = before !== undefined && !SENTENCE_END.test(before) ? sentenceStart(before) : ''
		const rest = after !== undefined && !SENTENCE_END.test(text) ? sentenceRest(after) : ''
		return {page, text, context: [start, text, rest].filter(Boolean).join(' ')}
	})
}

// A word as a passage counts it. One in a script written without spaces is
// the words its characters come to, and where it is longer than that it is
// taken a sentence at a time, and no more of one than a passage holds.
function* pieces(word: string) {
	if (!UNSPACED.test(word)) {
		yield {text: word, words: 1}
		return
	}
	const most = PASSAGE_WORDS * UNSPACED_CHARACTERS_A_WORD
	for (const [sentence] of word.matchAll(UNSPACED_SENTENCE)) {
		// By its characters, so that none is cut in two
		const characters = sentence.length > most ? [...sentence] : undefined
		for (let from = 0; from < (characters ?? sentence).length; from += most) {
			const text = characters ? characters.slice(from, from + most).join('') : sentence
			yield {text, words: Math.max(1, Math.round(text.length / UNSPACED_CHARACTERS_A_WORD))}
		}
	}
}

// The paragraphs of a page: what blank lines set apart
function* paragraphs(page: string) {
	const between = /\n\s*\n/g
	let from = 0
	for (let blank = between.exec(page); blank; blank = between.exec(page)) {
		yield page.slice(from, blank.index)
		from = between.lastIndex
	}
	yield page.slice(from)
}

// What is said in a recording comes a sentence at a time, which is how it is
// found by its words and shown. A sentence alone says too little to be found
// by what it means, so for that the sentences are taken as passages: the ones
// that follow each other, up to this many words or this long, and never
// across a silence longer than the last. No more passages than this of one
// recording. The numbers are the ones an earlier version of search settled on
// from a labelled library.
const SPOKEN_PASSAGE_WORDS = 70
const SPOKEN_PASSAGE_MS = 45_000
const SPOKEN_PASSAGE_SILENCE_MS = 10_000
const MAX_SPOKEN_PASSAGES = 240
// ... and one with fewer letters than this says too little even so
const SPOKEN_PASSAGE_LETTERS = 12

// The passages of what is said: each by the sentence it starts at, with all it says
export function spokenPassages(sentences: Array<{atMs: number; endMs: number; text: string}>) {
	const found: Array<{first: number; text: string}> = []
	let words = 0
	for (const [index, {atMs, text}] of sentences.entries()) {
		const passage = found.at(-1)
		const length = text.split(/\s+/).length
		if (
			!passage ||
			words + length > SPOKEN_PASSAGE_WORDS ||
			atMs - sentences[passage.first].atMs > SPOKEN_PASSAGE_MS ||
			atMs - sentences[index - 1].endMs > SPOKEN_PASSAGE_SILENCE_MS
		) {
			found.push({first: index, text})
			words = length
		} else {
			passage.text += ` ${text}`
			words += length
		}
	}
	return found
		.filter(({text}) => (text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= SPOKEN_PASSAGE_LETTERS)
		.slice(0, MAX_SPOKEN_PASSAGES)
}

// Takes the text out of an Office, OpenDocument, Rich Text or web document
// (see document-text.py), for Python in the sandbox
export const DOCUMENT_TEXT_SCRIPT = readFileSync(new URL('./document-text.py', import.meta.url), 'utf8')

// What a file of plain text says, in whichever of the ways text has been
// written to a file it is in: UTF-16 where its first bytes mark it as that,
// UTF-8, or failing that what Windows wrote before there was UTF-8. Nothing
// when it is not text at all.
export function plainText(bytes: Buffer) {
	if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
	if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
	// Text has no empty bytes in it
	if (bytes.includes(0)) return ''
	try {
		return new TextDecoder('utf-8', {fatal: true}).decode(bytes)
	} catch {
		// Unless it is only that the last character was cut short
		const whole = new TextDecoder('utf-8').decode(bytes)
		if (!whole.slice(0, -1).includes('\ufffd')) return whole
		return new TextDecoder('windows-1252').decode(bytes)
	}
}
