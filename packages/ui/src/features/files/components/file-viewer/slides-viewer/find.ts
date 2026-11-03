import {useEffect, useRef, useState} from 'react'

import {
	countIn,
	firstFrom,
	highlight,
	linesIn,
	ordinal,
	pattern,
	rangesIn,
	stepFrom,
	type Match,
} from '@/features/files/components/file-viewer/shell/find'
import type {Presentation} from '@/features/files/components/file-viewer/slides-viewer/engine'

// Find across every slide's text. The words are read the first time find opens, each slide drawn off the page, a
// few at a time and starting from the one on stage, so a long deck never holds the page up. The slide on stage gets
// its matches highlighted, and choosing a match on another slide goes there.
export function useSlideFind({
	deck,
	slide,
	drawn,
	setSlide,
}: {
	deck: Presentation
	slide: number
	// The slide on stage as drawn, once it is
	drawn: HTMLElement | undefined
	setSlide: (index: number) => void
}) {
	const [open, setOpen] = useState(false)
	const [query, setQuery] = useState('')
	const [texts, setTexts] = useState<Array<string[] | undefined>>(() => Array(deck.slideCount).fill(undefined))
	// null until a match is chosen for the query: as matches come in, the first one from the slide on stage
	const [selected, setSelected] = useState<Match | null>(null)
	const from = useRef(slide)
	const reading = texts.includes(undefined)

	useEffect(() => {
		if (!open || !reading) return
		let timer: ReturnType<typeof setTimeout>
		let step = 0
		const read = () => {
			const started = performance.now()
			const batch = new Map<number, string[]>()
			for (; step < deck.slideCount && performance.now() - started < 12; step++) {
				const index = (from.current + step) % deck.slideCount
				batch.set(
					index,
					linesIn(deck.renderSlide(index)).map((line) => line.text),
				)
			}
			setTexts((texts) => texts.map((lines, index) => lines ?? batch.get(index)))
			if (step < deck.slideCount) timer = setTimeout(read)
		}
		read()
		return () => clearTimeout(timer)
	}, [open, reading, deck])

	const regex = open ? pattern(query) : undefined
	const counts = texts.map((lines) => (lines && regex ? lines.reduce((sum, text) => sum + countIn(text, regex), 0) : 0))
	const total = counts.reduce((sum, count) => sum + count, 0)
	if (regex && !selected) {
		const first = firstFrom(counts, slide)
		if (first) {
			setSelected(first)
			setSlide(first.at)
		}
	}
	// An edit can take the chosen match away; stepping goes on from where it was
	const chosen = selected && selected.nth < counts[selected.at] ? selected : null

	const lines = texts[slide]
	const [chosenSlide, chosenNth] = chosen ? [chosen.at, chosen.nth] : [-1, -1]
	useEffect(() => {
		const regex = open ? pattern(query) : undefined
		if (!regex || !drawn) return
		const ranges = rangesIn(linesIn(drawn), regex)
		return highlight(ranges, chosenSlide === slide ? ranges[chosenNth] : undefined)
		// The slide's lines: an edit there is highlighted afresh
	}, [open, query, drawn, slide, chosenSlide, chosenNth, lines])

	return {
		open,
		query,
		current: chosen ? ordinal(counts, chosen) : 0,
		total,
		searching: reading && !!regex,
		show: () => {
			if (!open) from.current = slide
			setOpen(true)
		},
		close: () => {
			setOpen(false)
			setQuery('')
			setSelected(null)
		},
		search: (next: string) => {
			setQuery(next)
			setSelected(null)
		},
		step: (direction: 1 | -1) => {
			if (!selected || !total) return
			const next = stepFrom(counts, {at: selected.at, nth: Math.min(selected.nth, counts[selected.at])}, direction)
			setSelected(next)
			setSlide(next.at)
		},
		// The slide on stage was edited: its words are read again from what's there now
		refresh: (index: number, element: HTMLElement) => {
			if (!texts[index]) return
			const read = linesIn(element).map((line) => line.text)
			setTexts((texts) => texts.map((lines, at) => (at === index ? read : lines)))
		},
	}
}
