import {motion, useReducedMotion} from 'motion/react'
import {useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject} from 'react'

import type {MachineAgentControl} from '@/features/machines/types'
import {cn} from '@/lib/utils'
import {matchAgent, MCP_AGENTS, OTHER_AGENT} from '@/routes/settings/mcp/agents'

import {pointOnMotion, type InputFeedback} from '../../../../../umbreld/source/modules/machines/input-motion'
import {createAgentGlowTrail, type AgentGlowTrail} from './agent-glow-trail'

export function agentVisualFor(control: MachineAgentControl) {
	return (
		MCP_AGENTS.find(({id}) => id === control.agent.agentType) ?? matchAgent(control.agent.clientName) ?? OTHER_AGENT
	)
}

const accents: Record<string, string> = {
	'claude-code': '#d97757',
	codex: '#7168ff',
	cursor: '#e5e7eb',
	openclaw: '#ef5b5b',
	hermes: '#dfb365',
}

export const agentAccentFor = (control: MachineAgentControl) => accents[agentVisualFor(control).id] ?? '#a7c8ff'

// Use server-relative age, then the browser's monotonic clock. A refreshed
// snapshot never replays an old click or an already completed journey.
export function feedbackLifetime(feedback: InputFeedback) {
	if (feedback.phase === 'released' || feedback.phase === 'complete') return 700
	// Typing can outlast the idle timeout. Its real completion event (or the
	// disappearance of the controller) ends it, rather than an invented timer.
	if (feedback.phase === 'active' && feedback.durationMs === undefined) return Infinity
	if (feedback.phase === 'pressed' && feedback.action !== 'left_click_drag') return (feedback.durationMs ?? 60) + 1_000
	return (feedback.durationMs ?? 60_000) + 1_000
}

function useFeedback(control: MachineAgentControl) {
	const [expiredSequence, setExpiredSequence] = useState<number>()
	const feedback = control.feedback
	const age = feedback ? Math.max(0, control.observedAt - feedback.startedAt) : Infinity
	useEffect(() => {
		if (!feedback || !Number.isFinite(feedbackLifetime(feedback))) return
		const timer = window.setTimeout(
			() => setExpiredSequence(control.sequence),
			Math.max(0, feedbackLifetime(feedback) - age),
		)
		return () => window.clearTimeout(timer)
	}, [control.sequence, feedback?.startedAt, feedback?.phase, age])
	return feedback && expiredSequence !== control.sequence && age < feedbackLifetime(feedback) ? feedback : undefined
}

function ClickRing({age}: {age: number}) {
	const [initialAge] = useState(age)
	return initialAge < 240 ? (
		<div
			className='machine-agent-click absolute -top-2.5 -left-2.5 box-border size-5 animate-[machine-agent-click_240ms_ease-out_both] rounded-full border border-[var(--agent-accent)] shadow-[0_0_0_1px_rgb(0_0_0/12%)] motion-reduce:hidden'
			style={{animationDelay: `-${initialAge}ms`}}
		/>
	) : null
}

function HoldRing({age, durationMs}: {age: number; durationMs: number}) {
	const [initialAge] = useState(age)
	return (
		<svg className='machine-agent-hold absolute -top-4 -left-4 size-8 -rotate-90 overflow-visible' viewBox='0 0 32 32'>
			<circle
				className='animate-[machine-agent-hold_linear_both] fill-none stroke-[var(--agent-accent)] [stroke-width:1.5] [stroke-dasharray:1] [stroke-linecap:round] motion-reduce:animate-none'
				cx='16'
				cy='16'
				r='13'
				pathLength='1'
				style={{animationDuration: `${durationMs}ms`, animationDelay: `-${initialAge}ms`}}
			/>
		</svg>
	)
}

// Matching cubic segments let the silhouette interpolate rather than cross-fade.
// Freeze the idle float where it is whenever the agent acts; resuming from the
// same spot avoids a visible snap
const FLOAT_PAUSE =
	'group-data-[moving=true]/pointer:[animation-play-state:paused] group-data-[pressed=true]/pointer:[animation-play-state:paused] group-data-[typing=true]/pointer:[animation-play-state:paused] motion-reduce:animate-none'

export const POINTER_SHAPE =
	'M4.2 1.3C1.8 .45 .45 1.8 1.3 4.2C4.27 12.4 7.23 20.6 10.2 28.8C11.1 31.2 13.6 31.3 14.6 28.9C16.07 25.6 17.53 22.3 19 19C22.3 17.53 25.6 16.07 28.9 14.6C31.3 13.6 31.2 11.1 28.8 10.2C20.6 7.23 12.4 4.27 4.2 1.3Z'
const SCROLL_SHAPE =
	'M16 2C11 2 7 6 7 11C7 14 7 18 7 21C7 26 11 30 16 30C21 30 25 26 25 21C25 18 25 14 25 11C25 6 21 2 16 2C16 2 16 2 16 2Z'

export function AgentPointer({
	control,
	root,
	screen,
}: {
	control: MachineAgentControl
	root: RefObject<HTMLDivElement | null>
	screen: RefObject<HTMLDivElement | null>
}) {
	const reducedMotion = useReducedMotion() ?? false
	const container = useRef<HTMLDivElement>(null)
	const nameBubble = useRef<HTMLDivElement>(null)
	const trailCanvas = useRef<HTMLCanvasElement>(null)
	const glow = useRef<AgentGlowTrail | undefined>(undefined)
	const timing = useRef<{id: string; start: number} | undefined>(undefined)
	const feedback = useFeedback(control)
	const pointer = control.pointer
	const pressed = feedback?.phase === 'pressed'
	const dragging = pressed && feedback?.action === 'left_click_drag'
	const scrolling = feedback?.action === 'scroll' && !!feedback.direction
	const typing = (feedback?.action === 'type' || feedback?.action === 'key') && feedback?.phase !== 'moving'
	const accent = agentAccentFor(control)
	const identity = agentVisualFor(control).id
	const handle = `@${identity === 'generic' ? 'agent' : identity === 'claude-code' ? 'claude' : identity}`

	const fillId = useId()
	const hasPointer = !!pointer
	useLayoutEffect(() => {
		if (reducedMotion || !hasPointer || !trailCanvas.current) return
		const canvas = trailCanvas.current
		let trail = createAgentGlowTrail(canvas, accent)
		glow.current = trail
		const restore = () => {
			trail?.dispose()
			trail = createAgentGlowTrail(canvas, accent)
			glow.current = trail
		}
		canvas.addEventListener('webglcontextrestored', restore)
		return () => {
			canvas.removeEventListener('webglcontextrestored', restore)
			trail?.dispose()
			glow.current = undefined
		}
	}, [accent, reducedMotion, hasPointer])

	// Layout observers live for the whole mount and call whatever draw routine
	// the current control state installed, so per-phase updates never tear
	// observers down and rebuild them
	const draw = useRef<() => void>(() => {})
	const canvasResize = useRef<ResizeObserver | undefined>(undefined)
	useLayoutEffect(() => {
		const rootElement = root.current
		const screenElement = screen.current
		if (!rootElement || !screenElement) return
		const redraw = () => draw.current()
		const resize = new ResizeObserver(redraw)
		resize.observe(rootElement)
		resize.observe(screenElement)
		canvasResize.current = resize
		const mutation = new MutationObserver(redraw)
		mutation.observe(screenElement, {childList: true, subtree: true})
		return () => {
			resize.disconnect()
			mutation.disconnect()
			canvasResize.current = undefined
		}
	}, [root, screen])

	useLayoutEffect(() => {
		const element = container.current
		const rootElement = root.current
		const screenElement = screen.current
		if (!element || !rootElement || !screenElement || !pointer) return
		const motion = pointer.motion
		const motionId = motion && `${motion.startedAt}:${motion.from.x},${motion.from.y}:${motion.to.x},${motion.to.y}`
		if (motion && timing.current?.id !== motionId) {
			timing.current = {id: motionId!, start: performance.now() - Math.max(0, control.observedAt - motion.startedAt)}
		}
		let frame = 0
		let disposed = false
		let observedCanvas: HTMLCanvasElement | undefined
		const bubble = nameBubble.current
		const bubbleWidth = bubble?.offsetWidth ?? 0
		const bubbleHeight = bubble?.offsetHeight ?? 0
		const render = () => {
			if (disposed) return
			cancelAnimationFrame(frame)
			const canvas = screenElement.querySelector('canvas')
			if (!canvas || !pointer.width || !pointer.height) return
			if (canvas !== observedCanvas) {
				if (observedCanvas) canvasResize.current?.unobserve(observedCanvas)
				canvasResize.current?.observe(canvas)
				observedCanvas = canvas
			}
			const bounds = canvas.getBoundingClientRect()
			const rootBounds = rootElement.getBoundingClientRect()
			if (!bounds.width || !bounds.height) return
			const scaleX = bounds.width / pointer.width
			const scaleY = bounds.height / pointer.height
			const offsetX = bounds.left - rootBounds.left
			const offsetY = bounds.top - rootBounds.top
			const elapsed = motion && timing.current ? performance.now() - timing.current.start : Infinity
			const moving = !!motion && elapsed < motion.durationMs
			// Reduced motion still tracks the real pointer; it removes ornament,
			// never teleports ahead of the guest's actual interaction.
			const point = motion ? pointOnMotion(motion, elapsed / motion.durationMs) : pointer
			const x = point.x * scaleX
			const y = point.y * scaleY
			element.style.transform = `translate(${offsetX + x}px, ${offsetY + y}px)`
			element.style.visibility = 'visible'
			element.dataset.moving = String(moving && !reducedMotion)
			if (bubble) {
				// Keep the tag beside the pointer, but tuck it inward at console edges.
				const flipX = offsetX + x + 24 + bubbleWidth > rootBounds.width - 8
				const flipY = offsetY + y + 28 + bubbleHeight > rootBounds.height - 8
				bubble.style.transform = `translate(${flipX ? -bubbleWidth - 12 : 24}px, ${flipY ? -bubbleHeight - 12 : 28}px)`
				// The sharp corner is the tail; it keeps pointing at the tip when tucked
				bubble.dataset.tail = `${flipY ? 'b' : 't'}${flipX ? 'r' : 'l'}`
			}
			if (dragging || typing) glow.current?.clear()
			else glow.current?.move(offsetX + x, offsetY + y, rootBounds.width, rootBounds.height, moving)

			if (motion && elapsed < motion.durationMs + 80) frame = requestAnimationFrame(render)
		}
		draw.current = render
		render()
		return () => {
			disposed = true
			cancelAnimationFrame(frame)
			if (observedCanvas) canvasResize.current?.unobserve(observedCanvas)
			if (draw.current === render) draw.current = () => {}
		}
	}, [pointer, root, screen, reducedMotion, dragging, typing, control.observedAt, handle])

	if (!pointer) return null
	const release = feedback?.phase === 'released'
	const longPress = pressed && feedback.action === 'long_press'
	const actionAge = feedback ? Math.max(0, control.observedAt - feedback.startedAt) : 0
	return (
		<div
			className='machine-agent-pointer-layer pointer-events-none absolute inset-0 z-20 overflow-hidden [--agent-depth:color-mix(in_srgb,var(--agent-accent)_65%,black)] [--agent-face:color-mix(in_srgb,var(--agent-accent)_85%,white)] [--agent-rim:color-mix(in_srgb,var(--agent-accent)_35%,white)]'
			style={{'--agent-accent': accent} as CSSProperties}
			aria-hidden='true'
		>
			<canvas
				ref={trailCanvas}
				className='machine-agent-trail absolute inset-0 size-full mix-blend-screen motion-reduce:hidden'
			/>
			<div
				ref={container}
				className='machine-agent-pointer group/pointer invisible absolute top-0 left-0 will-change-transform'
				data-pressed={!!pressed}
				data-typing={!!typing}
			>
				<div className='origin-top-left animate-[machine-agent-arrive_180ms_cubic-bezier(0.215,0.61,0.355,1)_both] motion-reduce:animate-none'>
					{/* Idle float pauses in place, never snaps, while the agent moves, presses or types */}
					<div
						className={cn(
							'machine-agent-float animate-[machine-agent-float-x_7.3s_ease-in-out_-2.1s_infinite_alternate]',
							FLOAT_PAUSE,
						)}
					>
						<div
							className={cn('animate-[machine-agent-float-y_9.7s_ease-in-out_-4.4s_infinite_alternate]', FLOAT_PAUSE)}
						>
							<div
								className={cn(
									'absolute -top-[18px] -left-[18px] size-9 rounded-full bg-[radial-gradient(circle,var(--agent-accent),transparent_68%)] transition-[opacity,transform] duration-180 ease-[ease] motion-reduce:transform-none motion-reduce:transition-none',
									pressed
										? '[transform:scale(0.72)]'
										: '[transform:scale(0.85)] group-data-[moving=true]/pointer:[transform:scale(1.12)] motion-reduce:group-data-[moving=true]/pointer:transform-none',
									typing
										? 'opacity-[0.08]'
										: pressed
											? 'opacity-[0.58]'
											: 'opacity-[0.17] group-data-[moving=true]/pointer:opacity-[0.38]',
								)}
							/>
							<div
								className={cn(
									'absolute -top-2.5 -left-2.5 box-border size-5 rounded-full border border-[var(--agent-accent)] shadow-[0_0_0_1px_rgb(0_0_0/12%)] [transition:opacity_70ms_ease,transform_100ms_ease] motion-reduce:transition-none',
									pressed ? '[transform:scale(0.85)] opacity-75' : '[transform:scale(0.7)] opacity-0',
								)}
							/>
							<motion.div
								className='machine-agent-cursor absolute origin-top-left'
								initial={false}
								animate={{
									transform: reducedMotion
										? 'none'
										: `perspective(180px) rotate3d(1, -1, 0, ${pressed ? 22 : 0}deg) scale(${pressed ? 0.97 : 1})`,
								}}
								transition={{duration: reducedMotion ? 0 : pressed ? 0.065 : 0.19, ease: [0.215, 0.61, 0.355, 1]}}
							>
								<svg
									className='absolute -top-[3px] -left-[3px] overflow-visible drop-shadow-[1px_2px_1.5px_rgb(0_0_0/32%)]'
									viewBox='-3 -3 38 38'
									width='38'
									height='38'
								>
									<defs>
										<linearGradient id={fillId} x1='0' y1='0' x2='0.8' y2='1'>
											<stop offset='0%' stopColor='var(--agent-face)' />
											<stop offset='100%' stopColor='var(--agent-depth)' />
										</linearGradient>
									</defs>
									<motion.path
										initial={false}
										animate={{d: scrolling ? SCROLL_SHAPE : POINTER_SHAPE}}
										transition={{duration: reducedMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1]}}
										fill={`url(#${fillId})`}
										stroke='var(--agent-rim)'
										strokeWidth='2.4'
										strokeLinejoin='round'
									/>
								</svg>
							</motion.div>

							<div
								ref={nameBubble}
								data-tail='tl'
								className={cn(
									'machine-agent-name absolute top-0 left-1 w-max rounded-full border border-white/25 px-2 py-1 text-[11px] leading-none font-semibold whitespace-nowrap text-white/80 shadow-[0_2px_8px_rgb(0_0_0/2%),inset_0_1px_0_rgb(255_255_255/16%)] data-[tail=bl]:rounded-bl-[100%] data-[tail=br]:rounded-br-[100%] data-[tail=tl]:rounded-tl-[100%] data-[tail=tr]:rounded-tr-[100%]',
									identity === 'cursor' || identity === 'hermes' ? 'bg-[var(--agent-depth)]' : 'bg-[var(--agent-face)]',
								)}
							>
								{handle}
							</div>

							{release && <ClickRing key={control.sequence} age={actionAge} />}
							{longPress && (
								<HoldRing key={control.sequence} age={actionAge} durationMs={feedback.durationMs ?? 1_000} />
							)}
							{feedback?.action === 'scroll' && feedback.direction && (
								<div
									key={control.sequence}
									className='machine-agent-scroll absolute top-4 left-4 origin-top-left data-[direction=left]:rotate-90 data-[direction=right]:-rotate-90 data-[direction=up]:rotate-180'
									data-direction={feedback.direction}
								>
									<span className='absolute -top-[27px] -left-1 h-[9px] w-0.5 animate-[machine-agent-scroll_440ms_cubic-bezier(0.22,1,0.36,1)_both] rounded-[2px] bg-[linear-gradient(transparent,var(--agent-rim))] motion-reduce:animate-none' />
									<span className='absolute -top-[27px] left-0.5 h-[9px] w-0.5 animate-[machine-agent-scroll_440ms_cubic-bezier(0.22,1,0.36,1)_both] rounded-[2px] bg-[linear-gradient(transparent,var(--agent-rim))] [animation-delay:55ms] motion-reduce:animate-none' />
								</div>
							)}
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
