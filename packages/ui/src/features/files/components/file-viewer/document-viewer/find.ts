import {useEffect, useRef, useState, type RefObject} from 'react'

import {
	countIn,
	firstFrom,
	highlight,
	linesIn,
	ordinal,
	pattern,
	rangesIn,
	reveal,
	stepFrom,
	type Line,
	type Match,
} from '@/features/files/components/file-viewer/shell/find'

// A line of the document's text, on a page
type PageLine = Line & {page: number}

// Typing changes the text in place: it's read again once typing pauses this long
const REREAD_MS = 300
// How far inside the view a match has to be to count as in view, clear of the find and zoom pills
const CLEAR = 64

// The pages' text in reading order. A page is its sheet, whose parts (header, columns, notes, footer, floating boxes)
// are placed absolutely, so they're read by where they sit, top to bottom and left to right.
export function linesOf(pages: HTMLElement[]): PageLine[] {
	return pages.flatMap((page, index) => {
		const parts = [...(page.firstElementChild?.children ?? [])] as HTMLElement[]
		parts.sort((a, b) => a.offsetTop - b.offsetTop || a.offsetLeft - b.offsetLeft)
		return parts.flatMap((part) => linesIn(part).map((line) => ({...line, page: index})))
	})
}

// Find in the document's text. The words are read from the pages when find opens (and again once the pages are laid
// out anew, or typing pauses), and a query is counted by matching strings. Matches on the pages on screen are
// highlighted with the CSS Custom Highlight API where the browser has it; either way, the match chosen is scrolled
// into view. The first one chosen is the first from the page in view.
export function useDocumentFind({
	pages,
	version,
	scrollerRef,
	page,
	shown: [first, last],
}: {
	pages: HTMLElement[]
	// Bumped when the text changes in place
	version: number
	scrollerRef: RefObject<HTMLElement | null>
	// The page in view, and the first and last on screen (indices)
	page: number
	shown: [number, number]
}) {
	const [open, setOpen] = useState(false)
	const [query, setQuery] = useState('')
	const [lines, setLines] = useState<PageLine[]>()
	// null until a match is chosen for the query: then the first one from the page in view
	const [selected, setSelected] = useState<Match | null>(null)
	// Bumped each time the user picks a match (by typing or stepping): that one is scrolled to once it's known, never
	// one that merely moved as the text changed
	const [asked, setAsked] = useState(0)
	const revealed = useRef(0)
	const read = useRef<HTMLElement[]>(undefined)

	useEffect(() => {
		if (!open) return
		// At once for pages not read yet; after typing, once it pauses
		const timer = setTimeout(
			() => {
				read.current = pages
				setLines(linesOf(pages))
			},
			read.current === pages ? REREAD_MS : 0,
		)
		return () => clearTimeout(timer)
	}, [open, pages, version])

	const regex = open ? pattern(query) : undefined
	const counts = lines && regex ? lines.map((line) => countIn(line.text, regex)) : []
	const total = counts.reduce((sum, count) => sum + count, 0)
	if (lines && regex && !selected) {
		const first = firstFrom(
			counts,
			Math.max(
				0,
				lines.findIndex((line) => line.page >= page),
			),
		)
		if (first) setSelected(first)
	}
	// An edit can take the chosen match away; stepping goes on from where it was
	const chosen = selected && selected.nth < (counts[selected.at] ?? 0) ? selected : null

	const [chosenLine, chosenNth] = chosen ? [chosen.at, chosen.nth] : [-1, -1]
	useEffect(() => {
		const regex = open ? pattern(query) : undefined
		if (!regex || !lines) return
		const current = chosenLine >= 0 ? rangesIn([lines[chosenLine]], regex)[chosenNth] : undefined
		if (revealed.current !== asked) {
			revealed.current = asked
			if (current && scrollerRef.current) reveal(scrollerRef.current, current, CLEAR)
		}
		// The pages on screen and one either side: a query matching thousands of times stays cheap
		const near = lines.filter((line) => line.page >= first - 1 && line.page <= last + 1)
		return highlight(rangesIn(near, regex), current)
	}, [open, query, lines, chosenLine, chosenNth, asked, first, last, scrollerRef])

	return {
		open,
		query,
		current: chosen ? ordinal(counts, chosen) : 0,
		total,
		searching: !!regex && !lines,
		match: () => (chosen && lines && regex ? rangesIn([lines[chosen.at]], regex)[chosen.nth] : undefined),
		show: () => setOpen(true),
		close: () => {
			setOpen(false)
			setQuery('')
			setSelected(null)
			setLines(undefined)
			read.current = undefined
		},
		search: (next: string) => {
			setQuery(next)
			setSelected(null)
			setAsked((count) => count + 1)
		},
		step: (direction: 1 | -1) => {
			if (!selected || !total) return
			const from = {at: selected.at, nth: Math.min(selected.nth, counts[selected.at] ?? 0)}
			setSelected(stepFrom(counts, from, direction))
			setAsked((count) => count + 1)
		},
	}
}
