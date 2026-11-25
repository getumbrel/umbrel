import {useState} from 'react'

import type {CmdkInsight} from './cmdk-sources'

// While what the card shows was understood, not just matched by name, the
// glass takes on a faint tint of the wallpaper's colour, strongest under the
// orb. A state, not an event: it is simply there while the results are
// understood and gone when they aren't. The palette is opened all day and
// searches on every keystroke, so nothing here plays per answer, and
// refining a query keeps it steady. Sits over the glass and under the
// content, the same size as the card.
export function CmdkAura({insight}: {insight: CmdkInsight}) {
	// Lit stays lit while a refinement is put (thinking after an understood
	// answer); anything else answered, or nothing to answer, puts it out
	const [lit, setLit] = useState(false)
	const nextLit = insight.state === 'understood' ? true : insight.state === 'thinking' ? lit : false
	if (nextLit !== lit) setLit(nextLit)

	return <div className='cmdk-aura' data-lit={nextLit ? '' : undefined} aria-hidden='true' />
}
