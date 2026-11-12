import {AnimatePresence, motion, useReducedMotion} from 'motion/react'
import {useTranslation} from 'react-i18next'
import {TbCheck} from 'react-icons/tb'

import {cn} from '@/lib/utils'
import {type McpMatchedAgent} from '@/routes/settings/mcp/agents'
import {AgentLogoPlate} from '@/routes/settings/mcp/constellation'
import {MagicRings, type MagicRingsVariant} from '@/routes/settings/mcp/magic-rings'

// One card tells the whole story: picking an agent collapses the dialog into
// it ("Enabling MCP server…", gray rings), then the connect view expands
// around it and the card glides down into its waiting slot (rings warm to the
// brand color), and the agent's first request turns everything green. The
// layoutId is what carries it between views as a single continuous object.

export type McpStatusPhase = 'enabling' | 'waiting' | 'connected'

const RINGS_BY_PHASE: Record<McpStatusPhase, MagicRingsVariant> = {
	enabling: 'neutral',
	waiting: 'brand',
	connected: 'success',
}

export function McpStatusCard({
	phase,
	name,
	agent,
	enablingLabel,
}: {
	phase: McpStatusPhase
	name?: string
	agent?: McpMatchedAgent
	// The enabling beat's line — defaults to first-run's "Enabling MCP
	// server…", overridden when the same beat mints an additional token
	enablingLabel?: string
}) {
	const {t} = useTranslation()
	const reducedMotion = useReducedMotion() ?? false
	const connected = phase === 'connected'

	const caption = name ? t('mcp-connect-connected', {name}) : t('mcp-connect-connected-generic')

	return (
		<motion.div
			layoutId='mcp-status-card'
			transition={reducedMotion ? {duration: 0} : {type: 'spring', stiffness: 300, damping: 34}}
			// No chrome of its own — the rings float on the dialog surface itself,
			// edge to edge, so the caller keeps its horizontal padding off this card
			className='relative'
		>
			{/* The animation area holds its height across the waiting→connected
			    flip: the check simply takes the text's place on the bullseye, and
			    the caption gets its own line below the rings */}
			<div className='relative overflow-hidden'>
				<MagicRings variant={RINGS_BY_PHASE[phase]} />
				<div
					className={cn(
						'relative flex flex-col items-center justify-center px-4 text-center transition-[min-height]',
						phase === 'enabling' ? 'min-h-[260px]' : 'min-h-[105px]',
					)}
				>
					{/* The center content sits on a soft plate that fades out on every
					    side, so the rings ripple right up to it without ever running
					    through it */}
					<div className='relative px-12 py-7'>
						{/* Same color recipe as the dialog surface itself, so the plate
						    disappears into it while still quieting the rings underneath */}
						<div
							aria-hidden
							className='absolute inset-0 bg-dialog-content/70 [mask-image:radial-gradient(closest-side,black_40%,transparent_100%)] contrast-more:bg-dialog-content'
						/>
						<div className='relative flex flex-col items-center'>
							<AnimatePresence mode='wait' initial={false}>
								{connected ? (
									<motion.div
										key='connected'
										initial={reducedMotion ? false : {opacity: 0, scale: 0.7}}
										animate={{opacity: 1, scale: 1}}
										transition={{type: 'spring', stiffness: 300, damping: 20}}
										className='relative'
									>
										{agent ? (
											<>
												<AgentLogoPlate agent={agent} size={44} />
												<span className='absolute -right-1 -bottom-1 flex size-4.5 items-center justify-center rounded-full bg-green-400 shadow-[0_0_8px] shadow-green-400/60'>
													<TbCheck className='size-3 text-black' strokeWidth={3} />
												</span>
											</>
										) : (
											<span className='flex size-11 items-center justify-center rounded-full bg-green-400/15 shadow-[0_0_12px] shadow-green-400/30'>
												<TbCheck className='size-5 text-green-400' strokeWidth={2.5} />
											</span>
										)}
									</motion.div>
								) : (
									<motion.p
										key={phase}
										initial={reducedMotion ? false : {opacity: 0, y: 4}}
										animate={{opacity: 1, y: 0}}
										exit={reducedMotion ? undefined : {opacity: 0, y: -4}}
										transition={{duration: 0.2, ease: 'easeOut'}}
										className='text-13 leading-tight text-white/60'
									>
										{phase === 'enabling' ? (enablingLabel ?? t('mcp-enabling')) : t('mcp-connect-waiting')}
									</motion.p>
								)}
							</AnimatePresence>
						</div>
					</div>
				</div>
			</div>
			<AnimatePresence initial={false}>
				{connected && (
					<motion.p
						key='caption'
						initial={reducedMotion ? false : {opacity: 0, y: -4}}
						animate={{opacity: 1, y: 0}}
						transition={{duration: 0.25, ease: 'easeOut', delay: 0.1}}
						className='px-4 pt-1 text-center text-13 leading-tight font-medium text-white/90'
					>
						{caption}
					</motion.p>
				)}
			</AnimatePresence>
		</motion.div>
	)
}
