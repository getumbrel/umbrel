import {AnimatePresence, motion, useReducedMotion} from 'motion/react'
import {useEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {cn} from '@/lib/utils'
import {
	MCP_AGENTS,
	OTHER_AGENT,
	type McpAgentId,
	type McpAgentVisual,
	type McpMatchedAgent,
} from '@/routes/settings/mcp/agents'

// The MCP hero as one morphing surface, borrowed from the cloud constellation.
// In 'pitch' view the agents orbit the umbrelOS icon on a tilted plane — many
// agents, one home in the middle. Switching to 'picker' view sends the same
// plates flying into a tidy grid of agent tiles, so the decoration turns out
// to have been the interface all along. The last satellite is the waving
// robot standing in for every other MCP-capable agent.

type SatelliteSlot = {ring: 'inner' | 'outer'; angle: number; size: number}

// Two elliptical orbit rings read as circles on a tilted plane. Slow enough to
// feel serene, fast enough that the motion registers within a modal-length
// glance; the rings lap each other over time.
const ORBIT_RINGS = {
	inner: {rx: 112, ry: 62, duration: 42},
	outer: {rx: 148, ry: 92, duration: 58},
}

// Starting angles (deg) in display order (MCP_AGENTS + the robot), one slot
// for each: an agent without a slot isn't shown at all, in the pitch or the
// picker. Sizes step down through the ranks — Murmur, Hermes and OpenClaw on
// the inner ring, then Claude Code, Codex, Cursor and the robot on the outer —
// and same-ring satellites keep their relative spacing forever, so gaps stay
// even with a slight wobble.
const SATELLITE_SLOTS: SatelliteSlot[] = [
	{ring: 'inner', angle: 205, size: 70},
	{ring: 'inner', angle: 325, size: 66},
	{ring: 'inner', angle: 85, size: 62},
	{ring: 'outer', angle: 250, size: 52},
	{ring: 'outer', angle: 340, size: 48},
	{ring: 'outer', angle: 70, size: 44},
	{ring: 'outer', angle: 160, size: 42},
]

const PLATE_SPRING = {type: 'spring' as const, stiffness: 190, damping: 24, mass: 0.9}

// The elliptical path as keyframes relative to the satellite's resting point,
// so the loop starts and ends at zero and the morph to the picker can catch it
// anywhere mid-flight. Depth follows the vertical position: at the bottom of
// the ellipse a satellite is near (larger), at the top it is far (smaller).
// The samples are whole `transform` strings rather than separate x, y and
// scale values: animating `transform` directly lets Motion hand the loop to
// the browser's compositor, so it keeps running while the main thread is
// busy. Motion cannot animate z-index, so each satellite keeps the z of its
// starting angle.
const ORBIT_STEPS = 24
function orbitKeyframes(slot: SatelliteSlot) {
	const ring = ORBIT_RINGS[slot.ring]
	const theta = (slot.angle * Math.PI) / 180
	const samples = Array.from({length: ORBIT_STEPS + 1}, (_, i) => theta + (2 * Math.PI * i) / ORBIT_STEPS)
	const depth = (a: number) => (Math.sin(a) + 1) / 2
	return {
		baseX: ring.rx * Math.cos(theta),
		baseY: ring.ry * Math.sin(theta),
		transform: samples.map(
			(a) =>
				`translate(${ring.rx * (Math.cos(a) - Math.cos(theta))}px, ${ring.ry * (Math.sin(a) - Math.sin(theta))}px) scale(${0.85 + 0.3 * depth(a)})`,
		),
		zIndex: Math.round(4 + 12 * depth(theta)),
		duration: ring.duration,
	}
}

// An agent logo as an app-icon plate: full-bleed for icons that are already
// square tiles, inset on white for bare brand marks — the same treatment the
// cloud logos get, so both constellations share one material. With morph on,
// the plate carries a layoutId so it flies as one continuous object between
// the orbit and its picker tile.
export function AgentLogoPlate({
	agent,
	size,
	morph = false,
	className,
}: {
	agent: McpAgentVisual | McpMatchedAgent
	size: number
	morph?: boolean
	className?: string
}) {
	const reducedMotion = useReducedMotion() ?? false
	const shared = morph && {
		layoutId: `mcp-agent-logo-${agent.id}`,
		transition: reducedMotion ? {duration: 0} : PLATE_SPRING,
	}
	if (agent.tile) {
		return (
			<motion.img
				{...shared}
				src={agent.logo}
				alt=''
				className={cn('object-cover shadow-[0_1px_8px_rgba(0,0,0,0.35)]', className)}
				style={{width: size, height: size, borderRadius: Math.round(size * (5 / 18))}}
				draggable={false}
			/>
		)
	}
	return (
		<motion.div
			{...shared}
			className={cn('flex items-center justify-center bg-white shadow-[0_1px_8px_rgba(0,0,0,0.35)]', className)}
			style={{width: size, height: size, borderRadius: Math.round(size * 0.24)}}
		>
			<img src={agent.logo} alt='' className='h-[58%] w-[58%] object-contain' draggable={false} />
		</motion.div>
	)
}

export function AgentConstellation({
	view,
	busy = false,
	onSelect,
	className,
}: {
	view: 'pitch' | 'picker'
	// While the enable mutation is in flight the tiles hold still and pulse
	busy?: boolean
	onSelect?: (agent: McpAgentId | 'generic') => void
	className?: string
}) {
	const {t} = useTranslation()
	const reducedMotion = useReducedMotion() ?? false
	const isPitch = view === 'pitch'
	// The entrance stagger is tuned for whichever view mounted first: leisurely
	// for the pitch, brisk for a picker shown directly
	const mountedAsPitch = useRef(isPitch).current

	// The entrance is driven by a post-mount state flip rather than `initial`
	// so cached queries that skip the skeleton can't suppress it (the same
	// trick the cloud constellation uses)
	const [entered, setEntered] = useState(reducedMotion)
	useEffect(() => {
		const frame = requestAnimationFrame(() => setEntered(true))
		return () => cancelAnimationFrame(frame)
	}, [])

	const layoutTransition = reducedMotion ? {duration: 0} : PLATE_SPRING

	// The registry agents plus the robot for everything else, in display order
	type Entry = {visual: McpAgentVisual; label: string; picker: boolean}
	const entries: Entry[] = [
		...MCP_AGENTS.map((agent) => ({
			visual: agent as McpAgentVisual,
			label: agent.name,
			picker: agent.picker !== false,
		})),
		{visual: OTHER_AGENT, label: t('mcp-connect-agent-other'), picker: true},
	]

	const satellite = ({visual, label}: Entry, slot: SatelliteSlot, index: number) => {
		// The stagger applies to the mount entrance only, never to the morph. On
		// the pitch the agents hold back until the umbrel has landed, then arrive
		// in quick succession.
		const entranceDelay = isPitch ? (mountedAsPitch ? 0.2 + index * 0.05 : 0) : mountedAsPitch ? 0 : index * 0.03
		const orbit = orbitKeyframes(slot)
		const orbiting = isPitch && !reducedMotion
		return (
			// The view is part of the key: switching to the picker mounts a fresh,
			// transform-free tile that flies in from the orbiting satellite's last
			// snapshot via the shared layoutId. Animating the same element out of
			// its live orbit transforms instead double-counts the distance and
			// collapses the flight into a jump.
			<motion.button
				key={`${visual.id}-${view}`}
				layoutId={`mcp-agent-${visual.id}`}
				animate={orbiting ? {transform: orbit.transform} : undefined}
				exit={{opacity: 0, transition: {duration: 0.2}}}
				transition={
					orbiting ? {transform: {duration: orbit.duration, repeat: Infinity, ease: 'linear'}} : layoutTransition
				}
				type='button'
				disabled={isPitch || busy}
				aria-hidden={isPitch}
				onClick={() => onSelect?.(visual.id)}
				whileTap={isPitch ? undefined : {scale: 0.96}}
				className={cn(
					// The resting card is barely there; hover firms it up a notch, and
					// the change lands instantly so the grid feels snappy under the cursor
					!isPitch &&
						'flex flex-col items-center gap-2 rounded-xl border border-white/5 bg-white/7 p-4 hover:border-white/10 hover:bg-white/10 focus:outline-hidden focus-visible:border-white/10 focus-visible:bg-white/6',
				)}
				style={
					isPitch
						? {
								position: 'absolute',
								left: `calc(50% + ${orbit.baseX - slot.size / 2}px)`,
								top: `calc(50% + ${orbit.baseY - slot.size / 2}px)`,
								zIndex: orbit.zIndex,
							}
						: undefined
				}
			>
				<motion.div
					// The playful pop-in belongs to the pitch's opening moment only, and
					// the remount on the view switch must not replay it mid-flight
					initial={false}
					animate={
						entered ? {opacity: 1, scale: 1} : mountedAsPitch ? {opacity: 0, scale: 0.4} : {opacity: 0, scale: 0.97}
					}
					transition={
						mountedAsPitch
							? {
									opacity: {duration: 0.4, delay: entranceDelay},
									scale: {type: 'spring', stiffness: 340, damping: 20, delay: entranceDelay},
								}
							: {
									opacity: {duration: 0.25, delay: entranceDelay},
									scale: {type: 'spring', stiffness: 300, damping: 30, delay: entranceDelay},
								}
					}
					className={cn('flex items-center justify-center', !isPitch && 'flex-col gap-2')}
				>
					<AgentLogoPlate agent={visual} size={isPitch ? slot.size : 48} morph />
					{!isPitch && (
						<motion.span
							initial={reducedMotion ? false : {opacity: 0}}
							animate={{opacity: 1}}
							transition={{duration: 0.3, delay: 0.15}}
							className='text-12'
						>
							{label}
						</motion.span>
					)}
				</motion.div>
			</motion.button>
		)
	}

	return (
		<motion.div
			layout
			// Two columns on phones so tile labels stay on one line; three from sm up
			className={cn(
				isPitch ? 'relative h-[250px]' : 'grid grid-cols-2 gap-2 sm:grid-cols-3',
				busy && 'umbrel-pulse pointer-events-none',
				className,
			)}
		>
			{/* The umbrel at the center: the home the agents report to. It sits
			    above every satellite z, so orbits pass behind it, never across it. */}
			<AnimatePresence>
				{isPitch && (
					<div key='center' className='pointer-events-none absolute top-1/2 left-1/2 z-30'>
						<motion.div
							initial={reducedMotion ? false : {opacity: 0, scale: 0.7}}
							animate={{opacity: 1, scale: 1}}
							exit={{opacity: 0, scale: 0.7}}
							transition={{type: 'spring', stiffness: 300, damping: 24, delay: mountedAsPitch ? 0.1 : 0}}
							className='-mt-[50px] -ml-[50px]'
						>
							{/* The halo breathes gently so the center feels alive, not lit */}
							<motion.div
								animate={reducedMotion ? undefined : {opacity: [0.75, 1, 0.75], scale: [1, 1.06, 1]}}
								transition={{duration: 7, repeat: Infinity, ease: 'easeInOut'}}
								className='absolute -inset-8 rounded-full bg-brand/30 blur-3xl'
							/>
							<img src='/assets/umbrel-ios.png' alt='' className='relative size-[100px]' draggable={false} />
						</motion.div>
					</div>
				)}
			</AnimatePresence>

			{entries.map((entry, index) => {
				const slot = SATELLITE_SLOTS[index]
				if (!slot) return null
				if (entry.picker) return satellite(entry, slot, index)
				// An agent that orbits but has no tile fades away in place while the
				// others fly into the grid
				return <AnimatePresence key={entry.visual.id}>{isPitch && satellite(entry, slot, index)}</AnimatePresence>
			})}
		</motion.div>
	)
}
