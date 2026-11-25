import {animate, useReducedMotion} from 'motion/react'
import {memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent} from 'react'
import {useTranslation} from 'react-i18next'

import {cn} from '@/lib/utils'

import {markTerms} from './snippet'
import {activeLine, clickSelectedText, lyricRows, transcriptKey, wordsSaid, type TranscriptLine} from './transcript'

// How the view sits where it is shown. The audio island has room: large type
// at a reading position a fifth of the way down. The Photos inspector's card
// is a few lines tall: smaller type, the spoken line higher, softer blur
// (`.lyrics[data-variant]` in index.css).
const VARIANTS = {
	island: {reading: 0.22},
	card: {reading: 0.14},
} as const
// A transcript this short is shown whole, without following: there is
// nothing to scroll to
const FITS_LINES = 3
// How long the reader has the scroll after touching it before the view goes
// back to following
const BROWSE_MS = 4000
// The scroll that carries a new line to the reading position: quick off the
// mark, settling without a bounce
const FOLLOW = {type: 'spring', stiffness: 170, damping: 26, mass: 1} as const
const NO_TERMS: readonly string[] = []

// What is said in a recording or a video, followed as it plays: the line
// being spoken bright and sharp at a fixed place, the rest dimmed and
// softened the more the further they are from it, the list gliding up as
// playback moves on. A line is a place in the media — a click plays from it.
// The moment the reader scrolls, the view is theirs: everything sharpens to
// be read and nothing moves until they have left it alone for a few seconds,
// or ask to be taken back. A long silence is shown as one, three dots
// breathing where the next line will be said, rather than as the last line
// still lit. Before anything plays, the view rests on the first line a
// search matched, if one did.
//
// Search times sentences, not words, so a whole line lights at once. Within
// it the words brighten at an even pace across the line's span (see
// wordsSaid): an estimate, and drawn as one — a small lift from already
// bright to white, never a hard karaoke edge that would claim a precision
// the timing does not have.
//
// Nothing here renders per frame. React renders when the line changes, and
// only the rows whose look changed; the frame loop only reads the clock and,
// when a word boundary passes, flips an attribute on that one line's words.
// Blur is a filter on the few lines near the spoken one; the rest are only
// dimmed, and skipped by layout until scrolled to.
export function TranscriptView({
	transcript,
	media,
	matched = NO_TERMS,
	variant,
	className,
}: {
	transcript: readonly TranscriptLine[]
	// The player it follows, once there is one
	media: HTMLMediaElement | null
	// The words a search found the media by, marked where they are said
	matched?: readonly string[]
	variant: keyof typeof VARIANTS
	className?: string
}) {
	const {t} = useTranslation()
	const reduceMotion = useReducedMotion() ?? false
	const rows = useMemo(() => lyricRows(transcript), [transcript])
	// Each line as its words, and which of them a search matched
	const lines = useMemo(
		() =>
			transcript.map((line) =>
				markTerms(line.text, matched).flatMap((segment) =>
					segment.text
						.split(/(\s+)/)
						.filter(Boolean)
						.map((text) => ({text, space: /^\s+$/.test(text), matched: segment.highlighted})),
				),
			),
		[transcript, matched],
	)
	// Where the view rests before anything has been said: the first matched line
	const anchor = useMemo(() => {
		const line = lines.findIndex((words) => words.some((word) => word.matched))
		return line === -1 ? 0 : rows.findIndex((row) => row.type === 'line' && row.line === line)
	}, [lines, rows])
	const fits = variant === 'card' && transcript.length <= FITS_LINES
	const scrollerRef = useRef<HTMLDivElement>(null)
	const [active, setActive] = useState(() => activeLine(rows, (media?.currentTime ?? 0) * 1000))
	const [browsing, setBrowsing] = useState(false)
	const browseTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
	const follow = useRef<{stop: () => void}>(undefined)
	const press = useRef<{x: number; y: number}>(undefined)
	// Whether the keyboard has walked the focus to a line (see browse)
	const walking = useRef(false)
	const rowElement = (index: number) => scrollerRef.current?.children[index] as HTMLElement | undefined

	// The clock. Runs every frame only while the media plays; a seek or a
	// pause is read once.
	useEffect(() => {
		if (!media) return setActive(-1)
		let frame = 0
		let said = -1
		let saidRow = -1
		const read = () => {
			const ms = media.currentTime * 1000
			const index = activeLine(rows, ms)
			setActive(index)
			const row = rows[index]
			const count = row?.type === 'line' ? wordsSaid(wordsOf(lines[row.line]!), row, ms) : 0
			if (index !== saidRow || count !== said) {
				// Only the spoken line's words are touched, and only when one passes
				if (saidRow !== index)
					rowElement(saidRow)
						?.querySelectorAll('[data-said]')
						.forEach((word) => word.removeAttribute('data-said'))
				const words = rowElement(index)?.querySelectorAll('[data-word]')
				words?.forEach((word, at) => word.toggleAttribute('data-said', at < count))
				said = count
				saidRow = index
			}
		}
		const loop = () => {
			read()
			if (!media.paused && !media.ended) frame = requestAnimationFrame(loop)
		}
		const start = () => {
			cancelAnimationFrame(frame)
			loop()
		}
		start()
		const events = ['play', 'pause', 'seeked', 'timeupdate', 'loadedmetadata'] as const
		for (const type of events) media.addEventListener(type, type === 'play' ? start : read)
		return () => {
			cancelAnimationFrame(frame)
			for (const type of events) media.removeEventListener(type, type === 'play' ? start : read)
		}
	}, [media, rows, lines])

	// The view's height, which the reading position is a share of. It changes
	// under the list: the island is still growing to make room as this mounts.
	const [height, setHeight] = useState(0)
	useLayoutEffect(() => {
		const scroller = scrollerRef.current
		if (!scroller || fits) return
		const observer = new ResizeObserver(() => setHeight(scroller.clientHeight))
		observer.observe(scroller)
		return () => observer.disconnect()
	}, [fits])
	const lead = fits ? 0 : Math.round(height * VARIANTS[variant].reading)

	// Follow: carry the spoken row (before any, the anchor) to the reading
	// position. Where the view opens, and wherever a change of size leaves
	// it, it is simply placed; a change of line travels there, and so does
	// coming back from browsing.
	const focused = active === -1 ? anchor : active
	// The card's reading position is too near its top for the line before to
	// fit above it: through a silence, the line just said keeps its place and
	// the dots breathe below it, rather than leaving its last words cut off
	const reading = variant === 'card' && rows[focused]?.type === 'gap' ? focused - 1 : focused
	const placed = useRef<{reading: number; lead: number}>(undefined)
	const returning = useRef(false)
	useLayoutEffect(() => {
		const scroller = scrollerRef.current
		const row = rowElement(Math.max(0, reading))
		if (!scroller || !row || browsing || fits || height === 0) return
		const top = Math.max(0, row.offsetTop - lead)
		const travels =
			placed.current !== undefined &&
			placed.current.lead === lead &&
			(placed.current.reading !== reading || returning.current)
		returning.current = false
		placed.current = {reading, lead}
		follow.current?.stop()
		if (reduceMotion || !travels) scroller.scrollTop = top
		else {
			follow.current = animate(scroller.scrollTop, top, {...FOLLOW, onUpdate: (value) => (scroller.scrollTop = value)})
		}
	}, [reading, browsing, reduceMotion, height, lead, fits])
	useEffect(
		() => () => {
			follow.current?.stop()
			clearTimeout(browseTimer.current)
		},
		[],
	)

	// The reader has taken the scroll (a wheel, a finger, a key): stop
	// following at once, and come back once they have let it be. A line the
	// keyboard walked to is being read for as long as the focus is on it:
	// following again would carry it, and the focus with it, out of sight —
	// until the pointer takes over (a press, a wheel), the focus left behind.
	const browse = () => {
		if (fits) return
		follow.current?.stop()
		returning.current = true
		setBrowsing(true)
		clearTimeout(browseTimer.current)
		const back = () => {
			if (walking.current && scrollerRef.current?.contains(document.activeElement)) {
				browseTimer.current = setTimeout(back, BROWSE_MS)
			} else setBrowsing(false)
		}
		browseTimer.current = setTimeout(back, BROWSE_MS)
	}
	const resume = () => {
		walking.current = false
		clearTimeout(browseTimer.current)
		setBrowsing(false)
	}

	const playFrom = (startMs: number) => {
		if (!media) return
		media.currentTime = startMs / 1000
		void media.play().catch(() => {})
		resume()
	}
	// Clicks and keys are handled here, once for the list, by finding the row
	// they came from: a row is then only what it looks like, and a change of
	// line re-renders the few rows whose look changed and none of the others.
	const rowOf = (target: EventTarget) => {
		const element = (target as Element).closest<HTMLElement>('[data-lyric]')
		const index = element ? Number(element.dataset.lyric) : Number.NaN
		const row = rows[index]
		return row?.type === 'line' ? {index, row} : undefined
	}
	const onClick = (event: MouseEvent<HTMLDivElement>) => {
		const hit = rowOf(event.target)
		if (!hit || clickSelectedText(event, press.current, window.getSelection(), event.currentTarget)) return
		playFrom(hit.row.startMs)
	}
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const hit = rowOf(event.target)
		const asked = hit && transcriptKey(event, hit.index, rows.length)
		if (!hit || asked === undefined) return
		event.preventDefault()
		if (asked === 'play') return playFrom(hit.row.startMs)
		// Walking the lines is reading them: past the silences, which are not stops
		const step = asked.focus >= hit.index ? 1 : -1
		let to = asked.focus
		while (rows[to] && rows[to]!.type !== 'line') to += step
		if (!rows[to]) return
		walking.current = true
		browse()
		rowElement(to)?.focus()
	}
	// The list's one tab stop: the spoken line, else the first
	const stop = rows[active]?.type === 'line' ? active : rows.findIndex((row) => row.type === 'line')

	return (
		<div
			data-variant={variant}
			// The card's height is its own: a few lines, or all of a short transcript
			className={cn('lyrics relative min-h-0', variant === 'card' && !fits && 'h-48', className)}
		>
			<div
				ref={scrollerRef}
				data-browsing={browsing ? '' : undefined}
				onWheel={() => {
					walking.current = false
					browse()
				}}
				onTouchMove={browse}
				onPointerDown={(event) => {
					press.current = {x: event.clientX, y: event.clientY}
					walking.current = false
				}}
				onClick={onClick}
				onKeyDown={onKeyDown}
				className={cn(
					'umbrel-hide-scrollbar lyrics-scroller h-full overflow-y-auto overscroll-contain',
					fits && 'lyrics-fits',
				)}
				style={fits ? undefined : {paddingTop: lead}}
			>
				{rows.map((row, index) => (
					<Row
						key={index}
						index={index}
						words={row.type === 'line' ? lines[row.line] : undefined}
						// How far from the spoken row, as far as it changes how a row is drawn
						distance={Math.min(5, Math.abs(index - Math.max(0, focused)))}
						current={index === active}
						tabStop={index === stop}
					/>
				))}
			</div>
			{/* Back to the line being spoken, while the reader has wandered off */}
			<button
				type='button'
				tabIndex={browsing ? 0 : -1}
				aria-hidden={!browsing}
				onClick={resume}
				className={cn(
					// 28px to look at, 44px to hit
					'absolute bottom-2 left-1/2 flex h-7 -translate-x-1/2 items-center rounded-full bg-white/14 px-3 text-12 font-medium text-white/90 backdrop-blur-md transition-[opacity,scale] duration-200 ease-out after:absolute after:-inset-2 hover:bg-white/20 motion-reduce:transition-none',
					browsing ? 'scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0',
				)}
			>
				{t('files-audio-island.now-playing')}
			</button>
		</div>
	)
}

type Word = {text: string; space: boolean; matched: boolean}

// One row of the list: a line, or (with no words) a silence. Memoized on
// what it looks like, so only rows whose look changes are rendered again.
const Row = memo(function Row({
	index,
	words,
	distance,
	current,
	tabStop,
}: {
	index: number
	words: readonly Word[] | undefined
	distance: number
	current: boolean
	tabStop: boolean
}) {
	if (!words) {
		return (
			<div aria-hidden='true' data-distance={distance} className='lyric-row lyric-gap'>
				<span />
				<span />
				<span />
			</div>
		)
	}
	return (
		// Not a <button>: the words inside one cannot be selected
		<div
			role='button'
			tabIndex={tabStop ? 0 : -1}
			aria-current={current ? 'true' : undefined}
			data-lyric={index}
			data-distance={distance}
			className='lyric-row cursor-pointer rounded-lg [overflow-wrap:anywhere] outline-hidden select-text focus-visible:ring-1 focus-visible:ring-white/50'
		>
			{runs(words).map((run, at) =>
				run.matched ? (
					// One mark over the whole phrase, spaces and all, as a highlighter draws it
					<span key={at} data-matched=''>
						{run.words.map(wordElement)}
					</span>
				) : (
					run.words.map(wordElement)
				),
			)}
		</div>
	)
})

// A word as the clock lights it (see `data-said`); the space between two is
// only text
const wordElement = (word: Word, at: number) =>
	word.space ? (
		word.text
	) : (
		<span key={at} data-word=''>
			{word.text}
		</span>
	)

// A line's words in runs: what a search matched, and what it did not. A
// space between two matched words belongs to the match.
export function runs(words: readonly Word[]) {
	const out: {matched: boolean; words: Word[]}[] = []
	words.forEach((word, index) => {
		const matched = word.space ? Boolean(words[index - 1]?.matched && words[index + 1]?.matched) : word.matched
		const last = out[out.length - 1]
		if (last && last.matched === matched) last.words.push(word)
		else out.push({matched, words: [word]})
	})
	return out
}

const wordsOf = (line: readonly {text: string; space: boolean}[]) =>
	line.filter((word) => !word.space).map((word) => word.text)
