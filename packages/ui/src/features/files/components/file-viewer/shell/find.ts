import '@/features/files/components/file-viewer/shell/find.css'

// Find for the viewers that search text they drew themselves (documents, slides): the text is read into lines, a
// query is counted by matching strings, and matches are shown with the CSS Custom Highlight API

// A run of text that can hold a match, and the text nodes it's made of
export type Line = {text: string; nodes: Text[]}
// A match is known by the run of matches it's in (a line, a slide) and its place among them, so it stays the same
// match while matches elsewhere come and go
export type Match = {at: number; nth: number}

const HIGHLIGHTS = typeof CSS !== 'undefined' && 'highlights' in CSS

// The text under `root`, line by line in drawing order: a line is the text under one block up to a line break, so a
// match never runs on from one paragraph, cell or line into the next. Blocks are divs as the engines draw them, or what
// `blocks` selects in other markup. Hidden text isn't read.
export function linesIn(root: Node, blocks = 'div'): Line[] {
	const lines: Line[] = []
	let line: Line | undefined
	let owner: Element | null = null
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
		acceptNode: (node) =>
			node instanceof HTMLElement && node.style.display === 'none'
				? NodeFilter.FILTER_REJECT
				: NodeFilter.FILTER_ACCEPT,
	})
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (node instanceof HTMLBRElement) line = undefined
		if (!(node instanceof Text) || !node.data) continue
		const block = node.parentElement?.closest(blocks) ?? null
		if (!line || block !== owner) lines.push((line = {text: '', nodes: []}))
		owner = block
		line.text += node.data
		line.nodes.push(node)
	}
	return lines
}

// Case-insensitive, and a space in the query matches any run of white space (a tab between words, say)
export function pattern(query: string): RegExp | undefined {
	if (!query.trim()) return undefined
	return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'giu')
}

export const countIn = (text: string, regex: RegExp) => text.match(regex)?.length ?? 0

// The text between two offsets of a line. A line read a moment ago is measured over its nodes as they are now, so a
// match that typing has moved is off by as much until the line is read again, never out of bounds.
export function rangeIn(line: Line, start: number, end: number): Range {
	const range = document.createRange()
	let at = 0
	for (const node of line.nodes) {
		const next = at + node.length
		if (start >= at && start < next) range.setStart(node, start - at)
		if (end > at && end <= next) {
			range.setEnd(node, end - at)
			break
		}
		at = next
	}
	return range
}

// The matches in some lines, as ranges in the order they're counted
export const rangesIn = (lines: Line[], regex: RegExp) =>
	lines.flatMap((line) =>
		[...line.text.matchAll(regex)].map((match) => rangeIn(line, match.index, match.index + match[0].length)),
	)

// The first match from run `from` on, wrapping round to the start
export function firstFrom(counts: number[], from: number): Match | undefined {
	for (let step = 0; step < counts.length; step++) {
		const at = (from + step) % counts.length
		if (counts[at]) return {at, nth: 0}
	}
	return undefined
}

export function stepFrom(counts: number[], from: Match, direction: 1 | -1): Match {
	const nth = from.nth + direction
	if (nth >= 0 && nth < counts[from.at]) return {at: from.at, nth}
	for (let step = 1; step <= counts.length; step++) {
		const at = (((from.at + direction * step) % counts.length) + counts.length) % counts.length
		if (counts[at]) return {at, nth: direction > 0 ? 0 : counts[at] - 1}
	}
	return from
}

// Its number among all the matches, from 1
export const ordinal = (counts: number[], match: Match) =>
	counts.slice(0, match.at).reduce((sum, count) => sum + count, 0) + match.nth + 1

// Brings a match into view: into the middle of `scroller` unless it's there already, `clear` px inside its top and
// bottom edges (where pills float), and first into view in any sideways scroller between them (a long code block)
export function reveal(scroller: HTMLElement, range: Range, clear = 0) {
	const centre = (element: HTMLElement, vertically: boolean) => {
		const rect = range.getBoundingClientRect()
		const view = element.getBoundingClientRect()
		if (vertically && (rect.top < view.top + clear || rect.bottom > view.bottom - clear))
			element.scrollTop += (rect.top + rect.bottom - view.top - view.bottom) / 2
		if (rect.left < view.left || rect.right > view.right)
			element.scrollLeft += (rect.left + rect.right - view.left - view.right) / 2
	}
	for (
		let element = range.startContainer.parentElement;
		element && element !== scroller;
		element = element.parentElement
	)
		if (element.scrollWidth > element.clientWidth && /auto|scroll/.test(getComputedStyle(element).overflowX))
			centre(element, false)
	centre(scroller, true)
}

// Shows matches, the current one deeper, until the function returned clears them (where the browser can show them)
export function highlight(ranges: Range[], current: Range | undefined): (() => void) | undefined {
	if (!HIGHLIGHTS) return undefined
	const all = new Highlight()
	for (const range of ranges) all.add(range)
	CSS.highlights.set('umbrel-find', all)
	if (current) CSS.highlights.set('umbrel-find-current', new Highlight(current))
	return () => {
		CSS.highlights.delete('umbrel-find')
		CSS.highlights.delete('umbrel-find-current')
	}
}
