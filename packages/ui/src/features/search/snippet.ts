import type {SearchSnippetText} from './types'

export type SnippetSegment = {text: string; highlighted: boolean}

// How much text is kept either side of the first highlight: a few words. A
// snippet renders on one line that the layout cuts off at the end, so the
// match has to sit near the start to be seen at all, and what trails it only
// has to say what it was part of.
const LEAD = 28
const TAIL = 48

// A snippet as runs of plain and highlighted text, trimmed to a few words
// around its first highlight so a single line shows the match. Text cut from
// either end is replaced by an ellipsis, at a word boundary when one is near
// and never inside a character (an emoji is two code units). Whitespace (a
// document's line breaks) collapses to single spaces. A snippet with nothing
// highlighted is returned whole. The highlights are walked as Search sends
// them: in order, and inside the text (see SearchSnippet in umbreld).
export function snippetSegments(snippet: SearchSnippetText): SnippetSegment[] {
	const {text, highlights} = snippet
	const first = highlights[0]

	let start = 0
	let end = text.length
	if (first && first[0] > LEAD) {
		start = wholeCharacter(text, first[0] - LEAD)
		// Forward to the next word start, unless that would eat most of the lead
		const space = text.indexOf(' ', start)
		if (space !== -1 && space < first[0] - LEAD / 2) start = space + 1
	}
	if (first && text.length - first[1] > TAIL) {
		end = wholeCharacter(text, first[1] + TAIL)
		// A later highlight the cut would split is kept whole. Otherwise back to
		// the end of the last whole word, unless that gives up most of the tail.
		const split = highlights.find(([from, to]) => from < end && to > end)
		const space = text.lastIndexOf(' ', end)
		if (split) end = split[1]
		else if (space > first[1] + TAIL / 2) end = space
	}

	const segments: SnippetSegment[] = []
	const push = (from: number, to: number, highlighted: boolean) => {
		if (to <= from) return
		const piece = text.slice(from, to).replace(/\s+/g, ' ')
		const last = segments[segments.length - 1]
		if (last && last.highlighted === highlighted) last.text += piece
		else segments.push({text: piece, highlighted})
	}
	let cursor = start
	for (const [from, to] of highlights) {
		if (to <= cursor) continue
		if (from >= end) break
		push(cursor, Math.max(cursor, from), false)
		push(Math.max(cursor, from), to, true)
		cursor = to
	}
	push(cursor, end, false)

	if (segments.length === 0) return segments
	segments[0].text = segments[0].text.trimStart()
	const last = segments[segments.length - 1]
	last.text = last.text.trimEnd()
	// The opening cut is always short of the highlight, so what it leaves
	// first is plain text
	if (start > 0) segments[0].text = `…${segments[0].text}`
	if (end < text.length) {
		if (last.highlighted) segments.push({text: '…', highlighted: false})
		else last.text = `${last.text}…`
	}
	return segments.filter((segment) => segment.text.length > 0)
}

// Whether the snippet marks any of its text as the match. One that does not
// was found by what it means rather than by its words.
export function hasHighlight(snippet: SearchSnippetText) {
	return snippet.highlights.length > 0
}

// `index`, moved back off the second half of a surrogate pair: a cut there
// would leave half a character on each side of it
function wholeCharacter(text: string, index: number) {
	const unit = text.charCodeAt(index)
	const before = text.charCodeAt(index - 1)
	const splitsPair = unit >= 0xdc00 && unit <= 0xdfff && before >= 0xd800 && before <= 0xdbff
	return splitsPair ? index - 1 : index
}

// The words a snippet marks as the match, each once, longest first: what to
// look for when the same match is shown again in the whole text it came from
// (a photo's words in the inspector, a transcript), where the snippet's own
// ranges mean nothing.
export function snippetTerms(snippet: SearchSnippetText | undefined) {
	if (!snippet) return []
	const terms = new Set<string>()
	for (const [from, to] of snippet.highlights) {
		const term = snippet.text.slice(from, to).replace(/\s+/g, ' ').trim().toLocaleLowerCase()
		if (term) terms.add(term)
	}
	return [...terms].sort((a, b) => b.length - a.length)
}

// `text` as runs of plain and highlighted text, every occurrence of `terms`
// (see snippetTerms) highlighted, whatever its case and however its words are
// spaced: text read off a picture breaks lines where a snippet has spaces.
// The text itself comes back unchanged, line breaks and all.
export function markTerms(text: string, terms: readonly string[]): SnippetSegment[] {
	const patterns = terms.filter(Boolean).map((term) => term.split(' ').map(escapeRegExp).join('\\s+'))
	if (patterns.length === 0 || text === '') return text === '' ? [] : [{text, highlighted: false}]
	const segments: SnippetSegment[] = []
	let cursor = 0
	for (const match of text.matchAll(new RegExp(patterns.join('|'), 'giu'))) {
		if (match[0] === '') continue
		if (match.index > cursor) segments.push({text: text.slice(cursor, match.index), highlighted: false})
		segments.push({text: match[0], highlighted: true})
		cursor = match.index + match[0].length
	}
	if (cursor < text.length) segments.push({text: text.slice(cursor), highlighted: false})
	return segments
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
