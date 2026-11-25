import {useTranslation} from 'react-i18next'

import {cn} from '@/lib/utils'

import type {SearchResult} from './types'

type ContentMatch = Exclude<SearchResult['match'], 'name'>

// Whether a result was found by what is in it (how it looks, the words read
// off it or inside it, what is said in it) rather than by its name
export const isContentMatch = (match: SearchResult['match'] | undefined): match is ContentMatch =>
	match !== undefined && match !== 'name'

const LABEL_KEYS = {
	visual: 'search.found-by.visual',
	text: 'search.found-by.text',
	speech: 'search.found-by.speech',
} as const satisfies Record<ContentMatch, string>

// A small mark leading a result's match line that says how Search found it:
// an eye for how it looks, a scan of lines for text read off it or inside it,
// a waveform for words spoken in it. Nothing for a name match. Information,
// not decoration: drawn in the line's own colour, at the line's size.
// On a 24-unit box at 12px, so a 2.2-unit stroke is about the weight of the
// 12px text beside it.
export function MatchGlyph({
	match,
	id,
	className,
}: {
	match: SearchResult['match'] | undefined
	// For a result that wants the mark's label as its description
	id?: string
	className?: string
}) {
	const {t} = useTranslation()
	if (!isContentMatch(match)) return null
	return (
		<svg
			id={id}
			viewBox='0 0 24 24'
			role='img'
			aria-label={t(LABEL_KEYS[match])}
			className={cn('size-3 shrink-0', className)}
			fill='none'
			stroke='currentColor'
			strokeWidth={2.2}
			strokeLinecap='round'
			strokeLinejoin='round'
		>
			{match === 'visual' ? (
				<>
					<path d='M2 12c2.2-4.4 5.8-7 10-7s7.8 2.6 10 7c-2.2 4.4-5.8 7-10 7s-7.8-2.6-10-7Z' />
					<circle cx='12' cy='12' r='3' fill='currentColor' stroke='none' />
				</>
			) : match === 'text' ? (
				<>
					<path d='M3.5 8.5V6A2.5 2.5 0 0 1 6 3.5h2.5M15.5 3.5H18A2.5 2.5 0 0 1 20.5 6v2.5M20.5 15.5V18a2.5 2.5 0 0 1-2.5 2.5h-2.5M8.5 20.5H6A2.5 2.5 0 0 1 3.5 18v-2.5' />
					<path d='M8.5 10h7M8.5 14h4.5' />
				</>
			) : (
				<path d='M4 10.5v3M8.25 7v10M12.5 3.5v17M16.75 7.5v9M21 10v4' />
			)}
		</svg>
	)
}
