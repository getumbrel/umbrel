import {cn} from '@/lib/utils'

import type {SearchFootnoteLine} from './use-search-footnote'

// Search admitting it is not at full strength: one small line. How far along
// it is, where that is the news, the line says, and the arc beside what is
// typed draws (see SearchArc). It is no live region: the number is not read
// out again every time it changes.
export function SearchFootnote({line, className}: {line: SearchFootnoteLine; className?: string}) {
	return (
		<p className={cn('text-center text-12 leading-snug -tracking-2 text-balance text-white/40', className)}>
			{line.text}
		</p>
	)
}
