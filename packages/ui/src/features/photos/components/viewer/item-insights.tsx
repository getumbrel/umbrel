import {Captions, Check, ChevronDown, Copy, ScanText} from 'lucide-react'
import {Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'
import {useCopyToClipboard} from 'react-use'

import {lineSegments, textLines, type TextFocus} from '@/features/photos/components/viewer/text-regions'
import type {SearchInsights} from '@/features/photos/hooks/use-search'
import {markClass} from '@/features/search/mark'
import {transcriptText} from '@/features/search/transcript'
import {TranscriptView} from '@/features/search/transcript-view'
import {cn} from '@/lib/utils'
import {tw} from '@/utils/tw'

// What Search found inside the item, as the inspector shows it: the words
// read off a picture, and what is said in a video.

const cardClass = tw`rounded-xl bg-white/6`
const headerClass = tw`flex items-center gap-2.5 px-3 pt-3 pb-2`
// 24px to look at, 40px to hit: the reach is a pseudo-element, so it moves nothing
const iconButtonClass = tw`relative flex size-6 shrink-0 items-center justify-center rounded-full text-white/50 transition-colors after:absolute after:-inset-2 hover:bg-white/10 hover:text-white`

const NO_TERMS: readonly string[] = []

// The whole of a card's text to the clipboard in one click; the glyph turns
// to a check for a moment to say it went.
function CopyButton({text, label}: {text: string; label: string}) {
	const [, copyToClipboard] = useCopyToClipboard()
	const [copied, setCopied] = useState(false)
	useEffect(() => {
		if (!copied) return
		const handle = setTimeout(() => setCopied(false), 1500)
		return () => clearTimeout(handle)
	}, [copied])
	return (
		<button
			type='button'
			aria-label={label}
			title={label}
			onClick={() => {
				copyToClipboard(text)
				setCopied(true)
			}}
			className={iconButtonClass}
		>
			{copied ? <Check className='size-3.5 text-white' /> : <Copy className='size-3.5' />}
		</button>
	)
}

// Text read off the picture — a sign, a receipt, a whiteboard. A few lines
// are enough to recognise it by; the rest unfolds on request, and the whole
// of it is one click from the clipboard, which is what it is usually for.
// Opened from a search that found the picture by these words, they are
// marked — and the text starts unfolded if they would otherwise be below the
// fold, since they are what the reader came for.
//
// Where Search kept each line's place in the picture (`quads`) and the stage
// can draw on it (`onFocus`, see TextHighlights), the text is live: the line under the pointer
// is outlined on the picture (where there is no pointer to rest, a tap on a
// line points at it, and another lets it go), the card's own glyph is a switch that outlines
// them all — resting on the header shows them for as long, which is how the
// switch is found — and with the text in focus the arrow keys walk its
// lines. None of it is in the way of the words: they select and copy as they
// always did, and a picture with no places kept shows exactly the card it
// showed before.
export function DetectedText({
	text,
	matched = NO_TERMS,
	quads,
	onFocus,
}: {
	text: string
	matched?: readonly string[]
	quads?: readonly (readonly number[])[]
	onFocus?: (focus: TextFocus) => void
}) {
	const {t} = useTranslation()
	const [expanded, setExpanded] = useState(false)
	// Whether there is more than the clamp shows: measured, since it depends
	// on the words and the panel's width
	const bodyRef = useRef<HTMLParagraphElement>(null)
	const [overflows, setOverflows] = useState(false)
	useLayoutEffect(() => {
		const body = bodyRef.current
		if (body && !expanded) setOverflows(body.scrollHeight > body.clientHeight + 1)
	}, [text, expanded])
	// Once per text and match: folding it back by hand is the reader's call.
	// (Unfolded, nothing is below the fold, so this never fights that.)
	useLayoutEffect(() => {
		const body = bodyRef.current
		const mark = body?.querySelector('mark')
		if (body && mark && mark.offsetTop - body.offsetTop >= body.clientHeight) setExpanded(true)
	}, [text, matched])

	const segments = useMemo(() => lineSegments(text, matched), [text, matched])
	// Which lines have a place in the picture, when there is a stage to show it on
	const placed = useMemo(
		() => (onFocus ? textLines(text, quads).map((line) => line.quad !== undefined) : []),
		[text, quads, onFocus],
	)
	const live = placed.some(Boolean)
	// What the card points at: one line (under the pointer, or walked to by
	// key), else every line while the switch is on or the header rested on
	const [line, setLine] = useState<number>()
	const [all, setAll] = useState(false)
	const [peeking, setPeeking] = useState(false)
	const pointed = live && line !== undefined && placed[line] ? line : undefined
	const everything = live && (all || peeking)
	useEffect(() => {
		onFocus?.(pointed !== undefined ? {line: pointed} : everything ? 'all' : null)
	}, [onFocus, pointed, everything])
	useEffect(() => () => onFocus?.(null), [onFocus])

	const lineAt = (target: EventTarget) => {
		const index = Number((target as Element).closest<HTMLElement>('[data-line]')?.dataset.line)
		return Number.isInteger(index) && placed[index] ? index : undefined
	}
	// The next line with a place, in the direction asked, from the one pointed at
	const step = (by: 1 | -1) => {
		for (
			let index = (pointed ?? (by === 1 ? -1 : placed.length)) + by;
			index >= 0 && index < placed.length;
			index += by
		) {
			if (placed[index]) return setLine(index)
		}
	}

	return (
		<div className={cardClass}>
			<div
				className={headerClass}
				// Resting on the header, with a pointer that can rest
				onPointerEnter={live ? (event) => event.pointerType === 'mouse' && setPeeking(true) : undefined}
				onPointerLeave={live ? () => setPeeking(false) : undefined}
			>
				{live ? (
					<button
						type='button'
						aria-label={t('photos-item.show-text-on-photo')}
						title={t('photos-item.show-text-on-photo')}
						aria-pressed={all}
						onClick={() => setAll((on) => !on)}
						// The glyph stays where it sits as a plain icon
						className={cn(iconButtonClass, '-m-1', all ? 'bg-white/20 text-white' : 'text-white/70')}
					>
						<ScanText className='size-4' />
					</button>
				) : (
					<ScanText className='size-4 shrink-0 text-white/70' />
				)}
				<p className='min-w-0 flex-1 truncate text-12 text-white/55'>{t('photos-item.detected-text')}</p>
				<CopyButton text={text} label={t('photos-item.copy-text')} />
				{(overflows || expanded) && (
					<button
						type='button'
						aria-label={expanded ? t('photos-item.show-less') : t('photos-item.show-more')}
						aria-expanded={expanded}
						onClick={() => setExpanded((open) => !open)}
						className={iconButtonClass}
					>
						<ChevronDown
							className={cn(
								'size-4 transition-transform duration-200 motion-reduce:transition-none',
								expanded && 'rotate-180',
							)}
						/>
					</button>
				)}
			</div>
			{/* The clamp is on the text alone: padding on a clamped box shows a slice of the next line */}
			<div className='px-3 pb-3'>
				<p
					ref={bodyRef}
					// One stop for Tab where the lines can be walked
					tabIndex={live ? 0 : undefined}
					onPointerOver={live ? (event) => event.pointerType === 'mouse' && setLine(lineAt(event.target)) : undefined}
					onPointerLeave={live ? (event) => event.pointerType === 'mouse' && setLine(undefined) : undefined}
					onClick={
						live
							? (event) => {
									// A tap, not a click, and not the end of a selection
									if ((event.nativeEvent as PointerEvent).pointerType === 'mouse') return
									if (!window.getSelection()?.isCollapsed) return
									const tapped = lineAt(event.target)
									setLine((current) => (tapped === current ? undefined : tapped))
								}
							: undefined
					}
					onFocus={live ? (event) => event.currentTarget.matches(':focus-visible') && step(1) : undefined}
					onBlur={live ? () => setLine(undefined) : undefined}
					onKeyDown={
						live
							? (event) => {
									if (event.metaKey || event.ctrlKey || event.altKey) return
									if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
										event.preventDefault()
										step(event.key === 'ArrowDown' ? 1 : -1)
									} else if (event.key === 'Escape' && line !== undefined) {
										event.stopPropagation()
										setLine(undefined)
									}
								}
							: undefined
					}
					className={cn(
						'rounded-[3px] text-13 [overflow-wrap:anywhere] whitespace-pre-wrap text-white/85 outline-hidden select-text focus-visible:ring-1 focus-visible:ring-white/40 focus-visible:ring-offset-4 focus-visible:ring-offset-transparent',
						!expanded && 'line-clamp-3',
					)}
				>
					{segments.map((runs, index) => (
						<Fragment key={index}>
							{index > 0 && '\n'}
							<span
								data-line={index}
								className={cn(
									placed[index] && 'rounded-[3px] box-decoration-clone transition-colors duration-150',
									pointed === index && 'bg-white/14 text-white',
								)}
							>
								{runs.map((run, at) =>
									run.highlighted ? (
										<mark key={at} className={markClass} data-match-target=''>
											{run.text}
										</mark>
									) : (
										run.text
									),
								)}
							</span>
						</Fragment>
					))}
				</p>
			</div>
		</div>
	)
}

// What is said in the video, followed as it plays (see TranscriptView): the
// line being spoken bright, the rest softened around it, a line a place to
// play from. Opened from a search that matched words said in it, those words
// are marked and the card rests on them until the video plays.
export function Transcript({
	transcript,
	video,
	matched = NO_TERMS,
}: {
	transcript: NonNullable<SearchInsights['transcript']>
	// The words a search found the video by, marked in the lines that say them
	matched?: readonly string[]
	// The stage's player, once it has mounted
	video: HTMLVideoElement | null
}) {
	const {t} = useTranslation()
	return (
		// What a search found here is in this card (see useRevealMatch)
		<div className={cardClass} data-match-target={matched.length > 0 ? '' : undefined}>
			<div className={headerClass}>
				<Captions className='size-4 shrink-0 text-white/70' />
				<p className='min-w-0 flex-1 truncate text-12 text-white/55'>{t('photos-item.transcript')}</p>
				<CopyButton text={transcriptText(transcript)} label={t('photos-item.copy-transcript')} />
			</div>
			<TranscriptView transcript={transcript} media={video} matched={matched} variant='card' />
		</div>
	)
}
