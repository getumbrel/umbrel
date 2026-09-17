import {Activity, MonitorSmartphone, SlidersHorizontal, Sparkles, type LucideIcon} from 'lucide-react'
import {AnimatePresence, motion} from 'motion/react'
import {useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {useTranslation} from 'react-i18next'

import {Bubble, BubbleContent, BubbleReactions} from '@/components/ui/bubble'
import {cn} from '@/lib/utils'
import {MCP_AGENTS, type McpAgent, type McpAgentId} from '@/routes/settings/mcp/agents'
import {AgentLogoPlate} from '@/routes/settings/mcp/constellation'

// The pitch as a replay: instead of cards telling what agents can do, a small
// chat stage shows it. Four scripted exchanges play out in speech bubbles —
// install an app, put a machine to work, troubleshoot, hit a permission wall —
// while a single caption beneath morphs to name the promise each one demonstrates. A
// story-style progress bar keeps the rhythm legible and doubles as a scrubber.
// Each scenario is answered by a different registry agent, so the same faces
// orbiting the constellation above are the ones seen doing the work — and the
// agent tapbacks each ask (eyes while thinking, a check once done), the same
// ritual people know from their own chats.

type DemoMessage = {from: 'user' | 'agent'; text: string}

type DemoScenario = {
	icon: LucideIcon
	title: string
	description: string
	agent: McpAgent
	script: DemoMessage[]
}

// The cadence is derived from the translated strings themselves, so pacing
// survives verbose locales: bubbles stay up long enough to read, and the
// typing indicator runs longer before long replies without ever stalling.
const LEAD_MS = 600 // quiet beat before a scenario's first message
const GAP_MS = 260 // breath between a bubble landing and the next event
const REACT_MS = 500 // the agent starts "typing" almost immediately after being asked
const HOLD_MS = 1400 // linger on the finished exchange before it slides away
const clampMs = (ms: number, min: number, max: number) => Math.min(max, Math.max(min, ms))
const readMs = (text: string) => clampMs(600 + text.length * 26, 1000, 3200)
const typeMs = (text: string) => clampMs(500 + text.length * 7, 800, 1500)

// Scenarios cast their agent by id, so the on-screen order is the pitch's own
// rather than a side effect of the registry's display order
const agentById = (id: McpAgentId) => MCP_AGENTS.find((agent) => agent.id === id)!

type TimelineEvent = {at: number; shown: number; typing: boolean}

// One scenario flattened into a schedule: when the typing indicator appears,
// when each bubble lands, and the total running time — which also drives the
// linear fill of the active progress segment, keeping bar and chat in step.
function buildTimeline(script: DemoMessage[]) {
	const events: TimelineEvent[] = []
	let at = LEAD_MS
	script.forEach((message, index) => {
		if (message.from === 'agent') {
			events.push({at, shown: index, typing: true})
			at += typeMs(message.text)
			events.push({at, shown: index + 1, typing: false})
			at += readMs(message.text)
		} else {
			at += GAP_MS
			events.push({at, shown: index + 1, typing: false})
			// A reply's typing indicator pops up right away — the user message
			// keeps being read while the agent "types" — but a bubble with no
			// reply coming holds for its own reading time
			at += script[index + 1]?.from === 'agent' ? REACT_MS : readMs(message.text)
		}
	})
	return {events, totalMs: at + HOLD_MS}
}

// The playhead advances as one atomic object so a scenario change and its
// message reset land in the same render — split state would flash the next
// scene fully written for a frame before the reset caught up.
type Playhead = {step: number; shown: number; typing: boolean}

export function PitchReplay() {
	const {t} = useTranslation()

	const scenarios: DemoScenario[] = useMemo(
		() => [
			{
				icon: Sparkles,
				title: t('mcp-intro-point-ask-title'),
				description: t('mcp-intro-demo-ask-card'),
				agent: agentById('openclaw'),
				script: [
					{from: 'user', text: t('mcp-intro-demo-ask-user')},
					{from: 'agent', text: t('mcp-intro-demo-ask-agent')},
				],
			},
			{
				icon: MonitorSmartphone,
				title: t('mcp-intro-demo-machines-title'),
				description: t('mcp-intro-demo-machines-card'),
				agent: agentById('hermes'),
				script: [
					{from: 'user', text: t('mcp-intro-demo-machines-user-invoices')},
					{from: 'agent', text: t('mcp-intro-demo-machines-agent-sent')},
					{from: 'user', text: t('mcp-intro-demo-machines-user-ride')},
					{from: 'agent', text: t('mcp-intro-demo-machines-agent-booked')},
				],
			},
			{
				icon: Activity,
				title: t('mcp-intro-demo-troubleshoot-title'),
				description: t('mcp-intro-demo-troubleshoot-card'),
				agent: agentById('claude-code'),
				script: [
					{from: 'user', text: t('mcp-intro-demo-troubleshoot-user')},
					{from: 'agent', text: t('mcp-intro-demo-troubleshoot-agent')},
				],
			},
			{
				icon: SlidersHorizontal,
				title: t('mcp-intro-point-control-title'),
				description: t('mcp-intro-demo-access-card'),
				agent: agentById('codex'),
				script: [
					{from: 'user', text: t('mcp-intro-demo-access-user-organize')},
					{from: 'agent', text: t('mcp-intro-demo-access-agent-blocked')},
					{from: 'user', text: t('mcp-intro-demo-access-user-done')},
					{from: 'agent', text: t('mcp-intro-demo-access-agent-organized')},
				],
			},
		],
		[t],
	)

	const [playhead, setPlayhead] = useState<Playhead>({step: 0, shown: 0, typing: false})
	const index = playhead.step % scenarios.length
	const scenario = scenarios[index]
	const timeline = useMemo(() => buildTimeline(scenario.script), [scenario])

	// The whole scenario is scheduled up front and torn down as one: unmounting
	// or jumping clears every pending timer, and a language change reschedules
	// against the new strings from a clean slate.
	useEffect(() => {
		setPlayhead((current) => ({...current, shown: 0, typing: false}))
		const timers = timeline.events.map((event) =>
			window.setTimeout(
				() => setPlayhead((current) => ({...current, shown: event.shown, typing: event.typing})),
				event.at,
			),
		)
		timers.push(
			window.setTimeout(
				() => setPlayhead((current) => ({step: current.step + 1, shown: 0, typing: false})),
				timeline.totalMs,
			),
		)
		return () => timers.forEach((timer) => window.clearTimeout(timer))
	}, [playhead.step, timeline])

	// Tapping a segment scrubs to that scenario; the current one is left alone
	// so an idle tap doesn't stutter the show
	const jumpTo = (target: number) => {
		if (target === index) return
		setPlayhead((current) => ({
			step: current.step - (current.step % scenarios.length) + target,
			shown: 0,
			typing: false,
		}))
	}

	// A nameplate opens every agent run (an agent message not preceded by one),
	// so an agent that answers twice in a scenario stays attributed. The rows
	// build as one keyed list so the nameplate keeps its identity when the
	// typing indicator it introduced becomes the landed message.
	const startsAgentRun = (messageIndex: number) =>
		scenario.script[messageIndex]?.from === 'agent' && scenario.script[messageIndex - 1]?.from !== 'agent'
	// The agent tapbacks the message it is answering: eyes while the reply is
	// being "typed", swapped for a check once it lands
	const reactionFor = (messageIndex: number) => {
		const message = scenario.script[messageIndex]
		if (message.from !== 'user' || scenario.script[messageIndex + 1]?.from !== 'agent') return null
		if (playhead.shown > messageIndex + 1) return '✅'
		if (playhead.typing && playhead.shown === messageIndex + 1) return '👀'
		return null
	}

	const rows: ReactNode[] = []
	scenario.script.slice(0, playhead.shown).forEach((message, messageIndex) => {
		if (startsAgentRun(messageIndex))
			rows.push(<AgentNameplate key={`nameplate-${messageIndex}`} agent={scenario.agent} />)
		rows.push(<ChatBubble key={`message-${messageIndex}`} message={message} reaction={reactionFor(messageIndex)} />)
	})
	if (playhead.typing) {
		if (startsAgentRun(playhead.shown))
			rows.push(<AgentNameplate key={`nameplate-${playhead.shown}`} agent={scenario.agent} />)
		rows.push(<TypingBubble key='typing' />)
	}

	return (
		<div className='mx-auto flex w-full max-w-[360px] flex-col gap-3'>
			{/* The stage clips at a fixed height with a fade-out mask at the top, so
			    long exchanges scroll away upward like a real conversation. Scenes
			    are keyed by step: the finished one slides up and out while the next
			    starts from silence. */}
			<div className='flex h-[210px] flex-col justify-end overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_32px)]'>
				<AnimatePresence initial={false}>
					<motion.div
						key={playhead.step}
						exit={{opacity: 0, y: -12}}
						transition={{duration: 0.2}}
						className='flex flex-col gap-1.5'
					>
						{rows}
					</motion.div>
				</AnimatePresence>
			</div>

			{/* The promise caption under the chat, morphing in step with it */}
			<AnimatePresence mode='wait' initial={false}>
				<motion.div
					key={index}
					initial={{opacity: 0}}
					animate={{opacity: 1}}
					exit={{opacity: 0}}
					transition={{duration: 0.15}}
					className='flex min-h-[64px] w-full items-center justify-center'
				>
					<Caption scenario={scenario} />
				</motion.div>
			</AnimatePresence>

			{/* Story-style progress: the active segment fills linearly over the
			    scenario's exact running time; every segment is also a button that
			    scrubs straight to its scenario */}
			<div className='flex gap-1.5'>
				{scenarios.map((entry, segmentIndex) => (
					<button
						key={entry.title}
						type='button'
						aria-label={entry.title}
						onClick={() => jumpTo(segmentIndex)}
						className='group flex-1 cursor-pointer py-1.5'
					>
						<span className='block h-[3px] overflow-hidden rounded-full bg-white/15 transition-colors group-hover:bg-white/25'>
							{segmentIndex === index ? (
								<motion.span
									key={playhead.step}
									initial={{scaleX: 0}}
									animate={{scaleX: 1}}
									transition={{duration: timeline.totalMs / 1000, ease: 'linear'}}
									className='block h-full w-full origin-left bg-brand-lighter'
								/>
							) : (
								<span
									className={cn(
										'block h-full w-full bg-brand-lighter transition-opacity',
										segmentIndex < index ? 'opacity-100' : 'opacity-0',
									)}
								/>
							)}
						</span>
					</button>
				))}
			</div>
		</div>
	)
}

// The promise caption: no container, just an icon-and-title line with the
// description as quiet centered support — a caption under the scene rather
// than a card competing with it
function Caption({scenario}: {scenario: DemoScenario}) {
	const Icon = scenario.icon
	return (
		<div className='flex flex-col items-center gap-1 text-center'>
			<div className='flex items-center gap-1.5'>
				<Icon className='size-[14px] text-brand-lighter' />
				<p className='text-13 font-medium'>{scenario.title}</p>
			</div>
			<p className='max-w-[300px] text-12 leading-snug text-white/40'>{scenario.description}</p>
		</div>
	)
}

// Bubbles land with a small rise-and-settle; layout='position' eases the
// column shift so earlier messages glide up instead of snapping
const BUBBLE_ENTER = {
	initial: {opacity: 0, y: 8, scale: 0.96},
	animate: {opacity: 1, y: 0, scale: 1},
	transition: {duration: 0.24, ease: [0.215, 0.61, 0.355, 1] as const},
}

function ChatBubble({message, reaction}: {message: DemoMessage; reaction: string | null}) {
	const isUser = message.from === 'user'
	const contentRef = useRef<HTMLDivElement>(null)

	// fit-content stretches a wrapped bubble to the full max width even when
	// its lines are shorter (text-balance equalizes lines but by spec never
	// shrinks the box), so the content is measured once and sized to its widest
	// rendered line. Balance has already made the lines near-equal, so hugging
	// the widest one keeps the wrap points stable.
	useLayoutEffect(() => {
		const content = contentRef.current
		if (!content) return
		content.style.width = ''
		const range = document.createRange()
		range.selectNodeContents(content)
		// Client rects are visual: at measure time the entrance animation has
		// the bubble at scale 0.96, and sizing to a 4% short reading forces an
		// extra wrap — divide the transform back out against the layout width
		const scale = content.getBoundingClientRect().width / content.offsetWidth || 1
		const widest = Math.max(0, ...Array.from(range.getClientRects(), (rect) => rect.width)) / scale
		if (widest === 0) return
		const {paddingLeft, paddingRight} = getComputedStyle(content)
		content.style.width = `${Math.ceil(widest + parseFloat(paddingLeft) + parseFloat(paddingRight)) + 1}px`
	}, [message.text])

	return (
		<motion.div
			layout='position'
			{...BUBBLE_ENTER}
			className={cn('flex max-w-[85%] flex-col', isUser ? 'items-end self-end' : 'items-start self-start')}
		>
			<Bubble variant={isUser ? 'default' : 'secondary'} align={isUser ? 'end' : 'start'}>
				<BubbleContent ref={contentRef} className={isUser ? 'text-right' : 'text-left'}>
					{message.text}
				</BubbleContent>
				{isUser && (
					<BubbleReactions side='top' align='start'>
						<AnimatePresence mode='popLayout' initial={false}>
							{reaction && (
								<motion.span
									key={reaction}
									initial={{scale: 0.4, opacity: 0}}
									animate={{scale: 1, opacity: 1}}
									exit={{scale: 0.4, opacity: 0}}
									transition={{type: 'spring', stiffness: 500, damping: 28}}
									className='rounded-full bg-[#33333c] px-1.5 py-1 text-[11px] leading-none shadow-md ring-2 ring-[#17171f]'
								>
									{reaction}
								</motion.span>
							)}
						</AnimatePresence>
					</BubbleReactions>
				)}
			</Bubble>
		</motion.div>
	)
}

function TypingBubble() {
	return (
		<motion.div layout='position' {...BUBBLE_ENTER} className='self-start'>
			<Bubble variant='secondary' align='start'>
				<BubbleContent className='flex items-center gap-1 px-3.5 py-3'>
					{[0, 1, 2].map((dot) => (
						<motion.span
							key={dot}
							animate={{y: [0, -3, 0], opacity: [0.4, 1, 0.4]}}
							transition={{duration: 1, repeat: Infinity, delay: dot * 0.15, ease: 'easeInOut'}}
							className='size-1.5 rounded-full bg-white/45'
						/>
					))}
				</BubbleContent>
			</Bubble>
		</motion.div>
	)
}

// A tiny "who's answering" byline above each agent run — the fourth quiet
// restatement of the multi-agent story after the constellation, and the
// reason each scenario rotates to a different registry agent
function AgentNameplate({agent}: {agent: McpAgent}) {
	return (
		<motion.div
			layout='position'
			initial={{opacity: 0, y: 4}}
			animate={{opacity: 1, y: 0}}
			transition={{duration: 0.2}}
			className='mt-1 flex items-center gap-1.5 self-start ps-0.5'
		>
			<AgentLogoPlate agent={agent} size={16} />
			<span className='text-[11px] text-white/40'>{agent.name}</span>
		</motion.div>
	)
}
