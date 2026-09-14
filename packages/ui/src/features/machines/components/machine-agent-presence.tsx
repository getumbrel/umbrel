import {AnimatePresence, motion, useReducedMotion} from 'motion/react'
import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import {useTranslation} from 'react-i18next'

import {AgentLogoPlate} from '@/routes/settings/mcp/constellation'
import {MagicRings} from '@/routes/settings/mcp/magic-rings'

import type {MachineAgentControl} from '../types'
import {agentAccentFor, agentVisualFor, POINTER_SHAPE} from './agent-pointer'

const SETTLE = {duration: 0.46, ease: [0.22, 1, 0.36, 1] as const}

// Animate the glass dimensions, not its scale: backdrop and text stay undistorted.
// The logo and caption each have one uninterrupted path into their final slots.
export function MachineAgentPresence({
	control,
	takenOver,
	animateArrival,
}: {
	control: MachineAgentControl
	takenOver: boolean
	animateArrival: boolean
}) {
	const reducedMotion = useReducedMotion() ?? false
	const [arriving, setArriving] = useState(animateArrival && !reducedMotion)
	const [waveVisible, setWaveVisible] = useState(animateArrival && !reducedMotion)
	const host = useRef<HTMLDivElement>(null)
	const measure = useRef<HTMLSpanElement>(null)
	const [metrics, setMetrics] = useState({text: 220, available: 340})
	const {t} = useTranslation()
	// Literal keys per branch: the locale pruner only recognises t('...') calls
	const caption = takenOver
		? t('machines.console-agent-shared', {agent: control.agent.label})
		: t('machines.console-agent-controlling', {agent: control.agent.label})
	useLayoutEffect(() => {
		const update = () => {
			if (!host.current || !measure.current) return
			// Measure layout pixels, unaffected by ancestor transforms. Reserve rounding room
			// so an exactly fitted caption never triggers the browser’s ellipsis.
			const next = {text: measure.current.scrollWidth + 2, available: host.current.clientWidth}
			setMetrics((old) => (old.text === next.text && old.available === next.available ? old : next))
		}
		update()
		const observer = new ResizeObserver(update)
		if (host.current) observer.observe(host.current)
		if (measure.current) observer.observe(measure.current)
		return () => observer.disconnect()
	}, [caption])
	useEffect(() => {
		if (!arriving) return
		const quiet = setTimeout(() => setWaveVisible(false), 760)
		const settle = setTimeout(() => setArriving(false), 1_500)
		return () => {
			clearTimeout(quiet)
			clearTimeout(settle)
		}
	}, [arriving])
	const expanded = arriving && !reducedMotion && !takenOver
	const accent = agentAccentFor(control)
	const pillWidth = Math.min(metrics.available, metrics.text + 66)
	const width = expanded ? Math.min(metrics.available, Math.max(320, pillWidth)) : pillWidth
	const textWidth = Math.min(metrics.text, width - (expanded ? 34 : 66))
	const transition = reducedMotion ? {duration: 0} : SETTLE
	return (
		<div
			ref={host}
			className='pointer-events-none absolute inset-x-3 top-3 z-20 flex justify-center text-13 font-medium -tracking-2 text-white/90'
			aria-live='polite'
		>
			<span ref={measure} className='invisible absolute w-max whitespace-nowrap' aria-hidden>
				{caption}
			</span>
			<motion.div
				initial={animateArrival && !reducedMotion ? {y: -8, width, height: 116, borderRadius: 28} : false}
				animate={{width, height: expanded ? 132 : 40, borderRadius: expanded ? 28 : 20, y: 0}}
				transition={transition}
				className='settings-edge-material relative shrink-0 overflow-hidden bg-black/25 backdrop-blur-xl backdrop-saturate-150 [text-shadow:0_1px_2px_rgb(0_0_0/25%)] contrast-more:bg-black/80'
				data-agent-arriving={expanded}
			>
				<AnimatePresence>
					{expanded && waveVisible && (
						<motion.div
							key='wave'
							className='absolute -top-[19px] left-1/2 h-[132px] w-[340px] -translate-x-1/2 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]'
							initial={{opacity: 0}}
							animate={{opacity: 0.7}}
							exit={{opacity: 0}}
							transition={{duration: 0.2}}
						>
							<MagicRings variant='neutral' speed={1.4} opacity={0.6} />
						</motion.div>
					)}
				</AnimatePresence>
				<motion.div
					className='absolute top-0 left-0 size-12 origin-top-left'
					initial={false}
					animate={{x: expanded ? (width - 48) / 2 : 16, y: expanded ? 23 : 8, scale: expanded ? 1 : 0.5}}
					transition={transition}
				>
					<AgentLogoPlate agent={agentVisualFor(control)} size={48} />
					<AnimatePresence>
						{expanded && waveVisible && (
							<motion.svg
								key='cursor'
								viewBox='-3 -3 38 38'
								className='absolute -right-4 -bottom-3 size-8 overflow-visible drop-shadow-md'
								initial={{opacity: 0, scale: 0.8, y: 4}}
								animate={{opacity: 1, scale: 1, y: 0}}
								exit={{opacity: 0, scale: 0.9}}
								transition={{duration: 0.2, ease: [0.22, 1, 0.36, 1]}}
								aria-hidden
							>
								<path
									d={POINTER_SHAPE}
									fill={accent}
									stroke={`color-mix(in srgb, ${accent} 35%, white)`}
									strokeWidth={2.4}
									strokeLinejoin='round'
								/>
							</motion.svg>
						)}
					</AnimatePresence>
				</motion.div>
				<motion.span
					className='absolute top-0 left-0 block truncate leading-6'
					initial={false}
					style={{width: textWidth}}
					animate={{x: expanded ? (width - textWidth) / 2 : 48, y: expanded ? 86 : 8}}
					transition={transition}
				>
					{caption}
				</motion.span>
			</motion.div>
		</div>
	)
}
