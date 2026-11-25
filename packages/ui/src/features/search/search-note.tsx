import type {SearchFootnoteLine} from './use-search-footnote'

// What Search has to say for itself after a count, in a bar's one line of
// small words: Photos' view line and Files' listing line. It is the part of
// that line that gives (it stands last in it, and brings its own slash and
// the gap before it, so that a note not shown takes no room either), and its
// whole sentence is there for a pointer that rests on it. The sentence shows
// where the line has room for all of it, and is never cut: short of that it
// is said in fewer words, and those are cut before the number after them,
// which is the news. Short of room for the number and the start of the words
// nothing is shown: the number alone would say nothing. It is no live
// region: the number is not read out again every time it changes.
//
// Which of the three it is, is the line's own room to decide, whatever the
// window and the language, so it is done by wrapping in a box one line tall
// that shows only its first line. The box is as wide as the sentence where
// the line can spare that, and the fewer words, which ask for no width of
// their own, then have none. In a narrower box the sentence wraps out of
// sight and the fewer words have the line; and in theirs, by the same means,
// they wrap away when it is narrower than the least they need. (It gives
// by so much more than the rest of the line that what comes before it loses
// no part of a pixel meanwhile: a name short of one would be drawn cut.)
export function SearchNote({line}: {line: SearchFootnoteLine}) {
	const short = line.short ?? line.text
	// Where the number stands in the words, by language; a line without one is only words
	const {number} = line
	const at = number === undefined ? -1 : short.indexOf(number)
	const before = at === -1 ? short : short.slice(0, at).trimEnd()
	const after = at === -1 ? '' : short.slice(at + number!.length).trimStart()
	const slash = (
		<span aria-hidden className='shrink-0 text-white/25'>
			/
		</span>
	)
	return (
		<span className='-ms-2 flex h-[1lh] min-w-0 shrink-[99999] flex-wrap overflow-hidden' title={line.text}>
			{/* (Not said twice to a screen reader: the sentence below is what it reads) */}
			<span aria-hidden className='flex h-full w-0 min-w-0 grow flex-wrap overflow-hidden'>
				{/* (Holds the first line when the words have wrapped off it) */}
				<span className='h-full' />
				<span className='flex min-w-0 shrink-0 grow basis-22 items-center gap-2 ps-2'>
					{slash}
					{/* (The gap is the space the words had before the number) */}
					<span className='flex min-w-0 gap-[0.25em]'>
						{before && <span className='min-w-0 truncate'>{before}</span>}
						{at !== -1 && <span className='shrink-0'>{number}</span>}
						{after && <span className='min-w-0 truncate'>{after}</span>}
					</span>
				</span>
			</span>
			<span className='flex shrink-0 items-center gap-2 ps-2 whitespace-nowrap'>
				{slash}
				{line.text}
			</span>
		</span>
	)
}
