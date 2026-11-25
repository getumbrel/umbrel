import {useEffect, useMemo, useState, useSyncExternalStore} from 'react'

import type {TranscriptLine} from '@/features/search/transcript'

// A video's transcript shown over the picture as it plays. Search keeps
// one timed entry per sentence, and a sentence can run long, so each is cut
// into cues a viewer can read at a glance: at most two lines of about 42
// characters, which is what subtitling keeps to. The cue is cut at the last
// pause in the words where one is near, so it ends where speech would breathe.
// Search times sentences, not words, so a piece's time is shared out the way
// wordsSaid does it: evenly through the sentence, by how many letters each
// word has.

export type CaptionCue = {startMs: number; endMs: number; text: string}

// Widths are counted in Latin letters: a character of a script set in
// squares (Chinese, Japanese, Korean) takes about two
const LINE_WIDTH = 42
// Two lines
const CUE_WIDTH = 2 * LINE_WIDTH
// A cue narrower than this is cut at a pause only when nothing wider fits
const MIN_CUT_WIDTH = 36
// The last of a sentence's cues is not left narrower than this: about a
// second of speech, which is as short as a cue can be and still be read
const MIN_LAST_WIDTH = 18
const WIDE = /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/
const PAUSE = /[,;:.!?…—)，。！？、；：）」』]$/
// Marks that close what comes before them: never the start of a line
const CLOSING = /^[，。！？、；：）」』,.;:!?…)]+$/u
const BINDS_FORWARD = new Set(
	'a an the to of in on at for and or but with from by my your our his her their its this that'.split(' '),
)

const width = (text: string) => Array.from(text).reduce((sum, char) => sum + (WIDE.test(char) ? 2 : 1), 0)

// The places a line may break: between words, and in a script written
// without spaces, between characters (a closing mark stays with the one
// before it). `spaced` is whether a space comes before it.
type Token = {text: string; spaced: boolean}

function tokenize(text: string): Token[] {
	const tokens: Token[] = []
	for (const word of text.trim().split(/\s+/).filter(Boolean)) {
		let spaced = tokens.length > 0
		let run = ''
		const flush = () => {
			if (!run) return
			tokens.push({text: run, spaced})
			spaced = false
			run = ''
		}
		for (const char of Array.from(word)) {
			if (WIDE.test(char) && !CLOSING.test(char)) {
				flush()
				run = char
				flush()
			} else if (CLOSING.test(char) && !run && tokens.length > 0 && !spaced) {
				tokens[tokens.length - 1]!.text += char
			} else {
				// Latin within a run of wide characters starts a token of its own
				if (run && WIDE.test(run.at(-1)!)) flush()
				run += char
			}
		}
		flush()
	}
	return tokens
}

const join = (tokens: readonly Token[]) =>
	tokens.map((token, index) => (index > 0 && token.spaced ? ' ' : '') + token.text).join('')

export function captionCues(transcript: readonly TranscriptLine[]): CaptionCue[] {
	const cues: CaptionCue[] = []
	for (const line of transcript) {
		const tokens = tokenize(line.text)
		if (tokens.length === 0) continue
		const endMs = Math.max(line.startMs, line.endMs)
		// A word has a breath after it, as in wordsSaid; a character of a
		// script without spaces doesn't
		const weight = (piece: readonly Token[]) =>
			piece.reduce((sum, token) => sum + width(token.text) + (WIDE.test(token.text) ? 0 : 1), 0)
		const total = weight(tokens)
		let before = 0
		for (const piece of cut(tokens)) {
			const startMs = line.startMs + Math.round(((endMs - line.startMs) * before) / total)
			before += weight(piece)
			cues.push({
				startMs,
				endMs: line.startMs + Math.round(((endMs - line.startMs) * before) / total),
				text: balanced(piece),
			})
		}
	}
	return cues
}

// A cue too wide for one line is set as two of about the same width,
// breaking where the words are nearest the middle, the lower line the wider
// when they can't be even: left to wrap, the second line is often a single
// word under a full one, which reads as an afterthought.
function balanced(tokens: readonly Token[]) {
	const text = join(tokens)
	if (width(text) <= LINE_WIDTH || tokens.length < 2) return text
	const at = evenBreak(tokens)
	return `${join(tokens.slice(0, at))}\n${join(leading(tokens.slice(at)))}`
}

// Where words break most evenly in two. Even is best; a wider second half is
// preferred over a wider first, a break at a pause over one inside a phrase,
// and never one between a little word and the word it belongs to
// ("the | waves").
function evenBreak(tokens: readonly Token[]) {
	let best = 1
	let bestScore = Infinity
	for (let at = 1; at < tokens.length; at++) {
		const upper = width(join(tokens.slice(0, at)))
		const lower = width(join(tokens.slice(at)))
		const last = tokens[at - 1]!.text
		const score =
			Math.abs(lower - upper) +
			(upper > lower ? 1 : 0) +
			(PAUSE.test(last) ? -4 : 0) +
			(BINDS_FORWARD.has(last.toLowerCase()) ? 8 : 0)
		if (score < bestScore) {
			best = at
			bestScore = score
		}
	}
	return best
}

// Words that begin a line or a cue, which no space comes before
const leading = (tokens: readonly Token[]) =>
	tokens.map((token, index) => (index === 0 ? {...token, spaced: false} : token))

// A sentence too long for one cue is cut into cues that fit: back to the
// last pause where one leaves enough to be worth a cue, else as much as
// fits, short of a little word that belongs with the next one. Where that
// would leave the sentence's last word or two a cue to themselves, on screen
// for an instant, the last two cues share what is left evenly instead.
function cut(tokens: readonly Token[]): Token[][] {
	const pieces: Token[][] = []
	let rest = tokens
	while (rest.length > 0) {
		if (width(join(rest)) <= CUE_WIDTH) {
			pieces.push([...rest])
			break
		}
		// As many as fit; one wider than a whole cue goes alone
		let fit = 1
		while (fit < rest.length && width(join(rest.slice(0, fit + 1))) <= CUE_WIDTH) fit++
		let at = fit
		for (let back = fit; back > 1; back--) {
			const upTo = width(join(rest.slice(0, back)))
			if (upTo < MIN_CUT_WIDTH) break
			if (PAUSE.test(rest[back - 1]!.text)) {
				at = back
				break
			}
		}
		if (at === fit && fit > 1 && BINDS_FORWARD.has(rest[fit - 1]!.text.toLowerCase())) at = fit - 1
		if (width(join(rest.slice(at))) < MIN_LAST_WIDTH) {
			const even = evenBreak(rest)
			if (width(join(rest.slice(0, even))) <= CUE_WIDTH && width(join(rest.slice(even))) <= CUE_WIDTH) at = even
		}
		pieces.push(rest.slice(0, at))
		rest = leading(rest.slice(at))
	}
	return pieces
}

function timestamp(ms: number) {
	const whole = Math.max(0, Math.round(ms))
	const pad = (value: number, size = 2) => String(value).padStart(size, '0')
	return `${pad(Math.floor(whole / 3_600_000))}:${pad(Math.floor(whole / 60_000) % 60)}:${pad(Math.floor(whole / 1000) % 60)}.${pad(whole % 1000, 3)}`
}

// The cues as a WebVTT file, the form a <track> reads. Text is escaped:
// a transcript is what someone said, never markup.
export function captionsVtt(cues: readonly CaptionCue[]) {
	const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
	return [
		'WEBVTT',
		...cues.map((cue) => `${timestamp(cue.startMs)} --> ${timestamp(cue.endMs)}\n${escape(cue.text)}`),
	].join('\n\n')
}

// The transcript as a file a <track> can load, for as long as it is shown
export function useCaptionsUrl(transcript: readonly TranscriptLine[] | undefined) {
	const vtt = useMemo(() => {
		const cues = transcript ? captionCues(transcript) : []
		return cues.length > 0 ? captionsVtt(cues) : undefined
	}, [transcript])
	const [url, setUrl] = useState<string>()
	useEffect(() => {
		if (!vtt) return setUrl(undefined)
		const made = URL.createObjectURL(new Blob([vtt], {type: 'text/vtt'}))
		setUrl(made)
		return () => URL.revokeObjectURL(made)
	}, [vtt])
	return url
}

// Whether captions are on is the viewer's choice, not the video's: turned off
// for one, they stay off for the next, in Files and Photos alike, until turned
// on again. On until then: a transcript that is there is worth showing.
const CAPTIONS_KEY = 'umbrel-captions'
const listeners = new Set<() => void>()

function readCaptions() {
	try {
		return localStorage.getItem(CAPTIONS_KEY) !== 'off'
	} catch {
		return true
	}
}

let captionsOn = readCaptions()

export function setCaptionsOn(on: boolean) {
	if (on === captionsOn) return
	captionsOn = on
	try {
		localStorage.setItem(CAPTIONS_KEY, on ? 'on' : 'off')
	} catch {
		// Not kept, then; it still holds for this session
	}
	listeners.forEach((listener) => listener())
}

export function useCaptionsOn() {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
		() => captionsOn,
	)
}
