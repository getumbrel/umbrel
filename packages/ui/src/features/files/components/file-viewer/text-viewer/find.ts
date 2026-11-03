import {RegExpCursor} from '@codemirror/search'
import type {Text as Doc} from '@codemirror/state'

import {linesIn} from '@/features/files/components/file-viewer/shell/find'

export type Match = {from: number; to: number}

// Every match of the query in the text, ignoring case as every viewer's find does. A regular expression runs over each
// line at once, where a search cursor compares character by character through a lower-casing normaliser: tens of
// milliseconds for a 20 MB log rather than more than a second.
export function findMatches(doc: Doc, query: string): Match[] {
	const matches: Match[] = []
	const cursor = new RegExpCursor(doc, query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), {ignoreCase: true})
	while (!cursor.next().done) matches.push({from: cursor.value.from, to: cursor.value.to})
	return matches
}

// The rendered Markdown's text, a line per block (paragraph, heading, list item, cell, code block) and line break, so
// a match never runs on from one into the next
export const previewLines = (root: HTMLElement) => linesIn(root, 'p, h1, h2, h3, h4, h5, h6, li, td, th, pre')

// The first match from the top of the view down, or the first of all when every one is above it
export function firstInView(scroller: HTMLElement, ranges: Range[]) {
	const top = scroller.getBoundingClientRect().top
	return Math.max(
		0,
		ranges.findIndex((range) => range.getBoundingClientRect().bottom > top),
	)
}
