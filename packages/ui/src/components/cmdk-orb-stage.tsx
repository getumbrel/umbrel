import {motion, useReducedMotion} from 'motion/react'
import {useEffect, useState} from 'react'

import type {CmdkInsight} from './cmdk-sources'
import {Orb} from './orb/orb'
import {rgbCss, type OrbPalette} from './orb/orb-palette'

// Most searches answer in ~100ms, too soon for the orb to say anything about
// it; one still going after this long is one worth showing a little interest in
const SLOW_SEARCH_MS = 400
// How much a slow search stirs the swirl: a slight quickening, well below
// what typing does (1)
const SLOW_SEARCH_ENERGY = 0.15
// A press squeezes the orb; letting go kicks it back out past where it was,
// and it settles
const ORB_SQUEEZE = {scale: 0.88, transition: {type: 'spring', visualDuration: 0.15, bounce: 0}} as const
const ORB_RELEASE = {type: 'spring', visualDuration: 0.45, bounce: 0.55, velocity: 1.5} as const

// The orb and its glow. It rises into place as the palette opens and sinks
// away as it closes (keyframes in index.css); keys press it, a space flashes
// it. It's the one thing on the stage besides the card that a press doesn't
// dismiss: the orb squeezes under it, stirs, and pops back when let go.
// While the results shown were found by what is in them, its glow is a little
// warmer; nothing else marks the moment.
export function CmdkOrbStage({
	size,
	palette,
	energy,
	pressed,
	pulseKey,
	insight,
	onPress,
}: {
	size: number
	palette: OrbPalette
	energy: number
	pressed: boolean
	pulseKey: number
	// How Search's understanding of the query is going (see CmdkInsight)
	insight: CmdkInsight
	onPress: () => void
}) {
	const reduceMotion = useReducedMotion()
	const slow = useSlowSearch(insight.state === 'thinking')
	// The warmth follows the last answer, not the question being typed, so
	// refining a query that was understood keeps it rather than flickering it
	// off and on with every keystroke
	const [answered, setAnswered] = useState(insight.state)
	if (insight.state !== 'thinking' && insight.state !== answered) setAnswered(insight.state)

	return (
		<div
			className='cmdk-orb-stage relative mb-4 shrink-0 sm:mb-5'
			style={{width: size, height: size}}
			data-insight={insight.state}
			data-understood={answered === 'understood' ? '' : undefined}
		>
			<div
				aria-hidden='true'
				className='pointer-events-none absolute -inset-[45%] rounded-full'
				style={{
					background: `radial-gradient(circle, ${rgbCss(palette.primary, 0.32)} 0%, ${rgbCss(palette.secondary, 0.1)} 38%, transparent 66%)`,
				}}
			/>
			<div
				aria-hidden='true'
				className='cmdk-orb-warmth pointer-events-none absolute -inset-[45%] rounded-full'
				style={{
					background: `radial-gradient(circle, ${rgbCss(palette.milk, 0.38)} 0%, ${rgbCss(palette.primary, 0.3)} 30%, transparent 60%)`,
				}}
			/>
			<div className='cmdk-orb-body relative' data-pressed={pressed ? '' : undefined}>
				<motion.div
					className='pointer-events-auto rounded-full [-webkit-tap-highlight-color:transparent]'
					whileTap={reduceMotion ? undefined : ORB_SQUEEZE}
					transition={ORB_RELEASE}
					onTapStart={onPress}
					// Keep the caret in the field
					onMouseDown={(event) => event.preventDefault()}
				>
					<Orb
						size={size}
						palette={palette}
						energy={slow ? Math.max(energy, SLOW_SEARCH_ENERGY) : energy}
						pulseKey={pulseKey}
					/>
				</motion.div>
			</div>
		</div>
	)
}

function useSlowSearch(searching: boolean) {
	const [slow, setSlow] = useState(false)
	useEffect(() => {
		if (!searching) return
		const timer = setTimeout(() => setSlow(true), SLOW_SEARCH_MS)
		return () => {
			clearTimeout(timer)
			setSlow(false)
		}
	}, [searching])
	return slow
}
