import {motion, useReducedMotion} from 'motion/react'
import React, {useEffect, useState} from 'react'
import {Trans} from 'react-i18next'

import {Button} from '@/components/ui/button'
import {machineIconSrc} from '@/features/machines/components/os-icon'
import {getOsVisuals, layoutMorphTransition} from '@/features/machines/constants'
import {cn} from '@/lib/utils'
import {t} from '@/utils/i18n'

// First-run pitch for Machines — "the Wall of Machines": every OS asleep in
// the dark, waking in a scattered cascade into a gentle idle float. Hovering a
// sleeping monitor pokes it awake; clicking any monitor (or the CTA) commits,
// and the monitors glide into their card positions in the catalog via shared
// layoutIds (see OsCatalog).

// Hand-tuned lean/offset so the sleeping wall reads as a pile of hardware, not
// a grid. Longer than the wall can be, indexed modulo its length.
const JITTER = [
	{r: -7, y: 8},
	{r: 5, y: -6},
	{r: -3, y: 10},
	{r: 6, y: -9},
	{r: -5, y: 4},
	{r: 4, y: -3},
	{r: -6, y: 9},
	{r: 3, y: -8},
	{r: -4, y: 3},
	{r: 7, y: -5},
	{r: -5, y: 7},
	{r: 6, y: -4},
]

// Monitors wake scattered across the wall rather than left-to-right, like a
// shop of old machines coming alive one switch at a time
const WAKE_RANK = [0, 7, 3, 9, 1, 5, 8, 2, 6, 4, 10, 11]

const CASCADE_START_MS = 500
const CASCADE_STEP_MS = 150
const WAKE_MS = 550

// The Machines app icon doubles as every monitor's sleeping state: the header
// above this intro renders it already, so it's warm in the browser cache and
// the wall paints instantly even on slow links (e.g. Tailscale) while the
// per-OS artwork streams in
const MACHINES_APP_ICON = '/assets/dock/dock-machines.webp'

type Stage = 'off' | 'loading' | 'on'

// off → loading → on, on a per-monitor schedule
function useWakeStage(delay: number, forceOn: boolean) {
	const [stage, setStage] = useState<Stage>('off')
	useEffect(() => {
		// Forced-on (reduced motion) never reads the timed stage — don't run it
		if (forceOn) return
		const toLoading = setTimeout(() => setStage('loading'), delay)
		const toOn = setTimeout(() => setStage('on'), delay + WAKE_MS)
		return () => {
			clearTimeout(toLoading)
			clearTimeout(toOn)
		}
	}, [delay, forceOn])
	return forceOn ? 'on' : stage
}

export type IntroWallEntry = {id: string; name: string; onMobileWall?: boolean}

function WallMonitor({
	entry,
	index,
	leaving,
	onCommit,
}: {
	entry: IntroWallEntry
	index: number
	leaving: boolean
	onCommit: () => void
}) {
	const reducedMotion = useReducedMotion() ?? false
	const rawStage = useWakeStage(CASCADE_START_MS + WAKE_RANK[index % WAKE_RANK.length] * CASCADE_STEP_MS, reducedMotion)
	// Hovering a still-sleeping monitor pokes it awake early; committing wakes
	// the whole wall so no monitor departs asleep
	const [poked, setPoked] = useState(false)
	const stage = leaving || poked ? 'on' : rawStage
	const jitter = JITTER[index % JITTER.length]
	const {color} = getOsVisuals(entry.id)

	// A monitor may only leave the sleeping state once every wake artwork it
	// will show has actually loaded — until then it stays on the cached app
	// icon, so a slow connection sees machines wake as their art arrives
	// instead of half-loaded pop-in
	const wakeVariants = reducedMotion ? (['on'] as const) : (['loading', 'on'] as const)
	const [loadedArt, setLoadedArt] = useState<ReadonlySet<string>>(new Set())
	const markLoaded = (variant: string) =>
		setLoadedArt((current) => (current.has(variant) ? current : new Set(current).add(variant)))
	const artReady = wakeVariants.every((variant) => loadedArt.has(variant))
	// What's actually on screen: the scheduled stage once the art is ready
	const shown: 'sleeping' | 'loading' | 'on' = artReady && stage !== 'off' ? stage : 'sleeping'

	// Idle float: once a monitor wakes it starts a slow bob and sway, each with
	// its own period, amplitude, and phase so the wall never moves in unison.
	// On departure the float releases so the glide starts from rest.
	const floating = !leaving && !reducedMotion && shown === 'on'
	const floatAmp = 4 + (index % 3)
	const floatDuration = 5.5 + (index % 4) * 0.7
	const floatDelay = (index % 5) * 0.35

	return (
		<div
			// Straightening out of the resting lean is the departure's first beat:
			// the pile becomes a formation just before it glides into the grid.
			// Monitors outside the curated mobile spread only exist from md up.
			className={cn('transition-transform duration-300', !entry.onMobileWall && 'max-md:hidden')}
			style={{transform: leaving ? undefined : `rotate(${jitter.r}deg) translateY(${jitter.y}px)`}}
		>
			{/* Hover layer: a springy perk-up — scale plus a counter-tilt against
			    the resting lean — with its own snappy spring so the slow idle float
			    underneath never drags the hover response */}
			<motion.button
				type='button'
				onClick={onCommit}
				onHoverStart={() => setPoked(true)}
				whileHover={{scale: 1.12, rotate: jitter.r * -0.7}}
				whileTap={{scale: 0.94}}
				transition={{type: 'spring', stiffness: 350, damping: 18}}
				className='group/crt block cursor-pointer focus:outline-hidden'
				aria-label={entry.name}
			>
				{/* The float is a CSS animation so it runs on the compositor: as motion
				    keyframes it drove a JavaScript frame loop with a style recalc every
				    frame under the overlay's blur. Dropping the class on release
				    transitions back to rest from wherever the bob was. */}
				<div
					className={cn('transition-transform duration-[400ms] ease-out', floating && 'umbrel-machine-float')}
					style={
						{
							'--float-amp': `${floatAmp}px`,
							'--float-duration': `${floatDuration}s`,
							'--float-delay': `${floatDelay}s`,
						} as React.CSSProperties
					}
				>
					{/* The layoutId hands this monitor's bounds to its catalog card's
					    icon at commit, so the wall glides into the grid. A slightly
					    underdamped spring gives the wake a playful overshoot pop. */}
					<motion.div
						layoutId={`catalog-icon-${entry.id}`}
						animate={{scale: shown === 'on' ? 1 : 0.94}}
						transition={{...layoutMorphTransition, scale: {type: 'spring', stiffness: 320, damping: 15}}}
						className='relative size-18 md:size-24'
					>
						<div
							aria-hidden
							className={cn(
								'absolute inset-1 rounded-full blur-2xl transition-opacity duration-500',
								shown === 'on' ? 'opacity-50 group-hover/crt:opacity-80' : 'opacity-0',
							)}
							style={{backgroundColor: color}}
						/>
						<img
							src={MACHINES_APP_ICON}
							alt=''
							draggable={false}
							className={cn(
								'absolute inset-0 size-full rounded-[22%] object-contain transition-opacity duration-300',
								shown === 'sleeping' ? 'opacity-100' : 'opacity-0',
							)}
						/>
						{wakeVariants.map((variant) => (
							<img
								key={variant}
								src={machineIconSrc(entry.id, variant)}
								alt=''
								draggable={false}
								// complete-check covers cached images whose load event
								// fired before React attached the onLoad listener
								ref={(el) => {
									if (el?.complete && el.naturalWidth > 0) markLoaded(variant)
								}}
								onLoad={() => markLoaded(variant)}
								className={cn(
									'absolute inset-0 size-full object-contain transition-opacity duration-300',
									shown === variant ? 'opacity-100' : 'opacity-0',
								)}
							/>
						))}
					</motion.div>
				</div>
			</motion.button>
		</div>
	)
}

export function CatalogIntro({entries, onCommit}: {entries: IntroWallEntry[]; onCommit: () => void}) {
	const reducedMotion = useReducedMotion() ?? false
	// Committing plays a short departure beat before actually handing off: the
	// copy dips away, the monitors straighten and all wake, then the catalog
	// mounts and they glide into their tiles
	const [leaving, setLeaving] = useState(false)
	const commit = () => {
		if (leaving) return
		setLeaving(true)
		setTimeout(onCommit, reducedMotion ? 0 : 280)
	}

	// Copy enters in three tight beats — heading, paragraph, button — with just
	// enough initial delay to land after the surface settles, while the wall's
	// wake cascade plays underneath
	const enter = (beat: number) =>
		leaving ? {duration: 0.18} : {delay: 0.25 + beat * 0.15, duration: 0.5, ease: 'easeOut' as const}
	const copyState = leaving ? {opacity: 0, y: -6} : {opacity: 1, y: 0}

	return (
		<div className='flex flex-col items-center gap-6 px-4 py-6 md:p-12'>
			<div className='flex flex-col items-center gap-2 pt-2 text-center'>
				<motion.h1
					initial={{opacity: 0, y: 8}}
					animate={copyState}
					transition={enter(0)}
					className='text-[28px] font-semibold -tracking-2 text-white md:text-[32px]'
				>
					{t('machines.intro-title')}
				</motion.h1>
				<motion.p
					initial={{opacity: 0, y: 8}}
					animate={copyState}
					transition={enter(1)}
					className='max-w-md text-15 leading-snug -tracking-2 text-white/50'
				>
					<Trans t={t} i18nKey='machines.intro-description' components={{highlight: <span className='text-white' />}} />
				</motion.p>
			</div>

			{/* CTA sits above the wall so the action is never below the fold —
			    the pile becomes atmosphere beneath the decision */}
			<motion.div initial={{opacity: 0, y: 8}} animate={copyState} transition={enter(2)}>
				<Button variant='primary' size='lg' onClick={commit}>
					{t('machines.intro-cta')}
				</Button>
			</motion.div>

			<div className='flex max-w-[680px] flex-wrap items-center justify-center gap-x-5 gap-y-7 py-2 pb-4 md:gap-x-8 md:gap-y-10 md:py-4'>
				{entries.map((entry, index) => (
					<WallMonitor key={entry.id} entry={entry} index={index} leaving={leaving} onCommit={commit} />
				))}
			</div>
		</div>
	)
}
