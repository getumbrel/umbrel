// Text rules every widget follows, at every size:
//
// 1. One line per fact. Names, labels, figures and file names never wrap:
//    they truncate, at the end for words and in the middle for file names.
// 2. Only prose wraps (a list item's text, e.g. a post), clamped to a fixed
//    number of lines, wrapped "pretty" so no line is a lone word, and broken at
//    a long identifier's own separators (dots, dashes, underscores, slashes)
//    rather than mid-word.
// 3. Whole rows only. A row that doesn't fit isn't drawn (container queries
//    pick how many), instead of being half-clipped or faded under a mask.
// 4. Nothing under 10px, and 10px only for captions in compact widgets.

import {cn} from '@/lib/utils'

const ZERO_WIDTH_SPACE = '\u200B'

/**
 * Lets a long identifier ("The.Complete.Works.1080p.mkv") break after its
 * separators instead of mid-word. Short tokens are left whole, so a version
 * like "22.04.3" never splits across lines.
 */
export function softBreaks(text: string) {
	return text.replace(/\S{14,}/g, (token) => token.replace(/([._/\\-])(?=[^._/\\-])/g, `$1${ZERO_WIDTH_SPACE}`))
}

/**
 * A file name on one line, cut in the middle when it doesn't fit, so the end
 * of the name and its extension stay visible ("Quarterly finan…l v3.pdf"), as
 * Finder does. The extension is quieter than the name. Compact widgets show
 * just the start of the name ("Quarterl…"): with room for eight characters the
 * start matters most, and the file's icon already says what type it is.
 */
export function FileName({name, className}: {name: string; className?: string}) {
	const dot = name.lastIndexOf('.')
	const base = dot > 0 ? name.slice(0, dot) : name
	const extension = dot > 0 ? name.slice(dot) : ''
	// Keep a few characters of the base beside the extension once it's cut
	const keep = Math.min(4, Math.max(0, base.length - 6))
	const head = base.slice(0, base.length - keep)
	const tail = base.slice(base.length - keep)
	return (
		<span className={cn('flex min-w-0', className)} title={name}>
			<span className='min-w-0 truncate'>
				{head}
				{/* Compact: the kept characters join the start, which truncates */}
				<span className='w-regular:hidden'>{tail}</span>
			</span>
			<span className='shrink-0'>
				<span className='hidden w-regular:inline'>{tail}</span>
				<span className='hidden opacity-45 w-regular:inline'>{extension}</span>
			</span>
		</span>
	)
}
